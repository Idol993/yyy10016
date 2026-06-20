const BASE_URL = '/api'

export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  [key: string]: unknown
}

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem('token')
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }
  return headers
}

function handleResponse<T>(response: Response): Promise<T> {
  if (response.status === 401) {
    localStorage.removeItem('token')
    window.location.href = '/'
    throw new Error('Unauthorized')
  }
  if (!response.ok) {
    throw new Error(`API Error: ${response.status} ${response.statusText}`)
  }
  return response.json()
}

export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: 'GET',
    headers: getAuthHeaders(),
  })
  return handleResponse<T>(response)
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  })
  return handleResponse<T>(response)
}

export async function apiPut<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  })
  return handleResponse<T>(response)
}

export async function apiDelete<T>(path: string): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  })
  return handleResponse<T>(response)
}
