import httpx
from app.config import settings


class ProxmoxClient:
    def __init__(self):
        self._base_url = ""
        self._headers = {}
        self._cookies = {}
        self._verify_ssl = False
        self._auth_mode = ""  # "token" or "password"
        self._username = ""
        self._password = ""
        self._configure()

    def _configure(self):
        if settings.proxmox_host:
            self._base_url = f"https://{settings.proxmox_host}:8006/api2/json"
            self._verify_ssl = settings.proxmox_verify_ssl
            if settings.proxmox_token_id and settings.proxmox_token_secret:
                self._auth_mode = "token"
                self._headers = {
                    "Authorization": f"PVEAPIToken={settings.proxmox_token_id}={settings.proxmox_token_secret}"
                }

    def update_config(self, host: str, token_id: str = "", token_secret: str = "",
                      username: str = "", password: str = "", verify_ssl: bool = False):
        self._base_url = f"https://{host}:8006/api2/json"
        self._verify_ssl = verify_ssl
        self._cookies = {}
        if token_id and token_secret:
            self._auth_mode = "token"
            self._headers = {
                "Authorization": f"PVEAPIToken={token_id}={token_secret}"
            }
            self._username = ""
            self._password = ""
        elif username and password:
            self._auth_mode = "password"
            self._headers = {}
            self._username = username
            self._password = password
        else:
            self._auth_mode = ""
            self._headers = {}

    @property
    def is_configured(self) -> bool:
        return bool(self._base_url and self._auth_mode)

    async def _authenticate(self):
        """Get a ticket using username/password."""
        async with httpx.AsyncClient(verify=self._verify_ssl) as client:
            resp = await client.post(
                f"{self._base_url}/access/ticket",
                data={"username": self._username, "password": self._password},
                timeout=15,
            )
            resp.raise_for_status()
            data = resp.json()["data"]
            self._cookies = {"PVEAuthCookie": data["ticket"]}
            self._headers = {"CSRFPreventionToken": data["CSRFPreventionToken"]}

    async def _ensure_auth(self):
        if self._auth_mode == "password" and not self._cookies:
            await self._authenticate()

    async def _get(self, path: str) -> dict:
        if not self.is_configured:
            raise RuntimeError("Proxmox not configured")
        await self._ensure_auth()
        async with httpx.AsyncClient(verify=self._verify_ssl) as client:
            resp = await client.get(
                f"{self._base_url}{path}", headers=self._headers,
                cookies=self._cookies, timeout=15,
            )
            if resp.status_code == 401 and self._auth_mode == "password":
                await self._authenticate()
                resp = await client.get(
                    f"{self._base_url}{path}", headers=self._headers,
                    cookies=self._cookies, timeout=15,
                )
            resp.raise_for_status()
            return resp.json().get("data", {})

    async def _post(self, path: str, data: dict | None = None) -> dict:
        if not self.is_configured:
            raise RuntimeError("Proxmox not configured")
        await self._ensure_auth()
        async with httpx.AsyncClient(verify=self._verify_ssl) as client:
            resp = await client.post(
                f"{self._base_url}{path}", headers=self._headers,
                cookies=self._cookies, data=data, timeout=15,
            )
            if resp.status_code == 401 and self._auth_mode == "password":
                await self._authenticate()
                resp = await client.post(
                    f"{self._base_url}{path}", headers=self._headers,
                    cookies=self._cookies, data=data, timeout=15,
                )
            resp.raise_for_status()
            return resp.json().get("data", {})

    async def get_nodes(self) -> list[dict]:
        return await self._get("/nodes")

    async def get_node_status(self, node: str) -> dict:
        return await self._get(f"/nodes/{node}/status")

    async def get_vms(self, node: str) -> list[dict]:
        return await self._get(f"/nodes/{node}/qemu")

    async def get_containers(self, node: str) -> list[dict]:
        return await self._get(f"/nodes/{node}/lxc")

    async def get_vm_status(self, node: str, vmid: int) -> dict:
        return await self._get(f"/nodes/{node}/qemu/{vmid}/status/current")

    async def get_container_status(self, node: str, vmid: int) -> dict:
        return await self._get(f"/nodes/{node}/lxc/{vmid}/status/current")

    async def vm_action(self, node: str, vmid: int, action: str) -> dict:
        return await self._post(f"/nodes/{node}/qemu/{vmid}/status/{action}")

    async def container_action(self, node: str, vmid: int, action: str) -> dict:
        return await self._post(f"/nodes/{node}/lxc/{vmid}/status/{action}")

    async def get_cluster_resources(self) -> list[dict]:
        return await self._get("/cluster/resources")


proxmox_client = ProxmoxClient()
