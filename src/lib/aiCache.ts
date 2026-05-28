/**
 * IndexedDB cache pro AI-generované keyframes.
 *
 * Klíč = `${audioHash}:${styleId}`. Pokud uživatel nahraje stejný audio
 * soubor a vybere stejný styl, dostane cached keyframes okamžitě bez
 * dalšího generování (= bez rate limit costs).
 *
 * Audio hash je SHA-256 prvních 64 KB samples (rychlý a dostatečně unikátní
 * pro detekci „stejný soubor"). Při změně audio uživatel automaticky dostane
 * nové generování.
 */

const DB_NAME = 'dj-enda'
const STORE_NAME = 'ai-keyframes'
const DB_VERSION = 1

interface CachedEntry {
  blobs: Blob[]
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

/**
 * Hash z prvních 64 KB audio samples (kanál 0).
 * SHA-256 → hex string prvních 16 znaků (8 bytes).
 */
export async function hashAudioBuffer(buffer: AudioBuffer): Promise<string> {
  const channel = buffer.getChannelData(0)
  const maxBytes = 65536
  const byteLength = Math.min(channel.byteLength, maxBytes)
  const bytes = new Uint8Array(channel.buffer, channel.byteOffset, byteLength)
  const hashBuf = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(hashBuf))
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function getCachedKeyframes(
  audioHash: string,
  styleId: string,
): Promise<Blob[] | null> {
  try {
    const db = await openDb()
    return new Promise<Blob[] | null>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const req = tx.objectStore(STORE_NAME).get(`${audioHash}:${styleId}`)
      req.onsuccess = () => {
        const entry = req.result as CachedEntry | undefined
        resolve(entry?.blobs ?? null)
      }
      req.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}

export async function setCachedKeyframes(
  audioHash: string,
  styleId: string,
  blobs: Blob[],
): Promise<void> {
  try {
    const db = await openDb()
    return new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const entry: CachedEntry = { blobs, createdAt: Date.now() }
      tx.objectStore(STORE_NAME).put(entry, `${audioHash}:${styleId}`)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    })
  } catch {
    // IndexedDB unavailable (private mode, quota) — tiše ignorujeme.
  }
}

/**
 * Vymaže celý cache. Užitečné pro debug nebo "reset" tlačítko.
 */
export async function clearAiCache(): Promise<void> {
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
