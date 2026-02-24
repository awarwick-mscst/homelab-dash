import api from './client'
import type { Device } from '@/types'

export async function getDevices(params?: Record<string, string>): Promise<Device[]> {
  const { data } = await api.get<Device[]>('/devices', { params })
  return data
}

export async function createDevice(device: Partial<Device>): Promise<Device> {
  const { data } = await api.post<Device>('/devices', device)
  return data
}

export async function updateDevice(id: number, device: Partial<Device>): Promise<Device> {
  const { data } = await api.put<Device>(`/devices/${id}`, device)
  return data
}

export async function deleteDevice(id: number): Promise<void> {
  await api.delete(`/devices/${id}`)
}
