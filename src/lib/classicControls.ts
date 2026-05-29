/**
 * Ladicí parametry Classic (Butterchurn) vizualizéru (Fáze 6).
 *
 * Butterchurn presety samotné se ladit nedají (Milkdrop rovnice jsou zapečené),
 * ale globálně jde řídit chování renderu. Tyhle hodnoty se aplikují imperativně
 * na vizualizér ve `Visualizer.tsx`:
 *   - blendSeconds → `loadPreset(preset, blendSeconds)` (rychlost přechodu)
 *   - meshLevel → `setInternalMeshSize(w, h)` (jemnost warp mřížky) — živě
 *   - antialias → `setOutputAA(bool)` (vyhlazení hran) — živě
 *   - sharpness → `textureRatio` v create opts (interní rozlišení) — přes rebuild
 *   - autoCycle / cycleSeconds → časovač, co sám střídá presety
 *
 * Hodnoty se perzistují do localStorage, takže přežijí reload.
 */

import { useCallback, useEffect, useState } from 'react'

export interface ClassicControls {
  /** Doba přechodu mezi presety v sekundách (loadPreset blendTime). */
  blendSeconds: number
  /** Index do MESH_SIZES — jemnost warp mřížky. */
  meshLevel: number
  /** Index do TEXTURE_RATIOS — interní render rozlišení (ostrost). */
  sharpness: number
  /** FXAA vyhlazení hran. */
  antialias: boolean
  /** Automatické střídání presetů časovačem. */
  autoCycle: boolean
  /** Interval auto-cyklení v sekundách. */
  cycleSeconds: number
}

/** Velikosti warp mřížky (meshWidth × meshHeight). Milkdrop default ≈ 48×36. */
export const MESH_SIZES: ReadonlyArray<readonly [number, number]> = [
  [32, 24],
  [48, 36],
  [64, 48],
  [96, 72],
]
export const MESH_LABELS = ['Hrubý', 'Standard', 'Jemný', 'Velmi jemný']

/** Interní render rozlišení (textureRatio). Vyšší = ostřejší, víc GPU. */
export const TEXTURE_RATIOS = [1, 1.5, 2]
export const SHARPNESS_LABELS = ['Standard', 'Vyšší', 'Nejvyšší']

export const DEFAULT_CLASSIC_CONTROLS: ClassicControls = {
  blendSeconds: 2,
  meshLevel: 1,
  sharpness: 0,
  antialias: true,
  autoCycle: false,
  cycleSeconds: 15,
}

const STORAGE_KEY = 'dj-enda:classic-controls'

function loadControls(): ClassicControls {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_CLASSIC_CONTROLS }
    const parsed = JSON.parse(raw) as Partial<ClassicControls>
    // Merge s defaulty — robustní vůči přidání nových polí v budoucnu.
    return { ...DEFAULT_CLASSIC_CONTROLS, ...parsed }
  } catch {
    return { ...DEFAULT_CLASSIC_CONTROLS }
  }
}

/** Počet parametrů odlišných od defaultu — pro badge „N aktivní". */
export function countActive(c: ClassicControls): number {
  let n = 0
  if (c.autoCycle) n += 1
  if (c.blendSeconds !== DEFAULT_CLASSIC_CONTROLS.blendSeconds) n += 1
  if (c.meshLevel !== DEFAULT_CLASSIC_CONTROLS.meshLevel) n += 1
  if (c.sharpness !== DEFAULT_CLASSIC_CONTROLS.sharpness) n += 1
  if (c.antialias !== DEFAULT_CLASSIC_CONTROLS.antialias) n += 1
  return n
}

export interface UseClassicControls {
  controls: ClassicControls
  update: (patch: Partial<ClassicControls>) => void
  reset: () => void
}

export function useClassicControls(): UseClassicControls {
  const [controls, setControls] = useState<ClassicControls>(loadControls)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(controls))
    } catch {
      // localStorage nedostupné (private mode / quota) — tiše ignorujeme.
    }
  }, [controls])

  const update = useCallback((patch: Partial<ClassicControls>) => {
    setControls((prev) => ({ ...prev, ...patch }))
  }, [])

  const reset = useCallback(() => {
    setControls({ ...DEFAULT_CLASSIC_CONTROLS })
  }, [])

  return { controls, update, reset }
}
