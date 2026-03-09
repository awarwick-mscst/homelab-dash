import httpx
from app.config import settings


class UniFiClient:
    def __init__(self):
        self._base_url = ""
        self._username = ""
        self._password = ""
        self._site = "default"
        self._verify_ssl = False
        self._cookies = {}
        self._configure()

    def _configure(self):
        if settings.unifi_host:
            self._base_url = f"https://{settings.unifi_host}:8443"
            self._username = settings.unifi_username
            self._password = settings.unifi_password
            self._site = settings.unifi_site or "default"
            self._verify_ssl = settings.unifi_verify_ssl

    def update_config(self, host: str, username: str, password: str,
                      site: str = "default", verify_ssl: bool = False):
        self._base_url = f"https://{host}:8443" if host else ""
        self._username = username
        self._password = password
        self._site = site or "default"
        self._verify_ssl = verify_ssl
        self._cookies = {}

    @property
    def is_configured(self) -> bool:
        return bool(self._base_url and self._username and self._password)

    async def _authenticate(self):
        async with httpx.AsyncClient(verify=self._verify_ssl) as client:
            resp = await client.post(
                f"{self._base_url}/api/login",
                json={"username": self._username, "password": self._password},
                timeout=15,
            )
            resp.raise_for_status()
            self._cookies = dict(resp.cookies)

    async def _get(self, path: str) -> list | dict:
        if not self.is_configured:
            raise RuntimeError("UniFi not configured")
        if not self._cookies:
            await self._authenticate()
        async with httpx.AsyncClient(verify=self._verify_ssl) as client:
            resp = await client.get(
                f"{self._base_url}{path}",
                cookies=self._cookies,
                timeout=15,
            )
            if resp.status_code == 401:
                await self._authenticate()
                resp = await client.get(
                    f"{self._base_url}{path}",
                    cookies=self._cookies,
                    timeout=15,
                )
            resp.raise_for_status()
            data = resp.json()
            return data.get("data", data)

    async def get_sites(self) -> list[dict]:
        return await self._get("/api/self/sites")

    async def get_devices(self) -> list[dict]:
        return await self._get(f"/api/s/{self._site}/stat/device")

    async def get_clients(self) -> list[dict]:
        return await self._get(f"/api/s/{self._site}/stat/sta")

    async def get_wlan_networks(self) -> list[dict]:
        return await self._get(f"/api/s/{self._site}/rest/wlanconf")

    async def get_health(self) -> list[dict]:
        return await self._get(f"/api/s/{self._site}/stat/health")


unifi_client = UniFiClient()
