import api from './client'
import type { ProxmoxNode, ProxmoxVM } from '@/types'

export async function getNodes(): Promise<ProxmoxNode[]> {
  const { data } = await api.get<ProxmoxNode[]>('/proxmox/nodes')
  return data
}

export async function getNodeStatus(node: string): Promise<Record<string, unknown>> {
  const { data } = await api.get(`/proxmox/nodes/${node}/status`)
  return data
}

export async function getVMs(node: string): Promise<ProxmoxVM[]> {
  const { data } = await api.get<ProxmoxVM[]>(`/proxmox/nodes/${node}/vms`)
  return data
}

export async function getContainers(node: string): Promise<ProxmoxVM[]> {
  const { data } = await api.get<ProxmoxVM[]>(`/proxmox/nodes/${node}/containers`)
  return data
}

export async function vmAction(node: string, vmid: number, action: string): Promise<void> {
  await api.post(`/proxmox/nodes/${node}/qemu/${vmid}/${action}`)
}

export async function containerAction(node: string, vmid: number, action: string): Promise<void> {
  await api.post(`/proxmox/nodes/${node}/lxc/${vmid}/${action}`)
}

export async function getResources(): Promise<Record<string, unknown>[]> {
  const { data } = await api.get('/proxmox/resources')
  return data
}
