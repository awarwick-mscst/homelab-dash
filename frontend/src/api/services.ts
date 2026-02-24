import api from './client'
import type { MonitoredService } from '@/types'

export async function getServices(): Promise<MonitoredService[]> {
  const { data } = await api.get<MonitoredService[]>('/services')
  return data
}

export async function createService(service: Partial<MonitoredService>): Promise<MonitoredService> {
  const { data } = await api.post<MonitoredService>('/services', service)
  return data
}

export async function updateService(id: number, service: Partial<MonitoredService>): Promise<MonitoredService> {
  const { data } = await api.put<MonitoredService>(`/services/${id}`, service)
  return data
}

export async function deleteService(id: number): Promise<void> {
  await api.delete(`/services/${id}`)
}
