import { useEffect, useState } from 'react'

/**
 * Minimální toast notifikace systém (Fáze 5.8).
 *
 * Pattern: globální array + subscribe listenery. Žádný Context provider — toast
 * lze volat odkudkoliv (z handleru, callbacku, lifecycle effect) bez nutnosti
 * předávat dispatch funkce.
 *
 * Použití:
 *   showToast('Přidáno do oblíbených')
 *   showToast('Cache vyčištěna', 'success')
 *   showToast('Chyba při uložení', 'error')
 *
 * V App.tsx je mountnut `<ToastContainer />` který poslouchá změny a zobrazuje
 * aktivní toasty. Auto-dismiss po 3 s (lze override per call).
 */

export type ToastKind = 'success' | 'error' | 'info'

/** Volitelné akční tlačítko v toastu (např. „Obnovit" u nové verze). */
export interface ToastAction {
  label: string
  onClick: () => void
}

export interface Toast {
  id: string
  message: string
  kind: ToastKind
  action?: ToastAction
}

const DEFAULT_DURATION_MS = 3000

let toasts: Toast[] = []
let listeners: Array<(toasts: Toast[]) => void> = []

function emit() {
  listeners.forEach((l) => l(toasts))
}

/**
 * Zobrazí toast. Automatický dismiss po `durationMs` (default 3 s).
 * Pokud chceš toast držet napořád, předej `durationMs: 0` a manuálně volej
 * `dismissToast(id)`.
 */
export function showToast(
  message: string,
  kind: ToastKind = 'success',
  durationMs: number = DEFAULT_DURATION_MS,
  action?: ToastAction,
): string {
  const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  toasts = [...toasts, { id, message, kind, action }]
  emit()
  if (durationMs > 0) {
    setTimeout(() => dismissToast(id), durationMs)
  }
  return id
}

export function dismissToast(id: string): void {
  toasts = toasts.filter((t) => t.id !== id)
  emit()
}

/**
 * React hook — vrací aktuální pole aktivních toastů. Re-renderuje komponentu
 * při každé změně.
 */
export function useToasts(): Toast[] {
  const [snapshot, setSnapshot] = useState<Toast[]>(toasts)
  useEffect(() => {
    listeners.push(setSnapshot)
    // Sync s aktuálním stavem (pro pozdě-mountnuté komponenty).
    setSnapshot(toasts)
    return () => {
      listeners = listeners.filter((l) => l !== setSnapshot)
    }
  }, [])
  return snapshot
}
