import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth'

export default function Home() {
  const navigate = useNavigate()
  const { isAuthenticated } = useAuthStore()

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/dashboard')
    } else {
      navigate('/login')
    }
  }, [isAuthenticated, navigate])

  return <div className="min-h-screen bg-[var(--bg-primary)]" />
}