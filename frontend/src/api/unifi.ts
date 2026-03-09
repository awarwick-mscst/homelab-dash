import api from './client'
import type { UniFiDevice, UniFiClient, UniFiWlan, UniFiHealth } from '@/types'

export async function getDevices(): Promise<UniFiDevice[]> {
  const { data } = await api.get<UniFiDevice[]>('/unifi/devices')
  return data
}

export async function getClients(): Promise<UniFiClient[]> {
  const { data } = await api.get<UniFiClient[]>('/unifi/clients')
  return data
}

export async function getWlanNetworks(): Promise<UniFiWlan[]> {
  const { data } = await api.get<UniFiWlan[]>('/unifi/wlan')
  return data
}

export async function getHealth(): Promise<UniFiHealth[]> {
  const { data } = await api.get<UniFiHealth[]>('/unifi/health')
  return data
}
