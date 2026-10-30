import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { setTokenSource } from './api.ts'
import { accessToken } from './lib/supabase.ts'

setTokenSource(accessToken)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
