import api from './client'
import type { Settings } from '@/types'

export async function getSettings(): Promise<Settings> {
  const { data } = await api.get<Settings>('/settings')
  return data
}

export async function updateProxmoxServers(servers: {
  id: string
  host: string
  username?: string
  password?: string
  token_id?: string
  token_secret?: string
  verify_ssl: boolean
}[]): Promise<void> {
  await api.put('/settings/proxmox/servers', servers)
}

export async function updatePfSenseSettings(settings: {
  host: string
  mode: string
  api_key?: string
  api_secret?: string
  verify_ssl?: boolean
  community?: string
  snmp_port?: number
}): Promise<void> {
  await api.put('/settings/pfsense', settings)
}

export async function updateUniFiSettings(settings: {
  host: string
  username: string
  password: string
  site: string
  verify_ssl: boolean
}): Promise<void> {
  await api.put('/settings/unifi', settings)
}

export async function updateOllamaSettings(settings: {
  host: string
  model: string
}): Promise<void> {
  await api.put('/settings/ollama', settings)
}

export async function updateSwitchSettings(settings: {
  host: string
  community?: string
  port?: number
}): Promise<void> {
  await api.put('/settings/switch', settings)
}
