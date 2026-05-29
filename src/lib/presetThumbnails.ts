/**
 * Náhledy (thumbnaily) Classic presetů pro dropdown (Fáze 5.13).
 *
 * Dvě části:
 *  1) IndexedDB cache (samostatná databáze `dj-enda-thumbs`, NEsdílí store
 *     s `aiCache.ts`, aby se nemusela koordinovat DB verze) — klíč = název
 *     presetu, hodnota = JPEG blob.
 *  2) `ThumbnailGenerator` — skrytý Butterchurn vizualizér, který offscreen
 *     vyrenderuje preset a uloží jeden reprezentativní frame jako JPEG.
 *
 * Proč samostatná databáze: `aiCache.ts` otevírá `dj-enda` s `DB_VERSION = 1`.
 * Kdybychom přidávali další object store do stejné DB, museli bychom bumpnout
 * verzi v obou souborech a hlídat, ať se nepotkají dvě otevřená spojení s
 * různou verzí. Vlastní databáze tenhle celý problém eliminuje.
 */

import butterchurn from '@webamp/butterchurn'

const DB_NAME = 'dj-enda-thumbs'
const STORE_NAME = 'thumbs'
const DB_VERSION = 1

// Rozměry renderu/uložení — malé, ať je generování levné a cache drobná.
// 192×108 = 16:9. JPEG ~4–8 KB na preset → ~1 MB pro ~150 presetů.
const THUMB_W = 192
const THUMB_H = 108
// Kolik framů preset „zahřejeme", než zachytíme snímek (animace se rozvine).
const WARM_FRAMES = 14
// Rozestup mezi framy v ms — reálný čas musí plynout, aby se Butterchurn
// animace pohnula (interní časování jede z performance.now()).
const FRAME_MS = 16
const JPEG_QUALITY = 0.72

interface ThumbEntry {
  blob: Blob
  createdAt: number
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
  })
}

/** Načte všechny cachované náhledy najednou → Map<presetKey, Blob>. */
export async function getAllThumbnails(): Promise<Map<string, Blob>> {
  const result = new Map<string, Blob>()
  try {
    const db = await openDb()
    return new Promise<Map<string, Blob>>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const cursorReq = store.openCursor()
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result
        if (cursor) {
          const key = String(cursor.key)
          const entry = cursor.value as ThumbEntry
          if (entry?.blob) result.set(key, entry.blob)
          cursor.continue()
        } else {
          resolve(result)
        }
      }
      cursorReq.onerror = () => resolve(result)
    })
  } catch {
    return result
  }
}

/** Uloží jeden náhled. Tiše ignoruje chyby (private mode, quota). */
export async function putThumbnail(key: string, blob: Blob): Promise<void> {
  try {
    const db = await openDb()
    return new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const entry: ThumbEntry = { blob, createdAt: Date.now() }
      tx.objectStore(STORE_NAME).put(entry, key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    })
  } catch {
    // IndexedDB nedostupné — náhled prostě nezůstane cachovaný.
  }
}

/** Vymaže všechny cachované náhledy (pro „přegenerovat"). */
export async function clearThumbnailCache(): Promise<void> {
  try {
    const db = await openDb()
    return new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).clear()
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    })
  } catch {
    // ignore
  }
}

// ─── Generátor ──────────────────────────────────────────────────────────────

export interface ThumbnailGenerator {
  /** Vyrenderuje preset offscreen a vrátí JPEG blob (nebo null při chybě). */
  capture: (preset: unknown) => Promise<Blob | null>
  /** Uvolní WebGL kontext + AudioContext. */
  dispose: () => void
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), 'image/jpeg', JPEG_QUALITY)
  })
}

/**
 * Vytvoří offscreen Butterchurn vizualizér pro generování náhledů.
 *
 * Audio: tichý oscilátor → connectAudio (Butterchurn potřebuje audio node,
 * jinak `render()` spadne na undefined analyseru). Oscilátor jde i do
 * destination přes gain(0), takže nikdy není slyšet. Po `resume()` (page už
 * měla user gesture, protože vizualizér se mountuje až po uploadu) analyser
 * vidí reálný tón → presety reagují → živější náhled. Pokud resume selže,
 * běžíme dál se suspended kontextem (klidnější náhledy, žádný crash).
 *
 * Vrací `null`, pokud prostředí nepodporuje WebGL / canvas 2D.
 */
export function createThumbnailGenerator(): ThumbnailGenerator | null {
  try {
    const bcCanvas = document.createElement('canvas')
    bcCanvas.width = THUMB_W
    bcCanvas.height = THUMB_H

    const outCanvas = document.createElement('canvas')
    outCanvas.width = THUMB_W
    outCanvas.height = THUMB_H
    const outCtx = outCanvas.getContext('2d')
    if (!outCtx) return null

    const audioCtx = new AudioContext()
    const osc = audioCtx.createOscillator()
    osc.frequency.value = 110
    const gain = audioCtx.createGain()
    gain.gain.value = 0
    osc.connect(gain)
    gain.connect(audioCtx.destination)

    const visualizer = butterchurn.createVisualizer(audioCtx, bcCanvas, {
      width: THUMB_W,
      height: THUMB_H,
      pixelRatio: 1,
    })
    visualizer.connectAudio(osc)
    try {
      osc.start(0)
    } catch {
      // už spuštěný — ignorujeme
    }
    // Pokus o resume (page už pravděpodobně měla gesture). Nečekáme na výsledek.
    audioCtx.resume().catch(() => {})

    let disposed = false

    const capture = async (preset: unknown): Promise<Blob | null> => {
      if (disposed) return null
      try {
        visualizer.loadPreset(preset, 0)
        for (let i = 0; i < WARM_FRAMES; i++) {
          if (disposed) return null
          visualizer.render()
          await sleep(FRAME_MS)
        }
        if (disposed) return null
        // Finální frame + SYNCHRONNÍ drawImage. WebGL drawing buffer se po
        // compositing fázi (návrat do event loopu) vyčistí, takže kopii do
        // 2D canvasu musíme udělat ve stejném synchronním turnu jako render().
        visualizer.render()
        outCtx.drawImage(bcCanvas, 0, 0, THUMB_W, THUMB_H)
        // outCanvas teď drží pixely → jeho toBlob je už bezpečně async.
        return await canvasToBlob(outCanvas)
      } catch (e: unknown) {
        console.warn('Thumbnail capture failed:', e)
        return null
      }
    }

    const dispose = () => {
      disposed = true
      try {
        osc.stop()
      } catch {
        // už zastavený
      }
      try {
        osc.disconnect()
      } catch {
        // ignore
      }
      try {
        gain.disconnect()
      } catch {
        // ignore
      }
      audioCtx.close().catch(() => {})
    }

    return { capture, dispose }
  } catch (e: unknown) {
    console.warn('Thumbnail generator init failed:', e)
    return null
  }
}
