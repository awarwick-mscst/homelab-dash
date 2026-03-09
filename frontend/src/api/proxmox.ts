import api from './client'
import type { ProxmoxNode, ProxmoxVM, ProxmoxServer } from '@/types'

export async function getServers(): Promise<ProxmoxServer[]> {
  const { data } = await api.get<ProxmoxServer[]>('/proxmox/servers')
  return data
}

export async function getNodes(serverId: string): Promise<ProxmoxNode[]> {
  const { data } = await api.get<ProxmoxNode[]>(`/proxmox/${serverId}/nodes`)
  return data
}

export async function getNodeStatus(serverId: string, node: string): Promise<Record<string, unknown>> {
  const { data } = await api.get(`/proxmox/${serverId}/nodes/${node}/status`)
  return data
}

export async function getVMs(serverId: string, node: string): Promise<ProxmoxVM[]> {
  const { data } = await api.get<ProxmoxVM[]>(`/proxmox/${serverId}/nodes/${node}/vms`)
  return data
}

export async function getContainers(serverId: string, node: string): Promise<ProxmoxVM[]> {
  const { data } = await api.get<ProxmoxVM[]>(`/proxmox/${serverId}/nodes/${node}/containers`)
  return data
}

export async function getGuests(serverId: string, node: string): Promise<ProxmoxVM[]> {
  const { data } = await api.get<ProxmoxVM[]>(`/proxmox/${serverId}/nodes/${node}/guests`)
  return data
}

export async function vmAction(serverId: string, node: string, vmid: number, action: string): Promise<void> {
  await api.post(`/proxmox/${serverId}/nodes/${node}/qemu/${vmid}/${action}`)
}

export async function containerAction(serverId: string, node: string, vmid: number, action: string): Promise<void> {
  await api.post(`/proxmox/${serverId}/nodes/${node}/lxc/${vmid}/${action}`)
}

export async function getResources(serverId: string): Promise<Record<string, unknown>[]> {
  const { data } = await api.get(`/proxmox/${serverId}/resources`)
  return data
}

export async function autoLinkDevices(serverId: string): Promise<{ linked: number }> {
  const { data } = await api.post(`/proxmox/${serverId}/auto-link`)
  return data
}

export async function linkDevice(data: {
  device_id: number
  server_id: string
  node: string
  vmid: number
  type: string
}): Promise<void> {
  await api.post('/proxmox/link-device', data)
}

export async function unlinkDevice(deviceId: number): Promise<void> {
  await api.delete(`/proxmox/link-device/${deviceId}`)
}
