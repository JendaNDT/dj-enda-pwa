/**
 * HuggingFace Inference API client utility.
 *
 * Aktuálně (Fáze 3.1) jen ukládá token do localStorage. Skutečné generování
 * obrazů přijde ve Fázi 3.2 přes `generateImage()`.
 *
 * Proč BYO token + localStorage:
 *   - Bez tokenu: HF Inference API anonymous má rate limit ~100 req/den.
 *   - S free HF account tokenem: ~1000 req/den.
 *   - Token je vázán na uživatele, žádný backend neděláme. localStorage
 *     je standardní BYO-key pattern (uživatel souhlasí tím, že ho vloží).
 */

const STORAGE_KEY = 'dj-enda.hf-token'

export interface HfTokenState {
  token: string | null
  hasToken: boolean
}

export function getHfToken(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export function setHfToken(token: string): void {
  const trimmed = token.trim()
  try {
    if (trimmed) {
      localStorage.setItem(STORAGE_KEY, trimmed)
    } else {
      localStorage.removeItem(STORAGE_KEY)
    }
  } catch {
    // localStorage může být zablokovaný (private mode) — tiše ignorujeme
  }
}

export function clearHfToken(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}

/**
 * Vrátí očekávaný rate limit popis podle toho, jestli má uživatel token.
 *
 * Pozn.: HuggingFace ke konci 2025 zrušil anonymous přístup k Inference API.
 * Bez tokenu router endpoint hází 401. Token je teď **povinný**.
 */
export function describeRateLimit(hasToken: boolean): string {
  return hasToken
    ? '~1000 požadavků / den (free HF account)'
    : 'Bez tokenu HF nepovolí generování (od konce 2025)'
}

/**
 * Maskuje token pro zobrazení v UI (např. "hf_***...abc12").
 */
export function maskToken(token: string): string {
  if (token.length < 10) return '••••••'
  const start = token.slice(0, 3)
  const end = token.slice(-4)
  return `${start}••••${end}`
}

// ─── Image generation ──────────────────────────────────────────────────────

/**
 * Předdefinovaná nabídka HF modelů pro UI dropdown (Fáze 4.10).
 *
 * Default je **FLUX.1-dev** — vyšší kvalita než Schnell, pomalejší, ale pro
 * statické keyframes (8× per video) je rozdíl ~5 s vs ~10 s nehraje roli
 * a finální vizuál je film-quality.
 *
 * Custom volba umožňuje vložit jakékoliv HF model ID
 * (např. `stabilityai/stable-diffusion-xl-base-1.0`) — pro power users.
 */
export interface HfModelOption {
  id: string
  name: string
  description: string
}

export const HF_MODELS: HfModelOption[] = [
  {
    id: 'black-forest-labs/FLUX.1-dev',
    name: 'Flux Dev (default)',
    description: 'Nejvyšší kvalita FLUX, ~10 s / obraz',
  },
  {
    id: 'black-forest-labs/FLUX.1-schnell',
    name: 'Flux Schnell',
    description: 'Rychlý FLUX, ~5 s / obraz',
  },
  {
    id: 'stabilityai/sdxl-turbo',
    name: 'SDXL Turbo',
    description: 'Alternativa od Stability, ~3 s / obraz',
  },
]

export const DEFAULT_HF_MODEL = HF_MODELS[0].id

/** Sentinel value pro UI signalizující, že uživatel zvolil custom model. */
export const CUSTOM_HF_MODEL_SENTINEL = '__custom__'

export interface GenerateImageOptions {
  /** HF model id, default `black-forest-labs/FLUX.1-schnell`. */
  modelId?: string
  /** API token. Pokud null, použijeme token z localStorage. */
  token?: string | null
  /** Abort signal pro zrušení požadavku. */
  signal?: AbortSignal
}

/**
 * Fetch s exponential backoff retry pro HF API.
 * 503 (model loading) a 429 (rate limit) → čekat a opakovat.
 * Ostatní chyby → vyhodit hned.
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = 3,
): Promise<Response> {
  let lastError: Error | null = null
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url, options)

      if (response.status === 503) {
        // Model se nahrává — čekáme a opakujeme.
        const wait = Math.min(20000, 5000 * Math.pow(2, attempt))
        await new Promise<void>((r) => setTimeout(r, wait))
        continue
      }

      if (response.status === 429) {
        // Rate limit — čekáme déle.
        const wait = Math.min(60000, 10000 * Math.pow(2, attempt))
        await new Promise<void>((r) => setTimeout(r, wait))
        continue
      }

      return response
    } catch (e: unknown) {
      lastError = e instanceof Error ? e : new Error('Síťová chyba')
      if (options.signal?.aborted) throw lastError
    }
  }
  if (lastError) throw lastError
  throw new Error('Vyčerpán počet pokusů')
}

/**
 * Vygeneruje obraz přes HF Inference API.
 * Default model je FLUX.1-schnell (rychlý, dobrá kvalita).
 *
 * @throws Error s lidsky čitelnou zprávou (401 = neplatný token, 503 timeout, atd.)
 */
export async function generateImage(
  prompt: string,
  options: GenerateImageOptions = {},
): Promise<Blob> {
  const modelId = options.modelId ?? DEFAULT_HF_MODEL
  const token = options.token === undefined ? getHfToken() : options.token

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'image/png',
  }
  if (token) headers['Authorization'] = `Bearer ${token}`

  // Pozn.: HF v 2025 deprecoval `api-inference.huggingface.co`. Nový endpoint
  // je `router.huggingface.co/hf-inference/models/...`. Viz AGENTS.md lessons.
  const response = await fetchWithRetry(
    `https://router.huggingface.co/hf-inference/models/${modelId}`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ inputs: prompt }),
      signal: options.signal,
    },
  )

  if (!response.ok) {
    let msg = `HTTP ${response.status}`
    if (response.status === 401) msg = 'Neplatný HuggingFace token'
    if (response.status === 429) msg = 'Překročen rate limit — zkus později'
    if (response.status === 503) msg = 'Model se nahrává moc dlouho'
    try {
      const data = await response.json()
      if (data?.error) msg = `${msg}: ${data.error}`
    } catch {
      // body není JSON, OK
    }
    throw new Error(msg)
  }

  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.startsWith('image/')) {
    // HF občas vrátí 200 s JSON chybou.
    try {
      const data = await response.json()
      throw new Error(data?.error ?? `Neočekávaná odpověď: ${contentType}`)
    } catch (e: unknown) {
      if (e instanceof Error) throw e
      throw new Error('Server vrátil neočekávaný obsah')
    }
  }

  return await response.blob()
}
