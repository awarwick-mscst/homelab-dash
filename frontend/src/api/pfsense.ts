import api from './client'
import type { PfSenseOverview } from '@/types'

export async function getInterfaces(): Promise<Record<string, unknown>[]> {
  const { data } = await api.get('/pfsense/interfaces')
  return data
}

export async function getFirewallRules(): Promise<Record<string, unknown>> {
  const { data } = await api.get('/pfsense/firewall/rules')
  return data
}

export async function getDhcpLeases(): Promise<Record<string, unknown>> {
  const { data } = await api.get('/pfsense/dhcp/leases')
  return data
}

export async function getGateways(): Promise<Record<string, unknown>[]> {
  const { data } = await api.get('/pfsense/gateways')
  return data
}

export async function getVpnStatus(): Promise<Record<string, unknown>> {
  const { data } = await api.get('/pfsense/vpn/openvpn')
  return data
}

export async function getSystemInfo(): Promise<Record<string, unknown>> {
  const { data } = await api.get('/pfsense/system')
  return data
}

export async function getArpTable(): Promise<Record<string, unknown>[]> {
  const { data } = await api.get('/pfsense/arp')
  return data
}

export async function getMode(): Promise<{ mode: string }> {
  const { data } = await api.get('/pfsense/mode')
  return data
}

export async function getOverview(): Promise<PfSenseOverview> {
  const { data } = await api.get('/pfsense/overview')
  return data
}
