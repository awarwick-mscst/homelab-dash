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

    # Scanning
    nmap_path: str = "/usr/bin/nmap"

    # Background tasks
    health_check_interval: int = 60
    proxmox_poll_interval: int = 120

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
