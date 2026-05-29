/**
 * Hook pro náhledy Classic presetů (Fáze 5.13).
 *
 * Na mountu načte cachované náhledy z IndexedDB (okamžitě vidět), pak na pozadí
 * dogeneruje chybějící — sekvenčně, throttlovaně a přerušitelně. Generování se
 * pozastaví, když `paused = true` (typicky když hraje audio, ať nebereme GPU
 * živému vizualizéru).
 *
 * Vrací Map `presetKey → blob URL`. URL se uvolní při unmountu i při
 * `regenerate()`.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  clearThumbnailCache,
  createThumbnailGenerator,
  getAllThumbnails,
  putThumbnail,
  type ThumbnailGenerator,
} from './presetThumbnails'

interface Options {
  /** Když true, generování se pozastaví (běžící thumbnaily zůstávají). */
  paused?: boolean
}

export interface PresetThumbnailsResult {
  /** presetKey → blob URL (jen hotové náhledy). */
  thumbnails: Map<string, string>
  /** Počet hotových náhledů (cache + nově vygenerované). */
  generated: number
  /** Celkový počet presetů. */
  total: number
  /** True, dokud běží generování chybějících náhledů. */
  generating: boolean
  /** Smaže cache + vygeneruje všechno znovu. */
  regenerate: () => void
}

/** Pauza před spuštěním generování — ať se appka / live preview nejdřív usadí. */
const INITIAL_DELAY_MS = 800
/** Oddech mezi presety, ať UI zůstane responzivní. */
const BETWEEN_PRESETS_MS = 40

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

export function usePresetThumbnails(
  presetKeys: string[],
  presets: Record<string, unknown>,
  options: Options = {},
): PresetThumbnailsResult {
  const { paused = false } = options

  const [thumbnails, setThumbnails] = useState<Map<string, string>>(new Map())
  const [generated, setGenerated] = useState(0)
  const [generating, setGenerating] = useState(false)
  // Bump → restart celého efektu (použito v regenerate()).
  const [runId, setRunId] = useState(0)

  // Aktuální hodnota paused dostupná uvnitř async smyčky bez restartu efektu.
  const pausedRef = useRef(paused)
  useEffect(() => {
    pausedRef.current = paused
  }, [paused])

  // Token pro invalidaci běžícího běhu (cleanup / regenerate).
  const tokenRef = useRef(0)
  // Aktivní blob URL k uvolnění.
  const urlsRef = useRef<Map<string, string>>(new Map())

  useEffect(() => {
    const myToken = ++tokenRef.current
    const cancelled = () => myToken !== tokenRef.current
    let generator: ThumbnailGenerator | null = null

    const addThumb = (key: string, blob: Blob) => {
      const url = URL.createObjectURL(blob)
      urlsRef.current.set(key, url)
      setThumbnails((prev) => {
        const next = new Map(prev)
        next.set(key, url)
        return next
      })
    }

    const run = async () => {
      // 1) Načíst cache → okamžité náhledy.
      const cached = await getAllThumbnails()
      if (cancelled()) return
      for (const key of presetKeys) {
        const blob = cached.get(key)
        if (blob) addThumb(key, blob)
      }
      const validCached = presetKeys.filter((k) => cached.has(k)).length
      setGenerated(validCached)

      // 2) Co chybí?
      const missing = presetKeys.filter((k) => !cached.has(k))
      if (missing.length === 0) {
        setGenerating(false)
        return
      }

      // 3) Generovat na pozadí.
      await sleep(INITIAL_DELAY_MS)
      if (cancelled()) return

      generator = createThumbnailGenerator()
      if (!generator) {
        setGenerating(false)
        return
      }

      setGenerating(true)
      let count = validCached
      for (const key of missing) {
        if (cancelled()) break
        // Pauza, když hraje audio.
        while (pausedRef.current && !cancelled()) {
          await sleep(400)
        }
        if (cancelled()) break

        const preset = presets[key]
        if (preset === undefined) continue

        const blob = await generator.capture(preset)
        if (cancelled()) break
        if (blob) {
          await putThumbnail(key, blob)
          if (cancelled()) break
          addThumb(key, blob)
          count += 1
          setGenerated(count)
        }
        await sleep(BETWEEN_PRESETS_MS)
      }
    }

    void run().finally(() => {
      if (generator) generator.dispose()
      if (!cancelled()) setGenerating(false)
    })

    return () => {
      // Invaliduje běžící běh (cancelled() začne vracet true).
      tokenRef.current += 1
    }
    // presetKeys/presets jsou modulové konstanty (stabilní reference).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId])

  // Uvolnit všechny blob URL při unmountu.
  useEffect(() => {
    const urls = urlsRef.current
    return () => {
      for (const url of urls.values()) URL.revokeObjectURL(url)
      urls.clear()
    }
  }, [])

  const regenerate = useCallback(() => {
    // Invalidovat běžící běh a uvolnit aktuální URL.
    tokenRef.current += 1
    for (const url of urlsRef.current.values()) URL.revokeObjectURL(url)
    urlsRef.current.clear()
    setThumbnails(new Map())
    setGenerated(0)
    setGenerating(true)
    void clearThumbnailCache().then(() => {
      setRunId((id) => id + 1)
    })
  }, [])

  return {
    thumbnails,
    generated,
    total: presetKeys.length,
    generating,
    regenerate,
  }
}
