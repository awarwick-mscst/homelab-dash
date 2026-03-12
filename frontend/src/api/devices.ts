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

export async function toggleDeviceMonitor(
  id: number,
  data: { is_monitored: boolean; monitor_url?: string | null }
): Promise<Device> {
  const { data: result } = await api.put<Device>(`/devices/${id}/monitor`, data)
  return result
}

export async function toggleDevicePin(
  id: number,
  data: { is_pinned: boolean; pinned_port?: number | null }
): Promise<Device> {
  const { data: result } = await api.put<Device>(`/devices/${id}/pin`, data)
  return result
}

export async function getMonitoredDevices(): Promise<Device[]> {
  const { data } = await api.get<Device[]>('/devices/monitored/list')
  return data
}

export async function getSwitchPorts(): Promise<Record<string, string>> {
  const { data } = await api.get<Record<string, string>>('/devices/switch-ports')
  return data
}
