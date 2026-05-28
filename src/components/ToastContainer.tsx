import { dismissToast, useToasts, type Toast } from '../lib/toast'

/**
 * Plovoucí kontejner zobrazující aktivní toasty (Fáze 5.8).
 *
 * Pozice: bottom-right na desktopu, bottom-center na mobilu.
 * Slide-in animace přes Tailwind `animate-in`-like keyframes (inline @keyframes).
 * Click X = manuální dismiss.
 */
export function ToastContainer() {
  const toasts = useToasts()
  if (toasts.length === 0) return null

  return (
    <div
      aria-live="polite"
      aria-label="Notifikace"
      className="fixed bottom-4 left-1/2 -translate-x-1/2 sm:left-auto sm:right-4 sm:translate-x-0 z-[60] flex flex-col gap-2 max-w-sm w-[calc(100%-2rem)] sm:w-auto"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  )
}

function ToastItem({ toast }: { toast: Toast }) {
  const colors = colorsForKind(toast.kind)
  return (
    <div
      role="status"
      className={[
        'px-4 py-3 rounded-xl border shadow-lg flex items-center gap-3 text-sm',
        'animate-toast-in',
        colors.container,
      ].join(' ')}
    >
      <span className={`shrink-0 ${colors.icon}`}>
        {toast.kind === 'success' && (
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
        )}
        {toast.kind === 'error' && (
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        )}
        {toast.kind === 'info' && (
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
        )}
      </span>
      <span className="flex-1 min-w-0">{toast.message}</span>
      <button
        type="button"
        onClick={() => dismissToast(toast.id)}
        className="shrink-0 text-neutral-500 hover:text-neutral-200 transition-colors"
        aria-label="Zavřít notifikaci"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}

function colorsForKind(kind: Toast['kind']): { container: string; icon: string } {
  switch (kind) {
    case 'success':
      return {
        container: 'bg-emerald-950/80 border-emerald-800/70 text-emerald-100 backdrop-blur',
        icon: 'text-emerald-400',
      }
    case 'error':
      return {
        container: 'bg-red-950/80 border-red-800/70 text-red-100 backdrop-blur',
        icon: 'text-red-400',
      }
    case 'info':
    default:
      return {
        container: 'bg-neutral-900/90 border-neutral-700 text-neutral-100 backdrop-blur',
        icon: 'text-purple-400',
      }
  }
}
