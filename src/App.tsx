import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth'
import Home from '@/pages/Home'
import Dashboard from '@/pages/Dashboard'
import Login from '@/pages/Login'
import Workspace from '@/pages/Workspace'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  if (!isAuthenticated) return <Navigate to="/login" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
        <Route path="/workspace/:id" element={<ProtectedRoute><Workspace /></ProtectedRoute>} />
        <Route path="/workspace/:id/collab" element={<ProtectedRoute><Workspace /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  )
}
