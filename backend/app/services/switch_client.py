import logging
import re
import asyncio
from app.services.pfsense_client import _ensure_pysnmp, _require_pysnmp

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# SSH Client for Cisco SG300 / SF300 managed switches
# ---------------------------------------------------------------------------

class SwitchSshClient:
    """SSH CLI client for Cisco SG300/SF300 switches.

    Connects via SSH and parses CLI command output.
    """

    def __init__(self):
        self._host = ""
        self._username = ""
        self._password = ""
        self._port = 22
        self._enable_password = ""

    def update_config(self, host: str, username: str = "", password: str = "",
                      port: int = 22, enable_password: str = ""):
        self._host = host
        self._username = username
        self._password = password
        self._port = port
        self._enable_password = enable_password

    @property
    def is_configured(self) -> bool:
        return bool(self._host and self._username)

    async def _run_commands(self, commands: list[str], timeout: float = 30) -> dict[str, str]:
        """Connect via SSH, run commands in exec mode, return {command: output} dict."""
        results: dict[str, str] = {}
        conn = await self._connect(timeout)

        async with conn:
            for cmd in commands:
                try:
                    result = await asyncio.wait_for(
                        conn.run(cmd, check=False),
                        timeout=15,
                    )
                    output = result.stdout or ""
                    if result.stderr:
                        output += result.stderr
                    results[cmd] = output
                except asyncio.TimeoutError:
                    results[cmd] = f"[timeout on command: {cmd}]"
                except Exception as e:
                    results[cmd] = f"[error: {e}]"

        return results

    async def _connect(self, timeout: float = 30):
        """Create an asyncssh connection with Cisco-compatible algorithms."""
        import asyncssh

        try:
            conn = await asyncio.wait_for(
                asyncssh.connect(
                    self._host,
                    port=self._port,
                    username=self._username,
                    password=self._password,
                    known_hosts=None,
                    kex_algs=[
                        'diffie-hellman-group14-sha256',
                        'diffie-hellman-group14-sha1',
                        'diffie-hellman-group-exchange-sha256',
                        'diffie-hellman-group-exchange-sha1',
                        'diffie-hellman-group1-sha1',
                        'ecdh-sha2-nistp256',
                        'ecdh-sha2-nistp384',
                        'ecdh-sha2-nistp521',
                    ],
                    encryption_algs=[
                        'aes128-ctr', 'aes192-ctr', 'aes256-ctr',
                        'aes128-cbc', 'aes192-cbc', 'aes256-cbc',
                        '3des-cbc',
                    ],
                    server_host_key_algs=[
                        'ssh-rsa', 'rsa-sha2-256', 'rsa-sha2-512',
                        'ecdsa-sha2-nistp256', 'ssh-ed25519',
                    ],
                ),
                timeout=timeout,
            )
            return conn
        except asyncio.TimeoutError:
            raise RuntimeError(f"SSH connection to {self._host}:{self._port} timed out after {timeout}s")
        except Exception as e:
            raise RuntimeError(f"SSH connection failed: {type(e).__name__}: {e}")

    async def _run_interactive(self, commands: list[str], timeout: float = 30) -> dict[str, str]:
        """Connect via SSH interactive shell for switches that don't support exec commands."""
        results: dict[str, str] = {}
        conn = await self._connect(timeout)

        async with conn:
            # Open an interactive shell session
            stdin, stdout, stderr = await conn.open_session(term_type='xterm')

            # The actual CLI prompt string, discovered after login
            prompt_str = ""

            def _strip_ansi(text: str) -> str:
                """Remove ANSI escape sequences."""
                return re.sub(r'\x1b\[[0-9;]*[A-Za-z]', '', text)

            async def _read_raw(t: float = 10) -> str:
                """Read from stdout until timeout with no new data."""
                buf = ""
                while True:
                    try:
                        chunk = await asyncio.wait_for(stdout.read(4096), timeout=t)
                        if not chunk:
                            break
                        buf += chunk
                        # Once we have data, use a short timeout to detect end of output
                        t = 1.0
                    except asyncio.TimeoutError:
                        break
                return _strip_ansi(buf).replace("\r", "")

            async def read_until_prompt(t: float = 10, stop_patterns: list[str] | None = None) -> str:
                """Read until the known CLI prompt or a stop pattern appears.
                Automatically handles --More-- pagination."""
                buf = ""
                deadline = asyncio.get_event_loop().time() + t
                idle_count = 0
                while asyncio.get_event_loop().time() < deadline:
                    remaining = max(0.5, deadline - asyncio.get_event_loop().time())
                    try:
                        chunk = await asyncio.wait_for(stdout.read(4096), timeout=min(remaining, 3.0))
                        if not chunk:
                            break
                        buf += chunk
                        idle_count = 0  # Reset — we got data
                        clean = _strip_ansi(buf).replace("\r", "")

                        # Handle --More-- pagination: send space to continue
                        if clean.rstrip().endswith("--More--"):
                            # Remove the --More-- from buffer and send space
                            buf = buf[:buf.rfind("--More--")]
                            stdin.write(" ")
                            continue

                        # If we know the prompt, match it exactly
                        if prompt_str and clean.rstrip().endswith(prompt_str):
                            return clean
                        # Check stop patterns
                        if stop_patterns:
                            clean_lower = clean.lower()
                            for pat in stop_patterns:
                                if pat in clean_lower:
                                    return clean
                        # Generic prompt detection (before we know the prompt)
                        if not prompt_str and re.search(r'\S+[#>]\s*$', clean):
                            return clean
                    except asyncio.TimeoutError:
                        idle_count += 1
                        if buf:
                            clean = _strip_ansi(buf).replace("\r", "")
                            # Handle --More-- on timeout too
                            if clean.rstrip().endswith("--More--"):
                                buf = buf[:buf.rfind("--More--")]
                                stdin.write(" ")
                                idle_count = 0
                                continue
                            if prompt_str and clean.rstrip().endswith(prompt_str):
                                return clean
                            if idle_count >= 3:
                                break
                        else:
                            break
                return _strip_ansi(buf).replace("\r", "")

            def _discover_prompt(text: str) -> str:
                """Extract the CLI prompt from the end of text (e.g. 'switch01>' or 'switch01#')."""
                clean = text.rstrip()
                # Find the last line that looks like a prompt
                for line in reversed(clean.split("\n")):
                    line = line.strip()
                    m = re.match(r'^(\S+[#>])$', line)
                    if m:
                        return m.group(1)
                # Try end of last line
                m = re.search(r'(\S+[#>])\s*$', clean)
                if m:
                    return m.group(1)
                return ""

            # --- Login phase ---
            initial = await read_until_prompt(15, ["user name:", "username:", "login:"])
            initial_lower = initial.lower()

            # SG250/SG350 may present a secondary login inside the SSH shell
            if "user name:" in initial_lower or "username:" in initial_lower or "login:" in initial_lower:
                logger.info("Switch requires secondary login — sending credentials")
                stdin.write(self._username + "\n")
                pw_prompt = await read_until_prompt(10, ["password:"])
                if "password:" in pw_prompt.lower():
                    stdin.write(self._password + "\n")
                    login_result = await read_until_prompt(10, ["failed", "denied", "invalid"])
                    login_lower = login_result.lower()
                    if "failed" in login_lower or "denied" in login_lower or "invalid" in login_lower:
                        raise RuntimeError("Switch secondary login failed — check username/password")
                    prompt_str = _discover_prompt(login_result)
            elif "password:" in initial_lower:
                logger.info("Switch requires secondary password — sending password")
                stdin.write(self._password + "\n")
                login_result = await read_until_prompt(10, ["failed", "denied", "invalid"])
                login_lower = login_result.lower()
                if "failed" in login_lower or "denied" in login_lower or "invalid" in login_lower:
                    raise RuntimeError("Switch secondary login failed — check password")
                prompt_str = _discover_prompt(login_result)
            else:
                prompt_str = _discover_prompt(initial)

            logger.info("Switch prompt discovered: %r", prompt_str)

            # --- Setup phase ---
            # Disable paging — try both methods for SG250 compatibility
            stdin.write("terminal datadump\n")
            td_out = await read_until_prompt(5)
            if not prompt_str:
                prompt_str = _discover_prompt(td_out)
            stdin.write("terminal length 0\n")
            tl_out = await read_until_prompt(5)
            if not prompt_str:
                prompt_str = _discover_prompt(tl_out)

            # Try privileged exec mode
            stdin.write("enable\n")
            enable_out = await read_until_prompt(5, ["password:"])
            if "password:" in enable_out.lower():
                pw = self._enable_password or self._password
                stdin.write(pw + "\n")
                enable_result = await read_until_prompt(5)
                if "denied" in enable_result.lower() or "fail" in enable_result.lower():
                    logger.warning("Switch enable mode failed — continuing in user mode")
                else:
                    # Prompt changes from > to # after enable
                    new_prompt = _discover_prompt(enable_result)
                    if new_prompt:
                        prompt_str = new_prompt
                        logger.info("Switch prompt after enable: %r", prompt_str)
            else:
                new_prompt = _discover_prompt(enable_out)
                if new_prompt:
                    prompt_str = new_prompt

            # --- Command phase ---
            for cmd in commands:
                await asyncio.sleep(0.3)
                stdin.write(cmd + "\n")
                # SG250 with 26 ports can take a while for show interface status
                output = await read_until_prompt(30)
                # Clean up output: remove command echo and prompt
                lines = output.split("\n")
                # Remove command echo line(s) at the start
                while lines:
                    stripped = lines[0].strip()
                    if not stripped or cmd in stripped or stripped in cmd:
                        lines.pop(0)
                    else:
                        break
                # Remove trailing prompt line
                while lines:
                    stripped = lines[-1].strip()
                    if not stripped or (prompt_str and stripped == prompt_str):
                        lines.pop()
                    elif re.match(r'^\S+[#>]$', stripped):
                        lines.pop()
                    else:
                        break
                results[cmd] = "\n".join(lines)

            try:
                stdin.write("exit\n")
            except Exception:
                pass

        return results

    async def test_connection(self) -> dict:
        """Test SSH connectivity and return system info."""
        if not self.is_configured:
            return {"ok": False, "error": "Switch SSH not configured"}

        last_error = "Connected but could not read data"

        # Try interactive shell first (most Cisco small business switches need this)
        try:
            results = await self._run_interactive(["show version"])
            output = results.get("show version", "")
            # Validate we got real CLI output, not a login/password prompt
            if (output and "[error" not in output
                    and "password:" not in output.lower()
                    and "user name:" not in output.lower()
                    and "authentication failed" not in output.lower()):
                return {"ok": True, "host": self._host, "mode": "interactive", "output": output[:2000]}
        except Exception as e:
            logger.warning(f"Switch interactive SSH failed: {e}")
            last_error = str(e)

        # Fall back to exec mode
        try:
            results = await self._run_commands(["show version"])
            output = results.get("show version", "")
            if output and "[error" not in output and "[timeout" not in output:
                return {"ok": True, "host": self._host, "mode": "exec", "output": output[:2000]}
        except Exception as e:
            logger.warning(f"Switch exec SSH failed: {e}")
            last_error = str(e)

        return {"ok": False, "host": self._host, "error": last_error}

    async def _run(self, commands: list[str]) -> dict[str, str]:
        """Run commands via interactive shell (Cisco small business switches need this)."""
        # Go straight to interactive — exec mode doesn't work on SG250/SG300/SG350
        return await self._run_interactive(commands)

    async def get_system_info(self) -> dict:
        results = await self._run(["show version", "show system"])
        return self._parse_system_info(
            results.get("show version", ""),
            results.get("show system", ""),
        )

    async def get_interfaces(self) -> list[dict]:
        results = await self._run(["show interface status"])
        output = results.get("show interface status", "")
        return self._parse_interfaces_status(output)

    async def get_mac_table(self) -> list[dict]:
        results = await self._run(["show mac address-table"])
        output = results.get("show mac address-table", "")
        return self._parse_mac_table(output)

    async def get_vlans(self) -> list[dict]:
        results = await self._run(["show vlan"])
        output = results.get("show vlan", "")

        vlans = []
        in_table = False
        for line in output.split("\n"):
            line = line.rstrip()
            if "--------" in line or "----" in line:
                in_table = True
                continue
            if not in_table or not line.strip():
                continue

            parts = line.split()
            if not parts:
                continue

            # First field should be VLAN ID
            try:
                vid = int(parts[0])
            except ValueError:
                continue

            name = parts[1] if len(parts) > 1 else f"VLAN {vid}"
            # Skip if name looks like a status word
            if name.lower() in ("active", "suspend", "static", "dynamic"):
                name = f"VLAN {vid}"

            vlans.append({"id": vid, "name": name})

        vlans.sort(key=lambda v: v["id"])
        return vlans

    async def get_poe_status(self) -> list[dict]:
        try:
            results = await self._run(["show power inline"])
            output = results.get("show power inline", "")
        except Exception:
            return []

        entries = []
        in_table = False
        for line in output.split("\n"):
            line = line.rstrip()
            if "--------" in line or "----" in line:
                in_table = True
                continue
            if not in_table or not line.strip():
                continue

            parts = line.split()
            if len(parts) < 2:
                continue

            port = parts[0]
            if not re.match(r'^(gi|fa|te)\d', port, re.IGNORECASE):
                continue

            entry = {"port": port, "admin": "unknown", "detection": "unknown"}
            for p in parts[1:]:
                low = p.lower()
                if low in ("on", "enabled", "auto"):
                    entry["admin"] = "enabled"
                elif low in ("off", "disabled"):
                    entry["admin"] = "disabled"
                elif low in ("delivering", "deliveringpower"):
                    entry["detection"] = "deliveringPower"
                elif low in ("searching", "waiting"):
                    entry["detection"] = "searching"
                elif low in ("disabled", "deny"):
                    entry["detection"] = "disabled"

            # Try to find power value
            for p in parts:
                try:
                    val = float(p)
                    if 0 < val < 100:
                        entry["power_mw"] = int(val * 1000)
                        break
                except ValueError:
                    continue

            entries.append(entry)

        return entries

    async def get_overview_data(self) -> dict:
        """Run all commands in a single SSH session and return parsed overview."""
        all_commands = [
            "show version",
            "show system",
            "show interface status",
            "show mac address-table",
        ]
        errors: list[str] = []
        try:
            results = await self._run(all_commands)
        except Exception as e:
            logger.error("SSH get_overview_data: _run failed: %s", e, exc_info=True)
            return {
                "system": None, "interfaces": [], "mac_table": [], "vlans": [],
                "_errors": [f"SSH connection failed: {e}"],
            }

        # Log raw output for every command so we can see what happened
        privileged_cmds = []
        for cmd, out in results.items():
            preview = out[:300].replace('\n', '\\n') if out else '(empty)'
            logger.info("Switch raw [%s]: %s", cmd, preview)
            if not out or not out.strip():
                errors.append(f"{cmd}: empty output")
            elif "unrecognized" in out.lower() or "invalid" in out.lower():
                privileged_cmds.append(cmd)

        # Parse system info from show version + show system
        version_out = results.get("show version", "")
        system_out = results.get("show system", "")
        system_info = self._parse_system_info(version_out, system_out)

        # Parse interfaces from show interface status
        status_out = results.get("show interface status", "")
        interfaces = self._parse_interfaces_status(status_out)

        # Parse MAC table (may require privileged access)
        mac_out = results.get("show mac address-table", "")
        mac_table = []
        if mac_out and "unrecognized" not in mac_out.lower():
            mac_table = self._parse_mac_table(mac_out)
        else:
            privileged_cmds.append("show mac address-table")

        # Try VLANs in a separate session (may require privileged access)
        vlans = []
        try:
            vlan_results = await self._run(["show vlan"])
            vlan_out = vlan_results.get("show vlan", "")
            if vlan_out and "unrecognized" not in vlan_out.lower():
                vlans = self._parse_vlans(vlan_out)
            else:
                privileged_cmds.append("show vlan")
        except Exception as e:
            logger.warning("show vlan failed: %s", e)
            privileged_cmds.append("show vlan")

        if privileged_cmds:
            errors.append(f"Commands require admin/enable access: {', '.join(set(privileged_cmds))}")

        return {
            "system": system_info,
            "interfaces": interfaces,
            "mac_table": mac_table,
            "vlans": vlans,
            "_errors": errors,
            "_debug": {cmd: out[:500] for cmd, out in results.items()},
        }

    def _parse_system_info(self, version_out: str, system_out: str) -> dict:
        info: dict = {"hostname": "", "description": "", "uptime": "", "contact": "", "location": ""}

        # Parse "show version" — grab firmware version
        for line in version_out.split("\n"):
            line = line.strip()
            if not line:
                continue
            low = line.lower()
            if low.startswith("version:"):
                info["description"] = f"Firmware {line.split(':', 1)[1].strip()}"

        # Parse "show system" — SG250 format uses multi-word keys with colons
        # e.g. "System Description:                       SG250-26P ..."
        #      "System Up Time (days,hour:min:sec):       120,07:46:07"
        #      "System Name:                              coreswitch01"
        for line in system_out.split("\n"):
            stripped = line.strip()
            if not stripped:
                continue
            low = stripped.lower()

            if "system description" in low:
                # "System Description:                       SG250-26P 26-Port ..."
                idx = stripped.find(":")
                if idx >= 0:
                    val = stripped[idx + 1:].strip()
                    if val:
                        info["description"] = val
            elif "system name" in low:
                idx = stripped.find(":")
                if idx >= 0:
                    val = stripped[idx + 1:].strip()
                    if val:
                        info["hostname"] = val
            elif "system location" in low:
                idx = stripped.find(":")
                if idx >= 0:
                    val = stripped[idx + 1:].strip()
                    if val:
                        info["location"] = val
            elif "system contact" in low:
                idx = stripped.find(":")
                if idx >= 0:
                    val = stripped[idx + 1:].strip()
                    if val:
                        info["contact"] = val
            elif "system up time" in low or "system uptime" in low:
                # "System Up Time (days,hour:min:sec):       120,07:46:07"
                # The key itself contains colons in the parenthetical, so find last ":"
                # before the big whitespace gap, or use regex
                m = re.search(r':\s{2,}(.+)', stripped)
                if m:
                    info["uptime"] = m.group(1).strip()
            elif "system mac" in low:
                # "System MAC Address:                       d4:ad:71:1f:07:63"
                m = re.search(r':\s{2,}(.+)', stripped)
                if m:
                    info["mac_address"] = m.group(1).strip()

        return info

    def _parse_interfaces_status(self, output: str) -> list[dict]:
        """Parse SG250 'show interface status' output.

        Format:
        Port     Type         Duplex  Speed Neg      ctrl State       Pressure Mode
        -------- ------------ ------  ----- -------- ---- ----------- -------- -------
        gi1      1G-Copper    Full    10    Enabled  Off  Up          Disabled On
        gi3      1G-Copper      --      --     --     --  Down           --     --
        """
        interfaces = []
        in_table = False
        for line in output.split("\n"):
            line = line.rstrip()
            if not line:
                continue
            if "--------" in line:
                in_table = True
                continue
            if not in_table:
                continue
            parts = line.split()
            if len(parts) < 3:
                continue
            name = parts[0]
            # Skip port-channel entries that are "Not Present"
            if "not" in line.lower() and "present" in line.lower():
                continue

            # Determine link state — look for Up/Down in the parts
            state = "down"
            speed = 0
            port_type = ""
            duplex = ""

            for p in parts[1:]:
                low = p.lower()
                if low in ("up",):
                    state = "up"
                elif low in ("down",):
                    state = "down"
                elif "copper" in low or "combo" in low or "fiber" in low:
                    port_type = p
                elif low in ("full", "half"):
                    duplex = low
                elif p.isdigit():
                    val = int(p)
                    if val in (10, 100, 1000, 2500, 5000, 10000):
                        speed = val * 1_000_000

            iface = {
                "index": name, "name": name, "alias": port_type,
                "oper_status": state, "admin_status": "up",
                "speed": speed, "mtu": 1500, "duplex": duplex,
                "in_octets": 0, "out_octets": 0, "in_errors": 0, "out_errors": 0,
            }
            interfaces.append(iface)
        return interfaces

    def _parse_mac_table(self, output: str) -> list[dict]:
        entries = []
        in_table = False
        for line in output.split("\n"):
            line = line.rstrip()
            if "--------" in line or "----" in line:
                in_table = True
                continue
            if not in_table or not line.strip():
                continue
            parts = line.split()
            if len(parts) < 4:
                continue
            mac = ""
            vlan = ""
            port = ""
            status = "learned"
            for p in parts:
                if re.match(r'^[0-9a-fA-F]{2}([:-])[0-9a-fA-F]{2}(\1[0-9a-fA-F]{2}){4}$', p):
                    mac = p.upper()
                elif re.match(r'^[0-9a-fA-F]{4}\.[0-9a-fA-F]{4}\.[0-9a-fA-F]{4}$', p):
                    raw = p.replace(".", "")
                    mac = ":".join(raw[i:i+2] for i in range(0, 12, 2)).upper()
                elif p.lower() in ("dynamic", "static", "self", "learned", "management"):
                    status = p.lower()
                elif re.match(r'^(gi|fa|te|po|lag)\d', p, re.IGNORECASE):
                    port = p
                elif p.isdigit() and not vlan:
                    vlan = p
            if mac:
                entries.append({"mac": mac, "if_index": port, "bridge_port": port, "status": status, "vlan": vlan})
        return entries

    def _parse_vlans(self, output: str) -> list[dict]:
        vlans = []
        in_table = False
        for line in output.split("\n"):
            line = line.rstrip()
            if "--------" in line or "----" in line:
                in_table = True
                continue
            if not in_table or not line.strip():
                continue
            parts = line.split()
            if not parts:
                continue
            try:
                vid = int(parts[0])
            except ValueError:
                continue
            name = parts[1] if len(parts) > 1 else f"VLAN {vid}"
            if name.lower() in ("active", "suspend", "static", "dynamic"):
                name = f"VLAN {vid}"
            vlans.append({"id": vid, "name": name})
        vlans.sort(key=lambda v: v["id"])
        return vlans


# ---------------------------------------------------------------------------
# SNMP Client (kept for backwards compatibility)
# ---------------------------------------------------------------------------

class SwitchSnmpClient:
    """SNMP client for Cisco SF300/SG300 managed switches."""

    def __init__(self):
        self._host = ""
        self._community = "public"
        self._port = 161

    def update_config(self, host: str, community: str = "public", port: int = 161):
        self._host = host
        self._community = community or "public"
        self._port = port

    @property
    def is_configured(self) -> bool:
        return bool(self._host)

    def _make_transport(self):
        snmp = _require_pysnmp()
        return snmp["UdpTransportTarget"]((self._host, self._port), timeout=10, retries=2)

    async def _get_scalar(self, *oids: str) -> dict[str, str]:
        if not self.is_configured:
            raise RuntimeError("Switch not configured")
        snmp = _require_pysnmp()
        engine = snmp["SnmpEngine"]()
        obj_types = [snmp["ObjectType"](snmp["ObjectIdentity"](oid)) for oid in oids]
        transport = self._make_transport()
        error_indication, error_status, _error_index, var_binds = await snmp["get_cmd"](
            engine,
            snmp["CommunityData"](self._community),
            transport,
            snmp["ContextData"](),
            *obj_types,
        )
        engine.closeDispatcher()
        if error_indication:
            raise RuntimeError(f"SNMP error: {error_indication}")
        if error_status:
            raise RuntimeError(f"SNMP error: {error_status.prettyPrint()}")
        result = {}
        for oid, val in var_binds:
            result[str(oid)] = val.prettyPrint()
        return result

    async def _walk_table(self, oid: str) -> list[tuple[str, str]]:
        if not self.is_configured:
            raise RuntimeError("Switch not configured")
        snmp = _require_pysnmp()
        engine = snmp["SnmpEngine"]()
        transport = self._make_transport()
        results = []
        async for error_indication, error_status, _error_index, var_binds in snmp["bulk_walk_cmd"](
            engine,
            snmp["CommunityData"](self._community),
            transport,
            snmp["ContextData"](),
            0, 25,
            snmp["ObjectType"](snmp["ObjectIdentity"](oid)),
        ):
            if error_indication or error_status:
                break
            for oid_obj, val in var_binds:
                results.append((str(oid_obj), val.prettyPrint()))
        engine.closeDispatcher()
        return results

    async def get_system_info(self) -> dict:
        oids = {
            "1.3.6.1.2.1.1.1.0": "description",
            "1.3.6.1.2.1.1.3.0": "uptime",
            "1.3.6.1.2.1.1.4.0": "contact",
            "1.3.6.1.2.1.1.5.0": "hostname",
            "1.3.6.1.2.1.1.6.0": "location",
        }
        raw = await self._get_scalar(*oids.keys())
        result = {}
        for oid_str, field_name in oids.items():
            result[field_name] = raw.get(oid_str, "")
        try:
            ticks = int(result.get("uptime", "0"))
            seconds = ticks // 100
            days, rem = divmod(seconds, 86400)
            hours, rem = divmod(rem, 3600)
            minutes, _ = divmod(rem, 60)
            result["uptime"] = f"{days}d {hours}h {minutes}m"
            result["uptime_seconds"] = seconds
        except (ValueError, TypeError):
            pass
        return result

    async def get_interfaces(self) -> list[dict]:
        prefixes = {
            "1.3.6.1.2.1.2.2.1.2":  "name",
            "1.3.6.1.2.1.2.2.1.4":  "mtu",
            "1.3.6.1.2.1.2.2.1.5":  "speed",
            "1.3.6.1.2.1.2.2.1.7":  "admin_status",
            "1.3.6.1.2.1.2.2.1.8":  "oper_status",
            "1.3.6.1.2.1.2.2.1.10": "in_octets",
            "1.3.6.1.2.1.2.2.1.14": "in_errors",
            "1.3.6.1.2.1.2.2.1.16": "out_octets",
            "1.3.6.1.2.1.2.2.1.20": "out_errors",
        }
        interfaces: dict[str, dict] = {}
        for oid_prefix, field in prefixes.items():
            rows = await self._walk_table(oid_prefix)
            for oid_str, val in rows:
                idx = oid_str[len(oid_prefix) + 1:]
                if idx not in interfaces:
                    interfaces[idx] = {"index": idx}
                interfaces[idx][field] = val

        alias_rows = await self._walk_table("1.3.6.1.2.1.31.1.1.1.18")
        for oid_str, val in alias_rows:
            idx = oid_str.split(".")[-1]
            if idx in interfaces and val:
                interfaces[idx]["alias"] = val

        for oid_prefix, field in [
            ("1.3.6.1.2.1.31.1.1.1.6", "in_octets_hc"),
            ("1.3.6.1.2.1.31.1.1.1.10", "out_octets_hc"),
        ]:
            rows = await self._walk_table(oid_prefix)
            for oid_str, val in rows:
                idx = oid_str[len(oid_prefix) + 1:]
                if idx in interfaces:
                    try:
                        interfaces[idx][field] = int(val)
                    except (ValueError, TypeError):
                        pass

        status_map = {"1": "up", "2": "down", "3": "testing"}
        result = []
        for iface in interfaces.values():
            iface["admin_status"] = status_map.get(iface.get("admin_status", ""), iface.get("admin_status", ""))
            iface["oper_status"] = status_map.get(iface.get("oper_status", ""), iface.get("oper_status", ""))
            for num_field in ("mtu", "speed", "in_octets", "out_octets", "in_errors", "out_errors"):
                try:
                    iface[num_field] = int(iface.get(num_field, 0))
                except (ValueError, TypeError):
                    iface[num_field] = 0
            if "in_octets_hc" in iface:
                iface["in_octets"] = iface.pop("in_octets_hc")
            if "out_octets_hc" in iface:
                iface["out_octets"] = iface.pop("out_octets_hc")
            result.append(iface)
        return result

    async def get_mac_table(self) -> list[dict]:
        mac_rows = await self._walk_table("1.3.6.1.2.1.17.4.3.1.1")
        port_rows = await self._walk_table("1.3.6.1.2.1.17.4.3.1.2")
        status_rows = await self._walk_table("1.3.6.1.2.1.17.4.3.1.3")

        bridge_port_map: dict[str, str] = {}
        bp_rows = await self._walk_table("1.3.6.1.2.1.17.1.4.1.2")
        for oid_str, val in bp_rows:
            bp_idx = oid_str.split(".")[-1]
            bridge_port_map[bp_idx] = val

        entries: dict[str, dict] = {}
        prefix_len = len("1.3.6.1.2.1.17.4.3.1.1.")
        for oid_str, val in mac_rows:
            idx = oid_str[prefix_len:]
            mac = val
            if mac.startswith("0x") and len(mac) >= 14:
                mac = ":".join(mac[2:][i:i+2] for i in range(0, 12, 2))
            entries[idx] = {"mac": mac.upper()}

        prefix_len = len("1.3.6.1.2.1.17.4.3.1.2.")
        for oid_str, val in port_rows:
            idx = oid_str[prefix_len:]
            if idx in entries:
                entries[idx]["bridge_port"] = val
                entries[idx]["if_index"] = bridge_port_map.get(val, val)

        status_map = {"1": "other", "2": "invalid", "3": "learned", "4": "self", "5": "mgmt"}
        prefix_len = len("1.3.6.1.2.1.17.4.3.1.3.")
        for oid_str, val in status_rows:
            idx = oid_str[prefix_len:]
            if idx in entries:
                entries[idx]["status"] = status_map.get(val, val)

        return list(entries.values())

    async def get_vlans(self) -> list[dict]:
        name_rows = await self._walk_table("1.3.6.1.2.1.17.7.1.4.3.1.1")
        vlans = []
        prefix_len = len("1.3.6.1.2.1.17.7.1.4.3.1.1.")
        for oid_str, val in name_rows:
            vlan_id = oid_str[prefix_len:]
            try:
                vid = int(vlan_id)
            except ValueError:
                continue
            vlans.append({"id": vid, "name": val or f"VLAN {vid}"})
        if not vlans:
            vlan_rows = await self._walk_table("1.3.6.1.2.1.17.7.1.4.2.1.3")
            seen = set()
            for oid_str, val in vlan_rows:
                try:
                    vid = int(oid_str.split(".")[-1])
                    if vid not in seen:
                        seen.add(vid)
                        vlans.append({"id": vid, "name": f"VLAN {vid}"})
                except ValueError:
                    pass
        vlans.sort(key=lambda v: v["id"])
        return vlans

    async def get_poe_status(self) -> list[dict]:
        admin_rows = await self._walk_table("1.3.6.1.2.1.105.1.1.1.3")
        detect_rows = await self._walk_table("1.3.6.1.2.1.105.1.1.1.6")
        power_rows = await self._walk_table("1.3.6.1.2.1.105.1.1.1.7")

        if not admin_rows:
            return []

        entries: dict[str, dict] = {}
        for oid_str, val in admin_rows:
            parts = oid_str.split(".")
            idx = ".".join(parts[-2:])
            entries[idx] = {"port": parts[-1], "admin": "enabled" if val == "1" else "disabled"}

        detect_map = {
            "1": "disabled", "2": "searching", "3": "deliveringPower",
            "4": "fault", "5": "test", "6": "otherFault",
        }
        for oid_str, val in detect_rows:
            parts = oid_str.split(".")
            idx = ".".join(parts[-2:])
            if idx in entries:
                entries[idx]["detection"] = detect_map.get(val, val)

        for oid_str, val in power_rows:
            parts = oid_str.split(".")
            idx = ".".join(parts[-2:])
            if idx in entries:
                try:
                    entries[idx]["power_mw"] = int(val)
                except (ValueError, TypeError):
                    pass

        return list(entries.values())


# ---------------------------------------------------------------------------
# Unified client wrapper — picks SSH or SNMP based on config
# ---------------------------------------------------------------------------

class SwitchClient:
    """Unified switch client that delegates to SSH or SNMP backend."""

    def __init__(self):
        self._mode = ""  # "ssh" or "snmp"
        self._ssh = SwitchSshClient()
        self._snmp = SwitchSnmpClient()

    def update_config(self, host: str = "", mode: str = "ssh",
                      # SSH fields
                      username: str = "", password: str = "",
                      ssh_port: int = 22, enable_password: str = "",
                      # SNMP fields
                      community: str = "public", snmp_port: int = 161):
        self._mode = mode
        # Always configure both so switching modes works without re-entering the host
        self._ssh.update_config(host=host, username=username, password=password,
                                 port=ssh_port, enable_password=enable_password)
        self._snmp.update_config(host=host, community=community, port=snmp_port)

    @property
    def is_configured(self) -> bool:
        if self._mode == "ssh":
            return self._ssh.is_configured
        elif self._mode == "snmp":
            return self._snmp.is_configured
        return False

    @property
    def _host(self) -> str:
        if self._mode == "ssh":
            return self._ssh._host
        return self._snmp._host

    @property
    def mode(self) -> str:
        return self._mode

    def _active(self):
        if self._mode == "ssh":
            return self._ssh
        return self._snmp

    async def test_connection(self) -> dict:
        if self._mode == "ssh":
            return await self._ssh.test_connection()
        # SNMP test
        if not self._snmp.is_configured:
            return {"ok": False, "error": "Switch SNMP not configured"}
        try:
            system = await self._snmp.get_system_info()
            return {"ok": True, "host": self._snmp._host, "mode": "snmp", "system": system}
        except Exception as e:
            return {"ok": False, "host": self._snmp._host, "error": str(e)}

    async def get_system_info(self) -> dict:
        return await self._active().get_system_info()

    async def get_interfaces(self) -> list[dict]:
        return await self._active().get_interfaces()

    async def get_mac_table(self) -> list[dict]:
        return await self._active().get_mac_table()

    async def get_vlans(self) -> list[dict]:
        return await self._active().get_vlans()

    async def get_poe_status(self) -> list[dict]:
        return await self._active().get_poe_status()

    async def get_overview_data(self) -> dict:
        """Single-session bulk fetch for SSH mode; falls back to individual calls for SNMP."""
        if self._mode == "ssh":
            return await self._ssh.get_overview_data()
        # SNMP: call each method individually (SNMP doesn't have session overhead)
        result: dict = {"system": None, "interfaces": [], "mac_table": [], "vlans": [], "_errors": []}
        try:
            result["system"] = await self._snmp.get_system_info()
        except Exception as e:
            logger.error("SNMP overview: system info failed: %s", e, exc_info=True)
            result["_errors"].append(f"system: {e}")
        try:
            result["interfaces"] = await self._snmp.get_interfaces()
        except Exception as e:
            logger.error("SNMP overview: interfaces failed: %s", e, exc_info=True)
            result["_errors"].append(f"interfaces: {e}")
        try:
            result["mac_table"] = await self._snmp.get_mac_table()
        except Exception as e:
            logger.error("SNMP overview: mac table failed: %s", e, exc_info=True)
            result["_errors"].append(f"mac_table: {e}")
        try:
            result["vlans"] = await self._snmp.get_vlans()
        except Exception as e:
            logger.error("SNMP overview: vlans failed: %s", e, exc_info=True)
            result["_errors"].append(f"vlans: {e}")
        return result


switch_client = SwitchClient()
