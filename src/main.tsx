import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'

// Service worker registration (vite-plugin-pwa)
// registerType: 'autoUpdate' v vite.config.ts automaticky aktualizuje SW
// po nasazení nové verze.
registerSW({ immediate: true })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
