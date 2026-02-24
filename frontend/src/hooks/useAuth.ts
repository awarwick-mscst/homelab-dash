import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/authStore'
import { getMe } from '@/api/auth'

export function useAuth() {
  const { token, user, setAuth, logout } = useAuthStore()

  const { data, isLoading } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: getMe,
    enabled: !!token && !user,
    retry: false,
  })

  useEffect(() => {
    if (data && token) {
      setAuth(token, data)
    }
  }, [data, token, setAuth])

  return {
    user: user || data,
    isAuthenticated: !!token,
    isLoading: !!token && isLoading,
    logout,
  }
}
