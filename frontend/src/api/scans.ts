import api from './client'
import type { ScanJob, ScanProfile, ScanSchedule } from '@/types'

export async function getScans(): Promise<ScanJob[]> {
  const { data } = await api.get<ScanJob[]>('/scans')
  return data
}

export async function createScan(target: string, profile: ScanProfile): Promise<ScanJob> {
  const { data } = await api.post<ScanJob>('/scans', { target, profile })
  return data
}

export async function getScan(id: number): Promise<ScanJob> {
  const { data } = await api.get<ScanJob>(`/scans/${id}`)
  return data
}

export async function cancelScan(id: number): Promise<ScanJob> {
  const { data } = await api.post<ScanJob>(`/scans/${id}/cancel`)
  return data
}

export async function getSchedules(): Promise<ScanSchedule[]> {
  const { data } = await api.get<ScanSchedule[]>('/scans/schedules/')
  return data
}

export async function createSchedule(schedule: Partial<ScanSchedule>): Promise<ScanSchedule> {
  const { data } = await api.post<ScanSchedule>('/scans/schedules/', schedule)
  return data
}

export async function deleteSchedule(id: number): Promise<void> {
  await api.delete(`/scans/schedules/${id}`)
}
