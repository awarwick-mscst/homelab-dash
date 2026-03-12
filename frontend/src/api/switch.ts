import api from './client'
import type { SwitchSystemInfo, SwitchInterface, SwitchMacEntry, SwitchVlan } from '@/types'

export async function getSwitchSystem(): Promise<SwitchSystemInfo> {
  const { data } = await api.get<SwitchSystemInfo>('/switch/system')
  return data
}

export async function getSwitchInterfaces(): Promise<SwitchInterface[]> {
  const { data } = await api.get<SwitchInterface[]>('/switch/interfaces')
  return data
}

export async function getSwitchMacTable(): Promise<SwitchMacEntry[]> {
  const { data } = await api.get<SwitchMacEntry[]>('/switch/mac-table')
  return data
}

export async function getSwitchVlans(): Promise<SwitchVlan[]> {
  const { data } = await api.get<SwitchVlan[]>('/switch/vlans')
  return data
}

export async function getSwitchPoe(): Promise<Record<string, unknown>[]> {
  const { data } = await api.get('/switch/poe')
  return data
}

export async function testSwitchConnection(): Promise<{ ok: boolean; host: string; error?: string; mode?: string; output?: string; system?: SwitchSystemInfo }> {
  const { data } = await api.get('/switch/test')
  return data
}

export async function getSwitchOverview(): Promise<{
  system: SwitchSystemInfo | null
  interfaces: SwitchInterface[]
  mac_table: SwitchMacEntry[]
  vlans: SwitchVlan[]
  error?: string
  _errors?: string[]
  _debug?: Record<string, string>
}> {
  const { data } = await api.get('/switch/overview')
  return data
}
