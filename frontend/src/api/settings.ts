import api from './client'
import type { Settings } from '@/types'

export async function getSettings(): Promise<Settings> {
  const { data } = await api.get<Settings>('/settings')
  return data
}

export async function updateProxmoxSettings(settings: {
  host: string
  token_id: string
  token_secret: string
  verify_ssl: boolean
}): Promise<void> {
  await api.put('/settings/proxmox', settings)
}

export async function updatePfSenseSettings(settings: {
  host: string
  api_key: string
  api_secret: string
  verify_ssl: boolean
}): Promise<void> {
  await api.put('/settings/pfsense', settings)
}
