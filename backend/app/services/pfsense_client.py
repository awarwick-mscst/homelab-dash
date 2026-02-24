import httpx
from app.config import settings


class PfSenseClient:
    def __init__(self):
        self._base_url = ""
        self._headers = {}
        self._verify_ssl = False
        self._configure()

    def _configure(self):
        if settings.pfsense_host:
            self._base_url = f"https://{settings.pfsense_host}/api/v2"
            self._headers = {
                "X-API-Key": settings.pfsense_api_key,
                "X-API-Secret": settings.pfsense_api_secret,
            }
            self._verify_ssl = settings.pfsense_verify_ssl

    def update_config(self, host: str, api_key: str, api_secret: str, verify_ssl: bool = False):
        self._base_url = f"https://{host}/api/v2"
        self._headers = {
            "X-API-Key": api_key,
            "X-API-Secret": api_secret,
        }
        self._verify_ssl = verify_ssl

    @property
    def is_configured(self) -> bool:
        return bool(self._base_url and self._headers.get("X-API-Key"))

    async def _get(self, path: str) -> dict:
        if not self.is_configured:
            raise RuntimeError("pfSense not configured")
        async with httpx.AsyncClient(verify=self._verify_ssl) as client:
            resp = await client.get(f"{self._base_url}{path}", headers=self._headers, timeout=15)
            resp.raise_for_status()
            return resp.json()

    async def get_interfaces(self) -> dict:
        return await self._get("/interface")

    async def get_firewall_rules(self) -> dict:
        return await self._get("/firewall/rule")

    async def get_dhcp_leases(self) -> dict:
        return await self._get("/dhcp/lease")

    async def get_gateways(self) -> dict:
        return await self._get("/routing/gateway")

    async def get_openvpn_status(self) -> dict:
        return await self._get("/openvpn/server")

    async def get_system_info(self) -> dict:
        return await self._get("/system/info")


pfsense_client = PfSenseClient()
