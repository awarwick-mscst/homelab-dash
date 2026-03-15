import json
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.models.app_settings import AppSetting
from app.config import settings
from app.schemas.settings import (
    ProxmoxServerSettings, PfSenseSettings, SonicWallSettings, UniFiSettings, OllamaSettings, SwitchSettings, SettingsResponse, ProxmoxServerInfo,
)
from app.services.proxmox_client import proxmox_manager
from app.services import pfsense_client as pfsense_mod
from app.services import sonicwall_client as sonicwall_mod
from app.services.unifi_client import unifi_client
from app.services.ollama_client import ollama_client
from app.services.switch_client import switch_client

router = APIRouter(prefix="/api/settings", tags=["settings"])


async def _save_setting(db: AsyncSession, key: str, value: dict | list):
    result = await db.execute(select(AppSetting).where(AppSetting.key == key))
    setting = result.scalar_one_or_none()
    if setting:
        setting.value = json.dumps(value)
    else:
        db.add(AppSetting(key=key, value=json.dumps(value)))
    await db.commit()


async def _load_setting(db: AsyncSession, key: str) -> dict | list | None:
    result = await db.execute(select(AppSetting).where(AppSetting.key == key))
    setting = result.scalar_one_or_none()
    if setting and setting.value:
        return json.loads(setting.value)
    return None


async def restore_saved_settings(db: AsyncSession):
    """Load saved integration settings on startup."""
    # Try new multi-server key first, fall back to legacy single-server key
    px_servers = await _load_setting(db, "proxmox_servers")
    if px_servers and isinstance(px_servers, list):
        for srv in px_servers:
            proxmox_manager.add_server(
                server_id=srv.get("id", ""),
                host=srv.get("host", ""),
                token_id=srv.get("token_id", ""),
                token_secret=srv.get("token_secret", ""),
                username=srv.get("username", ""),
                password=srv.get("password", ""),
                verify_ssl=srv.get("verify_ssl", False),
            )
    else:
        # Migrate legacy single-server config
        px = await _load_setting(db, "proxmox")
        if px and isinstance(px, dict):
            server_id = "default"
            proxmox_manager.add_server(
                server_id=server_id,
                host=px.get("host", ""),
                token_id=px.get("token_id", ""),
                token_secret=px.get("token_secret", ""),
                username=px.get("username", ""),
                password=px.get("password", ""),
                verify_ssl=px.get("verify_ssl", False),
            )
            # Save migrated data under the new key
            migrated = [{**px, "id": server_id}]
            await _save_setting(db, "proxmox_servers", migrated)

    pf = await _load_setting(db, "pfsense")
    if pf and isinstance(pf, dict):
        mode = pf.get("mode", "api")
        pfsense_mod.pfsense_mode = mode
        if mode == "snmp":
            pfsense_mod.pfsense_snmp_client.update_config(
                host=pf.get("host", ""),
                community=pf.get("community", "public"),
                port=pf.get("snmp_port", 161),
            )
        else:
            pfsense_mod.pfsense_client.update_config(
                host=pf.get("host", ""),
                api_key=pf.get("api_key", ""),
                api_secret=pf.get("api_secret", ""),
                verify_ssl=pf.get("verify_ssl", False),
            )

    sw_sonic = await _load_setting(db, "sonicwall")
    if sw_sonic and isinstance(sw_sonic, dict):
        mode = sw_sonic.get("mode", "api")
        sonicwall_mod.sonicwall_mode = mode
        if mode == "snmp":
            sonicwall_mod.sonicwall_snmp_client.update_config(
                host=sw_sonic.get("host", ""),
                community=sw_sonic.get("community", "public"),
                port=sw_sonic.get("snmp_port", 161),
            )
        else:
            sonicwall_mod.sonicwall_client.update_config(
                host=sw_sonic.get("host", ""),
                username=sw_sonic.get("username", ""),
                password=sw_sonic.get("password", ""),
                verify_ssl=sw_sonic.get("verify_ssl", False),
                port=sw_sonic.get("port", 443),
            )

    uf = await _load_setting(db, "unifi")
    if uf and isinstance(uf, dict):
        unifi_client.update_config(
            host=uf.get("host", ""),
            username=uf.get("username", ""),
            password=uf.get("password", ""),
            site=uf.get("site", "default"),
            verify_ssl=uf.get("verify_ssl", False),
        )

    ol = await _load_setting(db, "ollama")
    if ol and isinstance(ol, dict):
        ollama_client.update_config(
            host=ol.get("host", ""),
            model=ol.get("model", "llama3"),
        )

    sw = await _load_setting(db, "switch")
    if sw and isinstance(sw, dict):
        switch_client.update_config(
            host=sw.get("host", ""),
            mode=sw.get("mode", "ssh"),
            username=sw.get("username", ""),
            password=sw.get("password", ""),
            ssh_port=sw.get("ssh_port", 22),
            enable_password=sw.get("enable_password", ""),
            community=sw.get("community", "public"),
            snmp_port=sw.get("snmp_port", 161),
        )


def _pfsense_is_configured() -> bool:
    if pfsense_mod.pfsense_mode == "snmp":
        return pfsense_mod.pfsense_snmp_client.is_configured
    elif pfsense_mod.pfsense_mode == "api":
        return pfsense_mod.pfsense_client.is_configured
    return False


def _sonicwall_is_configured() -> bool:
    if sonicwall_mod.sonicwall_mode == "snmp":
        return sonicwall_mod.sonicwall_snmp_client.is_configured
    elif sonicwall_mod.sonicwall_mode == "api":
        return sonicwall_mod.sonicwall_client.is_configured
    return False


@router.get("", response_model=SettingsResponse)
async def get_settings(_: User = Depends(get_current_user)):
    servers = proxmox_manager.list_servers()
    first_host = servers[0]["host"] if servers else settings.proxmox_host
    return SettingsResponse(
        proxmox_host=first_host,
        proxmox_token_id=settings.proxmox_token_id,
        proxmox_configured=proxmox_manager.is_configured,
        proxmox_servers=[ProxmoxServerInfo(**s) for s in servers],
        pfsense_host=settings.pfsense_host,
        pfsense_configured=_pfsense_is_configured(),
        pfsense_mode=pfsense_mod.pfsense_mode,
        sonicwall_host=settings.sonicwall_host,
        sonicwall_configured=_sonicwall_is_configured(),
        sonicwall_mode=sonicwall_mod.sonicwall_mode,
        unifi_host=settings.unifi_host,
        unifi_configured=unifi_client.is_configured,
        ollama_host=ollama_client._base_url,
        ollama_configured=ollama_client.is_configured,
        ollama_model=ollama_client.model,
        switch_host=switch_client._host,
        switch_configured=switch_client.is_configured,
        switch_mode=switch_client.mode,
        health_check_interval=settings.health_check_interval,
        proxmox_poll_interval=settings.proxmox_poll_interval,
    )


@router.put("/proxmox/servers")
async def update_proxmox_servers(
    data: list[ProxmoxServerSettings],
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    # Clear existing servers and re-add from the submitted list
    existing_ids = [s["id"] for s in proxmox_manager.list_servers()]
    for sid in existing_ids:
        proxmox_manager.remove_server(sid)

    for srv in data:
        proxmox_manager.add_server(
            server_id=srv.id,
            host=srv.host,
            token_id=srv.token_id,
            token_secret=srv.token_secret,
            username=srv.username,
            password=srv.password,
            verify_ssl=srv.verify_ssl,
        )

    await _save_setting(db, "proxmox_servers", [s.model_dump() for s in data])
    return {"status": "updated", "servers": proxmox_manager.list_servers()}


@router.put("/pfsense")
async def update_pfsense_settings(
    data: PfSenseSettings,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    mode = data.mode
    pfsense_mod.pfsense_mode = mode

    if mode == "snmp":
        pfsense_mod.pfsense_snmp_client.update_config(
            host=data.host,
            community=data.community or "public",
            port=data.snmp_port,
        )
    else:
        pfsense_mod.pfsense_client.update_config(
            host=data.host,
            api_key=data.api_key,
            api_secret=data.api_secret,
            verify_ssl=data.verify_ssl,
        )

    await _save_setting(db, "pfsense", data.model_dump())
    return {"status": "updated", "mode": mode}


@router.put("/sonicwall")
async def update_sonicwall_settings(
    data: SonicWallSettings,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    mode = data.mode
    sonicwall_mod.sonicwall_mode = mode

    if mode == "snmp":
        sonicwall_mod.sonicwall_snmp_client.update_config(
            host=data.host,
            community=data.community or "public",
            port=data.snmp_port,
        )
    else:
        sonicwall_mod.sonicwall_client.update_config(
            host=data.host,
            username=data.username,
            password=data.password,
            verify_ssl=data.verify_ssl,
            port=data.port,
        )

    await _save_setting(db, "sonicwall", data.model_dump())
    return {"status": "updated", "mode": mode}


@router.put("/unifi")
async def update_unifi_settings(
    data: UniFiSettings,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    unifi_client.update_config(
        host=data.host,
        username=data.username,
        password=data.password,
        site=data.site,
        verify_ssl=data.verify_ssl,
    )
    await _save_setting(db, "unifi", data.model_dump())
    return {"status": "updated"}


@router.put("/ollama")
async def update_ollama_settings(
    data: OllamaSettings,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    ollama_client.update_config(host=data.host, model=data.model)
    await _save_setting(db, "ollama", data.model_dump())
    return {"status": "updated"}


@router.put("/switch")
async def update_switch_settings(
    data: SwitchSettings,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    switch_client.update_config(
        host=data.host,
        mode=data.mode,
        username=data.username,
        password=data.password,
        ssh_port=data.ssh_port,
        enable_password=data.enable_password,
        community=data.community,
        snmp_port=data.snmp_port,
    )
    await _save_setting(db, "switch", data.model_dump())
    return {"status": "updated"}
