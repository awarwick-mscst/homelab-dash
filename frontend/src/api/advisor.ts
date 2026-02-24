import api from './client'
import type { AdvisoryReport } from '@/types'

export async function runAnalysis(): Promise<AdvisoryReport> {
  const { data } = await api.post<AdvisoryReport>('/advisor/analyze')
  return data
}

export async function getReports(): Promise<AdvisoryReport[]> {
  const { data } = await api.get<AdvisoryReport[]>('/advisor/reports')
  return data
}

export async function getReport(id: number): Promise<AdvisoryReport> {
  const { data } = await api.get<AdvisoryReport>(`/advisor/reports/${id}`)
  return data
}

export async function resolveFinding(id: number): Promise<void> {
  await api.post(`/advisor/findings/${id}/resolve`)
}
