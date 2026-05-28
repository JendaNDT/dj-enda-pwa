import { useEffect, useState } from 'react'

/**
 * Dekóduje audio soubor přes Web Audio API.
 *
 * Vytvoří dočasný AudioContext, načte soubor jako ArrayBuffer a dekóduje
 * ho do AudioBufferu. Po dekódování AudioContext zavře, aby uvolnil zdroje.
 *
 * Pozn.: AudioContext bývá blokován do user gesture (klik). V naší aplikaci
 * je file upload spouštěn z user click handleru, takže to projde.
 */
export async function decodeAudioFile(file: File): Promise<AudioBuffer> {
  const ctx = new AudioContext()
  try {
    const arrayBuffer = await file.arrayBuffer()
    // decodeAudioData kopíruje ArrayBuffer interně, takže ho můžeme zahodit.
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer)
    return audioBuffer
  } finally {
    // Cleanup — bez close() by AudioContext žil, dokud ho nedostane GC.
    await ctx.close().catch(() => {
      // Pokud už je zavřený, ignorujeme.
    })
  }
}

export interface DecodedAudioState {
  buffer: AudioBuffer | null
  isLoading: boolean
  error: string | null
}

/**
 * React hook: vezme File (nebo null) a vrátí dekódovaný AudioBuffer.
 *
 * Když se `file` změní (nebo se resetuje na null), hook spustí nové dekódování
 * a předchozí pojistí přes `cancelled` flag, aby nezapisoval stale výsledky.
 */
export function useAudioDecoder(file: File | null): DecodedAudioState {
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!file) {
      setBuffer(null)
      setError(null)
      setIsLoading(false)
      return
    }

    let cancelled = false
    setIsLoading(true)
    setError(null)
    setBuffer(null)

    decodeAudioFile(file)
      .then((decoded) => {
        if (cancelled) return
        setBuffer(decoded)
        setIsLoading(false)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        const msg = e instanceof Error ? e.message : 'Neznámá chyba'
        setError(`Dekódování audio selhalo: ${msg}`)
        setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [file])

  return { buffer, isLoading, error }
}

/**
 * Naformátuje sekundy jako m:ss (nebo h:mm:ss pro delší).
 */
export function formatDuration(seconds: number): string {
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  return `${m}:${String(s).padStart(2, '0')}`
}

/**
 * Formátuje velké číslo se zúženým mezerovým oddělovačem tisíců (česká norma).
 */
export function formatCount(value: number): string {
  return value.toLocaleString('cs-CZ').replace(/ /g, ' ')
}

/**
 * Vrátí lidsky čitelný popis počtu kanálů.
 */
export function describeChannels(count: number): string {
  if (count === 1) return '1 (mono)'
  if (count === 2) return '2 (stereo)'
  return `${count}`
}
