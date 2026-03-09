from pydantic_settings import BaseSettings
from pathlib import Path


class Settings(BaseSettings):
    app_name: str = "Homelab Dashboard"
    debug: bool = False

    # Database
    database_url: str = "sqlite+aiosqlite:///./homelab.db"

    # JWT
    secret_key: str = "change-me-in-production-use-openssl-rand-hex-32"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 1440  # 24 hours

    # Proxmox
    proxmox_host: str = ""
    proxmox_token_id: str = ""
    proxmox_token_secret: str = ""
    proxmox_verify_ssl: bool = False

    # pfSense
    pfsense_host: str = ""
    pfsense_api_key: str = ""
    pfsense_api_secret: str = ""
    pfsense_verify_ssl: bool = False
    pfsense_mode: str = ""  # "api" or "snmp"
    pfsense_snmp_community: str = "public"
    pfsense_snmp_port: int = 161

    # UniFi
    unifi_host: str = ""
    unifi_username: str = ""
    unifi_password: str = ""
    unifi_site: str = "default"
    unifi_verify_ssl: bool = False

    # Ollama
    ollama_host: str = ""
    ollama_model: str = "llama3"

    # Scanning
    nmap_path: str = "/usr/bin/nmap"

    # Background tasks
    health_check_interval: int = 60
    proxmox_poll_interval: int = 120

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
