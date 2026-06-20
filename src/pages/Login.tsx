import { useState, useEffect, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Terminal, Github, Mail, Lock, User, ArrowRight, Shield } from 'lucide-react'
import { useAuthStore } from '@/stores/auth'

type Tab = 'login' | 'register'

interface FormErrors {
  email?: string
  username?: string
  password?: string
  confirmPassword?: string
}

function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export default function Login() {
  const [tab, setTab] = useState<Tab>('login')
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [errors, setErrors] = useState<FormErrors>({})
  const [serverError, setServerError] = useState('')
  const [loading, setLoading] = useState(false)

  const navigate = useNavigate()
  const { login, register, isAuthenticated } = useAuthStore()

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/dashboard', { replace: true })
    }
  }, [isAuthenticated, navigate])

  function validate(): FormErrors {
    const e: FormErrors = {}
    if (!email) {
      e.email = 'Email is required'
    } else if (!validateEmail(email)) {
      e.email = 'Invalid email format'
    }
    if (!password) {
      e.password = 'Password is required'
    } else if (password.length < 6) {
      e.password = 'Password must be at least 6 characters'
    }
    if (tab === 'register') {
      if (!username) {
        e.username = 'Username is required'
      }
      if (!confirmPassword) {
        e.confirmPassword = 'Please confirm your password'
      } else if (password !== confirmPassword) {
        e.confirmPassword = 'Passwords do not match'
      }
    }
    return e
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setServerError('')
    const validationErrors = validate()
    setErrors(validationErrors)
    if (Object.keys(validationErrors).length > 0) return

    setLoading(true)
    try {
      if (tab === 'login') {
        await login(email, password)
      } else {
        await register(email, username, password)
      }
      navigate('/dashboard', { replace: true })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Authentication failed'
      setServerError(message)
    } finally {
      setLoading(false)
    }
  }

  function switchTab(t: Tab) {
    setTab(t)
    setErrors({})
    setServerError('')
  }

  return (
    <div className="relative min-h-screen bg-[#0D1117] flex items-center justify-center overflow-hidden">
      <div className="particles-bg" />
      <div className="grid-bg" />

      <div className="floating-snippet floating-snippet-1 font-mono text-[#58A6FF]/20 text-xs">
        {'const sandbox = await Sandbox.create();'}
      </div>
      <div className="floating-snippet floating-snippet-2 font-mono text-[#3FB950]/20 text-xs">
        {'> npm run dev --secure'}
      </div>
      <div className="floating-snippet floating-snippet-3 font-mono text-[#BC8CFF]/20 text-xs">
        {'import { VFS } from "@sandboxos/fs"'}
      </div>
      <div className="floating-snippet floating-snippet-4 font-mono text-[#D29922]/20 text-xs">
        {'docker exec -it sandbox sh'}
      </div>
      <div className="floating-snippet floating-snippet-5 font-mono text-[#F85149]/20 text-xs">
        {'await runtime.execute(code);'}
      </div>

      <div className="relative z-10 w-full max-w-md mx-4">
        <div className="backdrop-blur-xl bg-[#161B22]/70 border border-[#30363D] rounded-2xl shadow-2xl shadow-black/40 p-8">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-xl bg-gradient-to-br from-[#58A6FF]/20 to-[#3FB950]/20 border border-[#30363D] mb-4">
              <Terminal className="w-7 h-7 text-[#58A6FF]" />
            </div>
            <h1 className="text-3xl font-bold text-[#E6EDF3] tracking-tight">
              SandboxOS
              <span className="terminal-cursor">_</span>
            </h1>
            <p className="text-[#8B949E] text-sm mt-1.5 flex items-center justify-center gap-1.5">
              <Shield className="w-3.5 h-3.5" />
              Secure Code Execution Platform
            </p>
          </div>

          <div className="flex mb-6 bg-[#0D1117] rounded-lg p-1 border border-[#30363D]">
            <button
              type="button"
              onClick={() => switchTab('login')}
              className={`flex-1 py-2 text-sm font-medium rounded-md transition-all duration-200 ${
                tab === 'login'
                  ? 'bg-[#161B22] text-[#E6EDF3] shadow-sm'
                  : 'text-[#8B949E] hover:text-[#E6EDF3]'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => switchTab('register')}
              className={`flex-1 py-2 text-sm font-medium rounded-md transition-all duration-200 ${
                tab === 'register'
                  ? 'bg-[#161B22] text-[#E6EDF3] shadow-sm'
                  : 'text-[#8B949E] hover:text-[#E6EDF3]'
              }`}
            >
              Create Account
            </button>
          </div>

          {serverError && (
            <div className="mb-4 px-4 py-3 rounded-lg bg-[#F85149]/10 border border-[#F85149]/30 text-[#F85149] text-sm">
              {serverError}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8B949E]" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email address"
                  className={`w-full pl-10 pr-4 py-2.5 bg-[#161B22] border rounded-lg text-[#E6EDF3] placeholder-[#8B949E] text-sm outline-none transition-all duration-200 focus:ring-1 ${
                    errors.email
                      ? 'border-[#F85149] focus:border-[#F85149] focus:ring-[#F85149]/30'
                      : 'border-[#30363D] focus:border-[#58A6FF] focus:ring-[#58A6FF]/30'
                  }`}
                />
              </div>
              {errors.email && <p className="mt-1 text-xs text-[#F85149]">{errors.email}</p>}
            </div>

            {tab === 'register' && (
              <div>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8B949E]" />
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Username"
                    className={`w-full pl-10 pr-4 py-2.5 bg-[#161B22] border rounded-lg text-[#E6EDF3] placeholder-[#8B949E] text-sm outline-none transition-all duration-200 focus:ring-1 ${
                      errors.username
                        ? 'border-[#F85149] focus:border-[#F85149] focus:ring-[#F85149]/30'
                        : 'border-[#30363D] focus:border-[#58A6FF] focus:ring-[#58A6FF]/30'
                    }`}
                  />
                </div>
                {errors.username && <p className="mt-1 text-xs text-[#F85149]">{errors.username}</p>}
              </div>
            )}

            <div>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8B949E]" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password"
                  className={`w-full pl-10 pr-4 py-2.5 bg-[#161B22] border rounded-lg text-[#E6EDF3] placeholder-[#8B949E] text-sm outline-none transition-all duration-200 focus:ring-1 ${
                    errors.password
                      ? 'border-[#F85149] focus:border-[#F85149] focus:ring-[#F85149]/30'
                      : 'border-[#30363D] focus:border-[#58A6FF] focus:ring-[#58A6FF]/30'
                  }`}
                />
              </div>
              {errors.password && <p className="mt-1 text-xs text-[#F85149]">{errors.password}</p>}
            </div>

            {tab === 'register' && (
              <div>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8B949E]" />
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm password"
                    className={`w-full pl-10 pr-4 py-2.5 bg-[#161B22] border rounded-lg text-[#E6EDF3] placeholder-[#8B949E] text-sm outline-none transition-all duration-200 focus:ring-1 ${
                      errors.confirmPassword
                        ? 'border-[#F85149] focus:border-[#F85149] focus:ring-[#F85149]/30'
                        : 'border-[#30363D] focus:border-[#58A6FF] focus:ring-[#58A6FF]/30'
                    }`}
                  />
                </div>
                {errors.confirmPassword && (
                  <p className="mt-1 text-xs text-[#F85149]">{errors.confirmPassword}</p>
                )}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-lg font-medium text-sm text-white bg-gradient-to-r from-[#58A6FF] to-[#3FB950] hover:shadow-[0_0_20px_rgba(88,166,255,0.3),0_0_20px_rgba(63,185,80,0.2)] active:scale-[0.98] transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:shadow-none"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  {tab === 'login' ? 'Sign In' : 'Create Account'}
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          {tab === 'login' && (
            <>
              <div className="flex items-center gap-3 my-5">
                <div className="flex-1 h-px bg-[#30363D]" />
                <span className="text-xs text-[#8B949E]">or continue with</span>
                <div className="flex-1 h-px bg-[#30363D]" />
              </div>

              <button
                type="button"
                className="w-full py-2.5 rounded-lg font-medium text-sm text-[#E6EDF3] bg-[#161B22] border border-[#30363D] hover:border-[#8B949E] hover:bg-[#21262D] transition-all duration-200 flex items-center justify-center gap-2"
              >
                <Github className="w-4 h-4" />
                GitHub
              </button>

              <div className="mt-5 p-3 rounded-lg bg-[#58A6FF]/5 border border-[#58A6FF]/20">
                <p className="text-xs text-[#8B949E] text-center">
                  Demo credentials:{' '}
                  <span className="text-[#58A6FF] font-mono">demo@sandboxos.io</span> /{' '}
                  <span className="text-[#58A6FF] font-mono">demo123</span>
                </p>
              </div>
            </>
          )}
        </div>

        <p className="text-center text-xs text-[#8B949E]/60 mt-6">
          SandboxOS &copy; 2026 &mdash; Isolated. Secure. Yours.
        </p>
      </div>
    </div>
  )
}
