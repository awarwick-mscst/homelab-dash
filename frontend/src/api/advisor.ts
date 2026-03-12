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

export async function downloadReportPdf(reportId: number): Promise<void> {
  const response = await api.get(`/advisor/reports/${reportId}/pdf`, {
    responseType: 'blob',
  })
  // Check if the response is actually an error JSON (not a PDF)
  const contentType = response.headers['content-type'] || ''
  if (contentType.includes('application/json')) {
    const text = await (response.data as Blob).text()
    const err = JSON.parse(text)
    throw new Error(err.detail || 'PDF generation failed')
  }
  const blob = new Blob([response.data], { type: 'application/pdf' })
  const url = window.URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `security-report-${reportId}.pdf`
  document.body.appendChild(a)
  a.click()
  window.URL.revokeObjectURL(url)
  document.body.removeChild(a)
}

export async function getSystemPrompt(): Promise<{ prompt: string; is_default: boolean }> {
  const { data } = await api.get('/advisor/system-prompt')
  return data
}

export async function updateSystemPrompt(prompt: string): Promise<void> {
  await api.put('/advisor/system-prompt', { prompt })
}

export async function resetSystemPrompt(): Promise<{ prompt: string }> {
  const { data } = await api.delete('/advisor/system-prompt')
  return data
}
