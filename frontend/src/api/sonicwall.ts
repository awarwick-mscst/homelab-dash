import api from './client'
import type { SonicWallOverview } from '@/types'

export async function getMode(): Promise<{ mode: string }> {
  const { data } = await api.get('/sonicwall/mode')
  return data
}

export async function getOverview(): Promise<SonicWallOverview> {
  const { data } = await api.get('/sonicwall/overview')
  return data
}

export async function getSystemInfo(): Promise<Record<string, unknown>> {
  const { data } = await api.get('/sonicwall/system')
  return data
}

export async function getInterfaces(): Promise<Record<string, unknown>[]> {
  const { data } = await api.get('/sonicwall/interfaces')
  return data
}

export async function getArpTable(): Promise<Record<string, unknown>[]> {
  const { data } = await api.get('/sonicwall/arp')
  return data
}

export async function getVpnStatus(): Promise<Record<string, unknown>> {
  const { data } = await api.get('/sonicwall/vpn')
  return data
}

export async function getSecurityServices(): Promise<Record<string, unknown>> {
  const { data } = await api.get('/sonicwall/security-services')
  return data
}

export async function getLicense(): Promise<Record<string, unknown>> {
  const { data } = await api.get('/sonicwall/license')
  return data
}

export async function testConnection(): Promise<Record<string, unknown>> {
  const { data } = await api.get('/sonicwall/test')
  return data
}
