import api from './client'

export async function getOllamaModels(): Promise<{ models: { name: string; size: number }[] }> {
  const { data } = await api.get('/ollama/models')
  return data
}

export async function getOllamaStatus(): Promise<{ connected: boolean; host: string; model?: string }> {
  const { data } = await api.get('/ollama/status')
  return data
}
