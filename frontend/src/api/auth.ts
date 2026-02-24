import api from './client'
import type { User, Token } from '@/types'

export async function login(username: string, password: string): Promise<Token> {
  const form = new URLSearchParams()
  form.append('username', username)
  form.append('password', password)
  const { data } = await api.post<Token>('/auth/login', form, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  })
  return data
}

export async function register(username: string, password: string): Promise<User> {
  const { data } = await api.post<User>('/auth/register', { username, password })
  return data
}

export async function getMe(): Promise<User> {
  const { data } = await api.get<User>('/auth/me')
  return data
}

export async function checkSetupRequired(): Promise<boolean> {
  const { data } = await api.get<{ setup_required: boolean }>('/auth/setup-required')
  return data.setup_required
}
