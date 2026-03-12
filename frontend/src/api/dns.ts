import api from './client'
import type { DnsMonitoredDomain, DnsSnapshot, DnsChange } from '@/types'

export async function getDomains(): Promise<DnsMonitoredDomain[]> {
  const { data } = await api.get<DnsMonitoredDomain[]>('/dns/domains')
  return data
}

export async function addDomain(domain: string, subdomains?: string[], check_interval_seconds = 300): Promise<DnsMonitoredDomain> {
  const { data } = await api.post<DnsMonitoredDomain>('/dns/domains', { domain, subdomains, check_interval_seconds })
  return data
}

export async function updateDomain(id: number, updates: { is_active?: boolean; subdomains?: string[]; check_interval_seconds?: number }): Promise<DnsMonitoredDomain> {
  const { data } = await api.put<DnsMonitoredDomain>(`/dns/domains/${id}`, updates)
  return data
}

export async function deleteDomain(id: number): Promise<void> {
  await api.delete(`/dns/domains/${id}`)
}

export async function triggerCheck(id: number): Promise<void> {
  await api.post(`/dns/domains/${id}/check`)
}

export async function getLatestSnapshot(id: number): Promise<DnsSnapshot | null> {
  const { data } = await api.get<DnsSnapshot | null>(`/dns/domains/${id}/snapshots/latest`)
  return data
}

export async function getSnapshots(id: number): Promise<DnsSnapshot[]> {
  const { data } = await api.get<DnsSnapshot[]>(`/dns/domains/${id}/snapshots`)
  return data
}

export async function getDomainChanges(id: number): Promise<DnsChange[]> {
  const { data } = await api.get<DnsChange[]>(`/dns/domains/${id}/changes`)
  return data
}

export async function getAllChanges(): Promise<DnsChange[]> {
  const { data } = await api.get<DnsChange[]>('/dns/changes')
  return data
}
