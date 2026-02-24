from pydantic import BaseModel


class ProxmoxSettings(BaseModel):
    host: str
    token_id: str
    token_secret: str
    verify_ssl: bool = False


class PfSenseSettings(BaseModel):
    host: str
    api_key: str
    api_secret: str
    verify_ssl: bool = False


class SettingsResponse(BaseModel):
    proxmox_host: str
    proxmox_token_id: str
    proxmox_configured: bool
    pfsense_host: str
    pfsense_configured: bool
    health_check_interval: int
    proxmox_poll_interval: int
