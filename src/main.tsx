import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'
import { showToast } from './lib/toast'

// Service worker registration (vite-plugin-pwa, registerType: 'prompt').
// Žádný automatický reload — při nové verzi ukážeme toast „Obnovit" a stránku
// přenačteme až na klik uživatele přes updateSW(true). Tím odpadá samovolný
// refresh ~2 s po načtení, který dělal autoUpdate při výměně service workeru.
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    showToast('Je k dispozici nová verze.', 'info', 0, {
      label: 'Obnovit',
      onClick: () => {
        void updateSW(true)
      },
    })
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
