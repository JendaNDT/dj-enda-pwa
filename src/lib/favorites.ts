import { useCallback, useEffect, useState } from 'react'

/**
 * Oblíbené presety perzistované v localStorage, odděleně pro Classic
 * (Butterchurn) a Modern (Three.js).
 *
 * Storage shape: JSON array of string keys per kind. Při korupci (invalid JSON,
 * neočekávaný typ) vrátíme prázdné pole a localStorage entry vyčistíme.
 */

export type PresetKind = 'classic' | 'modern'

const STORAGE_KEY_PREFIX = 'dj-enda:favorites:'

function storageKey(kind: PresetKind): string {
  return `${STORAGE_KEY_PREFIX}${kind}`
}

function readFavorites(kind: PresetKind): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(storageKey(kind))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((x): x is string => typeof x === 'string')
  } catch {
    // Korupce — vyčistit a vrátit prázdné.
    try {
      window.localStorage.removeItem(storageKey(kind))
    } catch {
      // localStorage může být zablokovaný (private mode), ignorujeme.
    }
    return []
  }
}

function writeFavorites(kind: PresetKind, keys: string[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(storageKey(kind), JSON.stringify(keys))
  } catch {
    // localStorage full / blocked — ignorujeme (favorites jsou nice-to-have).
  }
}

/**
 * React hook pro oblíbené presety. Vrací Set pro rychlý lookup a stabilní
 * callbacky pro toggle / add / remove.
 *
 * Po každé změně se ihned zapíše do localStorage. Změny v jiných tabech jsou
 * propagované přes `storage` event.
 */
export function useFavorites(kind: PresetKind): {
  favorites: Set<string>
  isFavorite: (key: string) => boolean
  toggle: (key: string) => void
  clear: () => void
} {
  const [favorites, setFavorites] = useState<Set<string>>(() => new Set(readFavorites(kind)))

  // Sync z jiných tabů (storage event se NEvystřelí v tabu, který změnu udělal,
  // ale v ostatních ano).
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key !== storageKey(kind)) return
      setFavorites(new Set(readFavorites(kind)))
    }
    window.addEventListener('storage', handler)
    return () => window.removeEventListener('storage', handler)
  }, [kind])

  const toggle = useCallback(
    (key: string) => {
      setFavorites((prev) => {
        const next = new Set(prev)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        writeFavorites(kind, Array.from(next))
        return next
      })
    },
    [kind],
  )

  const clear = useCallback(() => {
    setFavorites(new Set())
    writeFavorites(kind, [])
  }, [kind])

  const isFavorite = useCallback((key: string) => favorites.has(key), [favorites])

  return { favorites, isFavorite, toggle, clear }
}
