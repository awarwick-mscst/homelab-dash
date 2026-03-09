import api from './client'
import type { Subnet, NetworkLink, TopologyLayout } from '@/types'

export async function getSubnets(): Promise<Subnet[]> {
  const { data } = await api.get<Subnet[]>('/networks/subnets')
  return data
}

export async function createSubnet(subnet: Partial<Subnet>): Promise<Subnet> {
  const { data } = await api.post<Subnet>('/networks/subnets', subnet)
  return data
}

export async function updateSubnet(id: number, subnet: Partial<Subnet>): Promise<Subnet> {
  const { data } = await api.put<Subnet>(`/networks/subnets/${id}`, subnet)
  return data
}

export async function deleteSubnet(id: number): Promise<void> {
  await api.delete(`/networks/subnets/${id}`)
}

export async function getLinks(): Promise<NetworkLink[]> {
  const { data } = await api.get<NetworkLink[]>('/networks/links')
  return data
}

export async function createLink(link: Partial<NetworkLink>): Promise<NetworkLink> {
  const { data } = await api.post<NetworkLink>('/networks/links', link)
  return data
}

export async function deleteLink(id: number): Promise<void> {
  await api.delete(`/networks/links/${id}`)
}

export async function getTopology(): Promise<TopologyLayout | null> {
  const { data } = await api.get<TopologyLayout | null>('/networks/topology')
  return data
}

export async function saveTopology(layout: { name: string; layout_data: Record<string, unknown> }): Promise<TopologyLayout> {
  const { data } = await api.put<TopologyLayout>('/networks/topology', layout)
  return data
}

export async function autoLinkUnifi(): Promise<{ created: number; skipped: number; total_wireless_clients: number; total_aps: number }> {
  const { data } = await api.post('/networks/links/auto-unifi')
  return data
}

export async function autoLinkSwitch(): Promise<{ created: number; switch: string }> {
  const { data } = await api.post('/networks/links/auto-switch')
  return data
}

export async function autoLinkProxmox(): Promise<{ created: number }> {
  const { data } = await api.post('/networks/links/auto-proxmox')
  return data
}
