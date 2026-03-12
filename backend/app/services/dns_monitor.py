import json
import logging
from datetime import datetime, timezone

import dns.asyncresolver
import dns.exception
import dns.resolver
import dns.rdatatype
from sqlalchemy import select

from app.database import async_session
from app.models.dns import DnsMonitoredDomain, DnsSnapshot, DnsChange
from app.services.ws_manager import ws_manager

logger = logging.getLogger(__name__)

# Record types to check per host
# Root domain: A, MX, TXT (CNAME can't exist on root)
# Subdomains: A, CNAME, MX, TXT
ROOT_RECORD_TYPES = ["A", "MX", "TXT"]
SUB_RECORD_TYPES = ["A", "CNAME", "MX", "TXT"]


async def resolve_host(host: str, record_types: list[str]) -> dict[str, list]:
    """Query DNS record types for a single hostname and return structured results."""
    resolver = dns.asyncresolver.Resolver()
    resolver.nameservers = ["1.1.1.1", "8.8.8.8", "208.67.222.222"]
    resolver.lifetime = 10

    records: dict[str, list] = {}

    for rtype in record_types:
        try:
            answer = await resolver.resolve(host, rtype)
            values = []
            for rdata in answer:
                if rtype == "MX":
                    values.append({
                        "priority": rdata.preference,
                        "exchange": str(rdata.exchange).rstrip("."),
                    })
                elif rtype == "TXT":
                    txt = b"".join(rdata.strings).decode("utf-8", errors="replace")
                    values.append(txt)
                elif rtype == "CNAME":
                    values.append(str(rdata.target).rstrip("."))
                else:
                    values.append(str(rdata).rstrip("."))

            if values:
                records[rtype] = values
        except (dns.resolver.NXDOMAIN, dns.resolver.NoAnswer,
                dns.resolver.NoNameservers):
            continue
        except dns.exception.Timeout:
            logger.warning("DNS timeout querying %s %s", rtype, host)
            continue
        except Exception as e:
            logger.warning("DNS error querying %s %s: %s", rtype, host, e)
            continue

    return records


async def resolve_domain_full(domain: str, subdomains: list[str] | None) -> dict[str, dict]:
    """Resolve the root domain and all subdomains.

    Returns a dict keyed by hostname:
    {
        "machome.us": {"A": ["1.2.3.4"], "MX": [...], "TXT": [...]},
        "www.machome.us": {"CNAME": ["machome.us"]},
        "home.machome.us": {"A": ["1.2.3.4"], "CNAME": [...]},
    }
    """
    all_records: dict[str, dict] = {}

    # Resolve root domain
    root_records = await resolve_host(domain, ROOT_RECORD_TYPES)
    if root_records:
        all_records[domain] = root_records

    # Resolve each subdomain
    for sub in (subdomains or []):
        sub = sub.strip().lower()
        if not sub:
            continue
        # Allow either "www" or "www.machome.us" format
        if "." in sub and sub.endswith(f".{domain}"):
            fqdn = sub
        else:
            fqdn = f"{sub}.{domain}"

        sub_records = await resolve_host(fqdn, SUB_RECORD_TYPES)
        if sub_records:
            all_records[fqdn] = sub_records

    return all_records


def diff_records(old_records: dict | None, new_records: dict | None) -> list[dict]:
    """Compare two snapshots and return a list of changes.

    Snapshots are keyed by hostname, then by record type.
    """
    old = old_records or {}
    new = new_records or {}
    changes: list[dict] = []

    all_hosts = sorted(set(list(old.keys()) + list(new.keys())))

    for host in all_hosts:
        old_host = old.get(host, {})
        new_host = new.get(host, {})

        all_types = sorted(set(list(old_host.keys()) + list(new_host.keys())))

        for rtype in all_types:
            old_vals = old_host.get(rtype)
            new_vals = new_host.get(rtype)

            old_json = json.dumps(old_vals, sort_keys=True) if old_vals else None
            new_json = json.dumps(new_vals, sort_keys=True) if new_vals else None

            if old_json == new_json:
                continue

            if old_vals and not new_vals:
                change_type = "removed"
            elif not old_vals and new_vals:
                change_type = "added"
            else:
                change_type = "modified"

            changes.append({
                "host": host,
                "record_type": rtype,
                "change_type": change_type,
                "old_value": old_json,
                "new_value": new_json,
            })

    return changes


async def check_single_domain(domain_id: int):
    """Run a DNS check for a single domain and store the snapshot + changes."""
    async with async_session() as db:
        domain = await db.get(DnsMonitoredDomain, domain_id)
        if not domain:
            return

        await _check_domain(db, domain)
        await db.commit()


async def check_all_domains():
    """Scheduled task: check all active monitored domains."""
    async with async_session() as db:
        result = await db.execute(
            select(DnsMonitoredDomain).where(DnsMonitoredDomain.is_active == True)
        )
        domains = result.scalars().all()

        for domain in domains:
            try:
                await _check_domain(db, domain)
            except Exception as e:
                logger.error("DNS check failed for %s: %s", domain.domain, e, exc_info=True)

        await db.commit()


async def _check_domain(db, domain: DnsMonitoredDomain):
    """Resolve a domain + subdomains, create a snapshot, and detect changes."""
    error_msg = None
    try:
        records = await resolve_domain_full(domain.domain, domain.subdomains)
    except Exception as e:
        logger.error("DNS resolution failed for %s: %s", domain.domain, e)
        records = {}
        error_msg = str(e)

    # Create snapshot
    snapshot = DnsSnapshot(
        domain_id=domain.id,
        records=records,
        error_message=error_msg,
        created_at=datetime.now(timezone.utc),
    )
    db.add(snapshot)
    await db.flush()

    # Get previous snapshot for diff
    prev_result = await db.execute(
        select(DnsSnapshot)
        .where(DnsSnapshot.domain_id == domain.id, DnsSnapshot.id != snapshot.id)
        .order_by(DnsSnapshot.created_at.desc())
        .limit(1)
    )
    prev_snapshot = prev_result.scalar_one_or_none()

    if prev_snapshot:
        changes = diff_records(prev_snapshot.records, records)
        for change in changes:
            db.add(DnsChange(
                domain_id=domain.id,
                snapshot_id=snapshot.id,
                host=change["host"],
                record_type=change["record_type"],
                change_type=change["change_type"],
                old_value=change["old_value"],
                new_value=change["new_value"],
                created_at=datetime.now(timezone.utc),
            ))

        if changes:
            logger.info("DNS changes detected for %s: %d changes", domain.domain, len(changes))
            await ws_manager.broadcast({
                "type": "dns_change",
                "domain": domain.domain,
                "domain_id": domain.id,
                "changes": len(changes),
            })
