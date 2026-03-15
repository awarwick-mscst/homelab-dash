from pydantic import BaseModel


class ProxmoxServerSettings(BaseModel):
    id: str
    host: str
    username: str = ""
    password: str = ""
    token_id: str = ""
    token_secret: str = ""
    verify_ssl: bool = False


class ProxmoxSettings(BaseModel):
    host: str
    username: str = ""
    password: str = ""
    token_id: str = ""
    token_secret: str = ""
    verify_ssl: bool = False


class PfSenseSettings(BaseModel):
    host: str
    mode: str = "api"  # "api" or "snmp"
    api_key: str = ""
    api_secret: str = ""
    verify_ssl: bool = False
    community: str = ""
    snmp_port: int = 161


class SonicWallSettings(BaseModel):
    host: str
    mode: str = "api"  # "api" or "snmp"
    username: str = ""
    password: str = ""
    verify_ssl: bool = False
    port: int = 443
    community: str = ""
    snmp_port: int = 161


class UniFiSettings(BaseModel):
    host: str
    username: str
    password: str
    site: str = "default"
    verify_ssl: bool = False


class OllamaSettings(BaseModel):
    host: str
    model: str = "llama3"


class SwitchSettings(BaseModel):
    host: str
    mode: str = "ssh"  # "ssh" or "snmp"
    # SSH
    username: str = ""
    password: str = ""
    ssh_port: int = 22
    enable_password: str = ""
    # SNMP
    community: str = "public"
    snmp_port: int = 161


class ProxmoxServerInfo(BaseModel):
    id: str
    host: str
    configured: bool


class SettingsResponse(BaseModel):
    proxmox_host: str
    proxmox_token_id: str
    proxmox_configured: bool
    proxmox_servers: list[ProxmoxServerInfo] = []
    pfsense_host: str
    pfsense_configured: bool
    pfsense_mode: str
    sonicwall_host: str
    sonicwall_configured: bool
    sonicwall_mode: str
    unifi_host: str
    unifi_configured: bool
    ollama_host: str
    ollama_configured: bool
    ollama_model: str
    switch_host: str
    switch_configured: bool
    switch_mode: str = ""
    health_check_interval: int
    proxmox_poll_interval: int
