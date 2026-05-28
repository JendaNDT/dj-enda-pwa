import { useEffect, useMemo, useRef, useState } from 'react'
import {
  getHfToken,
  setHfToken,
  clearHfToken,
  describeRateLimit,
  maskToken,
  generateImage,
  HF_MODELS,
  DEFAULT_HF_MODEL,
  CUSTOM_HF_MODEL_SENTINEL,
} from '../lib/hfClient'
import {
  hashAudioBuffer,
  getCachedKeyframes,
  setCachedKeyframes,
  clearAiCache,
  getAiCacheStats,
  type AiCacheStats,
} from '../lib/aiCache'
import { AiVisualizer } from './AiVisualizer'
import { ExportButton } from './ExportButton'
import { formatBytes } from '../lib/export'

interface AiHybridPropsWithFilename {
  audioBuffer: AudioBuffer
  audioFilename: string
}

interface AiHybridProps extends AiHybridPropsWithFilename {}

interface Keyframe {
  id: string
  /** Default prompt vygenerovaný ze style + section. */
  prompt: string
  /** Custom prompt zadaný uživatelem v modal editoru. Pokud nastavený,
   *  použije se místo defaultního při generování. */
  customPrompt?: string
  imageUrl: string | null
  status: 'empty' | 'generating' | 'ready' | 'error'
  errorMsg?: string
}

interface StyleOption {
  id: string
  name: string
  basePrompt: string
}

const KEYFRAME_COUNT = 8

const STYLE_OPTIONS: StyleOption[] = [
  {
    id: 'cosmic',
    name: 'Kosmický',
    basePrompt:
      'cosmic nebula, stars, ethereal space art, vivid purple and blue colors, music album cover, widescreen',
  },
  {
    id: 'cyberpunk',
    name: 'Cyberpunk',
    basePrompt:
      'cyberpunk cityscape, neon lights, vivid magenta and cyan, dystopian, music album cover, widescreen',
  },
  {
    id: 'nature',
    name: 'Příroda',
    basePrompt:
      'lush organic nature, vibrant colors, peaceful, music album cover, widescreen',
  },
  {
    id: 'abstract',
    name: 'Abstraktní',
    basePrompt:
      'abstract geometric art, vivid colors, minimalist, music album cover, widescreen',
  },
]

function buildPrompt(style: StyleOption, sectionN: number): string {
  return `${style.basePrompt}, scene ${sectionN} of ${KEYFRAME_COUNT}, high detail`
}

function buildInitialKeyframes(
  durationSeconds: number,
  style: StyleOption,
): Keyframe[] {
  return Array.from({ length: KEYFRAME_COUNT }, (_, i) => ({
    id: `kf-${i}`,
    prompt: buildPrompt(style, i + 1),
    imageUrl: null,
    status: 'empty' as const,
  }))
  void durationSeconds
}

function formatSection(i: number, durationSec: number): string {
  const sectionLength = durationSec / KEYFRAME_COUNT
  const start = i * sectionLength
  const end = (i + 1) * sectionLength
  const mm = (s: number) =>
    `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
  return `${mm(start)}–${mm(end)}`
}

export function AiHybrid({ audioBuffer, audioFilename }: AiHybridProps) {
  const [tokenInput, setTokenInput] = useState('')
  const [storedToken, setStoredToken] = useState<string | null>(null)
  /** Když je token nastavený, karta je defaultně collapsed (jen kompaktní status).
   *  Uživatel ji může expandovat kliknutím — pro výměnu/odstranění tokenu (5.5). */
  const [tokenCardExpanded, setTokenCardExpanded] = useState<boolean>(false)
  const [styleId, setStyleId] = useState<string>(STYLE_OPTIONS[0].id)
  /** Aktuální HF model — buď ID z `HF_MODELS` array, nebo sentinel `__custom__`. */
  const [modelSelection, setModelSelection] = useState<string>(DEFAULT_HF_MODEL)
  /** Custom model ID když uživatel zvolil sentinel. */
  const [customModelId, setCustomModelId] = useState<string>('')
  const [keyframes, setKeyframes] = useState<Keyframe[]>(() =>
    buildInitialKeyframes(audioBuffer.duration, STYLE_OPTIONS[0]),
  )
  const [isGenerating, setIsGenerating] = useState(false)
  const [cacheStatus, setCacheStatus] = useState<
    'unknown' | 'checking' | 'hit' | 'miss'
  >('unknown')
  const [cacheStats, setCacheStats] = useState<AiCacheStats | null>(null)
  /** Index slotu, jehož prompt právě editujeme v modálu. `null` = modal zavřený. */
  const [editPromptIdx, setEditPromptIdx] = useState<number | null>(null)
  /** Pracovní hodnota textarea v modálu (commit do `customPrompt` až při Save). */
  const [editPromptDraft, setEditPromptDraft] = useState<string>('')
  const audioHashRef = useRef<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Refresh cache stats při mountu + po každé změně stavu cache.
  const refreshCacheStats = async () => {
    const stats = await getAiCacheStats()
    setCacheStats(stats)
  }
  useEffect(() => {
    void refreshCacheStats()
  }, [cacheStatus])

  const handleClearCache = async () => {
    const confirmed = window.confirm(
      'Opravdu chceš vymazat AI cache? Všechny generované keyframes pro všechny soubory a styly budou pryč. Tato akce je nevratná.',
    )
    if (!confirmed) return
    await clearAiCache()
    setCacheStatus('miss')
    await refreshCacheStats()
  }

  /** Otevřít modal pro editaci promptu konkrétního slotu. */
  const openPromptEditor = (idx: number) => {
    const kf = keyframes[idx]
    setEditPromptDraft(kf.customPrompt ?? kf.prompt)
    setEditPromptIdx(idx)
  }

  const closePromptEditor = () => {
    setEditPromptIdx(null)
    setEditPromptDraft('')
  }

  const savePromptEditor = () => {
    if (editPromptIdx === null) return
    const draft = editPromptDraft.trim()
    setKeyframes((prev) =>
      prev.map((k, i) =>
        i === editPromptIdx
          ? { ...k, customPrompt: draft.length > 0 ? draft : undefined }
          : k,
      ),
    )
    closePromptEditor()
  }

  const resetPromptEditor = () => {
    // Reset = smazat custom prompt, vrátit se k defaultnímu (z buildPrompt).
    if (editPromptIdx === null) return
    const kf = keyframes[editPromptIdx]
    setEditPromptDraft(kf.prompt)
  }

  useEffect(() => {
    setStoredToken(getHfToken())
  }, [])

  // Při změně audioBuffer / styleId → zkontrolovat cache.
  useEffect(() => {
    let cancelled = false
    const checkCache = async () => {
      setCacheStatus('checking')
      try {
        const hash = await hashAudioBuffer(audioBuffer)
        if (cancelled) return
        audioHashRef.current = hash
        const blobs = await getCachedKeyframes(hash, styleId)
        if (cancelled) return
        if (blobs && blobs.length === KEYFRAME_COUNT) {
          // Restore keyframes ze cache
          const style =
            STYLE_OPTIONS.find((s) => s.id === styleId) ?? STYLE_OPTIONS[0]
          const restored: Keyframe[] = blobs.map((blob, i) => ({
            id: `kf-${i}`,
            prompt: buildPrompt(style, i + 1),
            imageUrl: URL.createObjectURL(blob),
            status: 'ready' as const,
          }))
          // Cleanup starých URL
          setKeyframes((prev) => {
            prev.forEach((kf) => {
              if (kf.imageUrl) URL.revokeObjectURL(kf.imageUrl)
            })
            return restored
          })
          setCacheStatus('hit')
        } else {
          setCacheStatus('miss')
        }
      } catch {
        setCacheStatus('miss')
      }
    }
    void checkCache()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioBuffer, styleId])

  // Cleanup všech blob URL při unmountu nebo změně audioBufferu.
  useEffect(() => {
    return () => {
      keyframes.forEach((kf) => {
        if (kf.imageUrl) URL.revokeObjectURL(kf.imageUrl)
      })
      abortRef.current?.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioBuffer])

  const hasToken = storedToken !== null
  const style =
    STYLE_OPTIONS.find((s) => s.id === styleId) ?? STYLE_OPTIONS[0]
  const completedCount = keyframes.filter((k) => k.status === 'ready').length
  const allReady = completedCount === KEYFRAME_COUNT
  const readyImageUrls = useMemo(
    () =>
      keyframes
        .filter((k) => k.imageUrl !== null && k.status === 'ready')
        .map((k) => k.imageUrl as string),
    [keyframes],
  )

  const handleSaveToken = () => {
    const t = tokenInput.trim()
    if (!t) return
    setHfToken(t)
    setStoredToken(t)
    setTokenInput('')
  }

  const handleClearToken = () => {
    clearHfToken()
    setStoredToken(null)
  }

  const handleStyleChange = (newStyleId: string) => {
    setStyleId(newStyleId)
    const newStyle =
      STYLE_OPTIONS.find((s) => s.id === newStyleId) ?? STYLE_OPTIONS[0]
    // Default prompt přepsat na nový styl, custom prompt necháme — uživatelův
    // ruční override má přednost a změna stylu ho nesmazne (přesto se zobrazí
    // styl v UI textovém preview).
    setKeyframes((prev) =>
      prev.map((kf, i) => ({
        ...kf,
        prompt: buildPrompt(newStyle, i + 1),
      })),
    )
  }

  const generateOne = async (idx: number) => {
    const kf = keyframes[idx]
    setKeyframes((prev) =>
      prev.map((k, i) =>
        i === idx ? { ...k, status: 'generating', errorMsg: undefined } : k,
      ),
    )

    try {
      // Custom prompt má přednost před defaultním ze style + section.
      const effectivePrompt = kf.customPrompt?.trim() || kf.prompt
      // Resolved model: custom přes textinput, jinak vybraný z array.
      const effectiveModelId =
        modelSelection === CUSTOM_HF_MODEL_SENTINEL
          ? customModelId.trim() || DEFAULT_HF_MODEL
          : modelSelection
      const blob = await generateImage(effectivePrompt, {
        modelId: effectiveModelId,
        token: storedToken,
        signal: abortRef.current?.signal,
      })
      const url = URL.createObjectURL(blob)
      setKeyframes((prev) =>
        prev.map((k, i) => {
          if (i !== idx) return k
          if (k.imageUrl) URL.revokeObjectURL(k.imageUrl)
          return { ...k, status: 'ready', imageUrl: url, errorMsg: undefined }
        }),
      )
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Neznámá chyba'
      setKeyframes((prev) =>
        prev.map((k, i) =>
          i === idx ? { ...k, status: 'error', errorMsg: msg } : k,
        ),
      )
    }
  }

  const handleGenerateAll = async () => {
    if (isGenerating) return
    setIsGenerating(true)
    abortRef.current = new AbortController()

    for (let i = 0; i < KEYFRAME_COUNT; i++) {
      if (abortRef.current?.signal.aborted) break
      await generateOne(i)
    }

    setIsGenerating(false)
    abortRef.current = null

    // Uložit do cache (blob URLs → blobs)
    if (audioHashRef.current) {
      try {
        const blobs: Blob[] = []
        for (const kf of keyframes) {
          if (kf.status === 'ready' && kf.imageUrl) {
            const response = await fetch(kf.imageUrl)
            blobs.push(await response.blob())
          }
        }
        if (blobs.length === KEYFRAME_COUNT) {
          await setCachedKeyframes(audioHashRef.current, styleId, blobs)
          setCacheStatus('hit')
        }
      } catch {
        // ignore cache failures
      }
    }
  }

  const handleCancel = () => {
    abortRef.current?.abort()
    setIsGenerating(false)
  }

  const handleRegenerate = (idx: number) => {
    if (isGenerating) return
    abortRef.current = new AbortController()
    setIsGenerating(true)
    void generateOne(idx).finally(() => {
      setIsGenerating(false)
      abortRef.current = null
    })
  }

  return (
    <div className="space-y-4">
      {/* HF Token karta.
          - Když má uživatel token: kompaktní jednořádkový status (5.5),
            klik = expand pro odstranění / výměnu.
          - Když nemá token: plná karta s warning + návod + input. */}
      {hasToken ? (
        <div className="px-6 py-3 rounded-2xl bg-neutral-900 border border-neutral-800 transition-colors hover:border-neutral-700">
          <button
            type="button"
            onClick={() => setTokenCardExpanded((s) => !s)}
            className="w-full flex items-center justify-between gap-3 text-left"
            aria-expanded={tokenCardExpanded}
          >
            <div className="flex items-center gap-3 min-w-0">
              <svg
                viewBox="0 0 24 24"
                className="h-5 w-5 text-emerald-400 shrink-0"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
              <span className="text-sm text-neutral-200 font-mono truncate">
                HF token: {maskToken(storedToken!)}
              </span>
            </div>
            <svg
              viewBox="0 0 24 24"
              className={`h-4 w-4 text-neutral-500 shrink-0 transition-transform ${
                tokenCardExpanded ? 'rotate-90' : ''
              }`}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
          {tokenCardExpanded && (
            <div className="mt-3 pt-3 border-t border-neutral-800 space-y-2">
              <p className="text-xs text-neutral-500">
                Rate limit: {describeRateLimit(true)}
              </p>
              <button
                type="button"
                onClick={handleClearToken}
                disabled={isGenerating}
                className="text-sm text-neutral-400 hover:text-red-300 disabled:text-neutral-600 disabled:cursor-not-allowed transition-colors"
              >
                Odstranit token
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="px-6 py-5 rounded-2xl bg-neutral-900 border border-neutral-800 transition-colors hover:border-neutral-700">
          <div className="text-xs uppercase tracking-wider text-neutral-500 mb-2">
            HuggingFace token (povinný)
          </div>
          <div className="space-y-3">
            <p className="text-sm text-amber-300">
              ⚠ HuggingFace ke konci 2025 zrušil anonymous přístup. Pro
              generování je <strong>token povinný</strong>.
            </p>
            <p className="text-sm text-neutral-300">
              Vytvoř si volný token na{' '}
              <a
                href="https://huggingface.co/settings/tokens"
                target="_blank"
                rel="noopener noreferrer"
                className="text-purple-400 hover:text-purple-300 transition-colors"
              >
                huggingface.co/settings/tokens
              </a>
              {' '}(zdarma, stačí typ „Read"). Dostaneš{' '}
              <strong>{describeRateLimit(true)}</strong>.
            </p>
            <div className="flex gap-2">
              <input
                type="password"
                placeholder="hf_..."
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                className="flex-1 h-10 px-3 rounded-lg bg-neutral-800 border border-neutral-700 text-sm text-neutral-100 font-mono focus:outline-none focus:border-purple-500"
              />
              <button
                type="button"
                onClick={handleSaveToken}
                disabled={!tokenInput.trim()}
                className="px-4 h-10 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:bg-neutral-700 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
              >
                Uložit
              </button>
            </div>
            <p className="text-xs text-neutral-500">
              Token zůstane pouze v tvém prohlížeči (localStorage). Nikam se
              neposílá kromě HuggingFace API.
            </p>
          </div>
        </div>
      )}

      {/* HF model karta — výběr modelu (Fáze 4.10). */}
      <div className="px-6 py-5 rounded-2xl bg-neutral-900 border border-neutral-800 transition-colors hover:border-neutral-700">
        <div className="text-xs uppercase tracking-wider text-neutral-500 mb-2">
          AI model
        </div>
        <select
          value={modelSelection}
          onChange={(e) => setModelSelection(e.target.value)}
          disabled={isGenerating}
          className="w-full h-10 px-3 rounded-lg bg-neutral-800 border border-neutral-700 text-sm text-neutral-100 focus:outline-none focus:border-purple-500 disabled:opacity-50"
        >
          {HF_MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} — {m.description}
            </option>
          ))}
          <option value={CUSTOM_HF_MODEL_SENTINEL}>
            Custom model ID…
          </option>
        </select>
        {modelSelection === CUSTOM_HF_MODEL_SENTINEL && (
          <input
            type="text"
            value={customModelId}
            onChange={(e) => setCustomModelId(e.target.value)}
            disabled={isGenerating}
            placeholder="např. stabilityai/stable-diffusion-xl-base-1.0"
            className="mt-2 w-full h-10 px-3 rounded-lg bg-neutral-800 border border-neutral-700 text-sm text-neutral-100 font-mono focus:outline-none focus:border-purple-500 disabled:opacity-50"
          />
        )}
        <p className="mt-2 text-xs text-neutral-500">
          Pomalejší modely (Flux Dev) dají vyšší kvalitu obrazu. Generování
          8 keyframes proběhne jednou, pak je vše cached.
        </p>
      </div>

      {/* Styl karta */}
      <div className="px-6 py-5 rounded-2xl bg-neutral-900 border border-neutral-800 transition-colors hover:border-neutral-700">
        <div className="text-xs uppercase tracking-wider text-neutral-500 mb-2">
          Vizuální styl
        </div>
        <select
          value={styleId}
          onChange={(e) => handleStyleChange(e.target.value)}
          disabled={isGenerating}
          className="w-full h-10 px-3 rounded-lg bg-neutral-800 border border-neutral-700 text-sm text-neutral-100 focus:outline-none focus:border-purple-500 disabled:opacity-50"
        >
          {STYLE_OPTIONS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <p className="mt-2 text-xs text-neutral-500 font-mono">
          {style.basePrompt}
        </p>
      </div>

      {/* Storyboard karta */}
      <div className="px-6 py-5 rounded-2xl bg-neutral-900 border border-neutral-800 transition-colors hover:border-neutral-700">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs uppercase tracking-wider text-neutral-500">
            Storyboard · {KEYFRAME_COUNT} keyframes
          </div>
          <div className="text-xs text-neutral-500">
            {completedCount} / {KEYFRAME_COUNT} hotovo
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {keyframes.map((kf, i) => (
            <div
              key={kf.id}
              className="relative aspect-video rounded-lg bg-neutral-950 border border-neutral-800 overflow-hidden group"
            >
              {/* Image (pokud hotová) */}
              {kf.imageUrl && kf.status === 'ready' && (
                <img
                  src={kf.imageUrl}
                  alt={`Keyframe ${i + 1}`}
                  className="w-full h-full object-cover"
                />
              )}

              {/* Generating overlay */}
              {kf.status === 'generating' && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/70">
                  <div className="h-5 w-5 rounded-full border-2 border-purple-500 border-t-transparent animate-spin" />
                </div>
              )}

              {/* Empty placeholder */}
              {kf.status === 'empty' && (
                <div className="absolute inset-0 flex items-center justify-center text-center px-2">
                  <div>
                    <div className="text-xs text-neutral-600 mb-1">
                      Keyframe {i + 1}
                    </div>
                    <div className="text-[10px] text-neutral-700 font-mono">
                      {formatSection(i, audioBuffer.duration)}
                    </div>
                  </div>
                </div>
              )}

              {/* Error overlay */}
              {kf.status === 'error' && (
                <div
                  className="absolute inset-0 flex items-center justify-center bg-red-950/60 px-2"
                  title={kf.errorMsg}
                >
                  <div className="text-[10px] text-red-200 text-center">
                    chyba
                    <br />
                    <span className="text-red-300/70">tap pro retry</span>
                  </div>
                </div>
              )}

              {/* Edit prompt button (vždy dostupný, vlevo nahoře). */}
              {!isGenerating && kf.status !== 'generating' && (
                <button
                  type="button"
                  onClick={() => openPromptEditor(i)}
                  className={[
                    'absolute top-1.5 left-1.5 h-7 w-7 rounded-full text-white transition-all flex items-center justify-center',
                    kf.customPrompt
                      ? 'bg-purple-600 opacity-100'
                      : 'bg-black/70 hover:bg-purple-600 opacity-0 group-hover:opacity-100',
                  ].join(' ')}
                  title={
                    kf.customPrompt
                      ? 'Custom prompt aktivní — kliknutím uprav'
                      : 'Upravit prompt'
                  }
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="h-3.5 w-3.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                  </svg>
                </button>
              )}

              {/* Hover regenerate button (jen pro ready/error) */}
              {(kf.status === 'ready' || kf.status === 'error') &&
                !isGenerating && (
                  <button
                    type="button"
                    onClick={() => handleRegenerate(i)}
                    className="absolute top-1.5 right-1.5 h-7 w-7 rounded-full bg-black/70 hover:bg-purple-600 text-white opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center"
                    title="Vygenerovat znovu"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className="h-3.5 w-3.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="23 4 23 10 17 10" />
                      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                    </svg>
                  </button>
                )}

              {/* Časový interval (vždy zobrazený dole) */}
              <div className="absolute bottom-1.5 left-1.5 text-[9px] uppercase tracking-wider text-white/90 bg-black/60 px-1.5 rounded">
                {formatSection(i, audioBuffer.duration)}
              </div>

              {/* Custom prompt badge (vpravo dole) */}
              {kf.customPrompt && (
                <div className="absolute bottom-1.5 right-1.5 text-[9px] uppercase tracking-wider text-purple-100 bg-purple-700/80 px-1.5 rounded">
                  Custom
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Generate / Cancel tlačítko */}
      {isGenerating ? (
        <button
          type="button"
          onClick={handleCancel}
          className="w-full px-6 py-4 rounded-2xl bg-red-950/40 hover:bg-red-900/50 border border-red-800/60 text-red-200 font-medium transition-colors flex items-center justify-center gap-3"
        >
          <div className="h-4 w-4 rounded-full border-2 border-red-300 border-t-transparent animate-spin" />
          Generuji {completedCount + 1} / {KEYFRAME_COUNT} · kliknutím zruš
        </button>
      ) : (
        <button
          type="button"
          onClick={handleGenerateAll}
          disabled={!hasToken}
          title={!hasToken ? 'Nejdřív přidej HF token nahoře' : undefined}
          className="w-full px-6 py-4 rounded-2xl bg-purple-600 hover:bg-purple-500 disabled:bg-neutral-800 disabled:text-neutral-500 disabled:cursor-not-allowed text-white font-medium transition-colors flex items-center justify-center gap-3"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
          </svg>
          {!hasToken
            ? 'Nejdřív přidej HF token (viz nahoře)'
            : completedCount === 0
              ? `Generovat ${KEYFRAME_COUNT} AI keyframes`
              : `Generovat znovu všech ${KEYFRAME_COUNT}`}
        </button>
      )}

      {/* Cache info badge */}
      {cacheStatus === 'hit' && (
        <div className="px-4 py-2 rounded-full bg-emerald-950/30 border border-emerald-900/50 text-xs text-emerald-300/90 flex items-center gap-2 mx-auto w-fit">
          <svg
            viewBox="0 0 24 24"
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          Keyframes načteny z cache
        </div>
      )}

      {/* AI Vizualizér — zobrazí se jakmile máme všech 8 keyframes */}
      {allReady && (
        <>
          <AiVisualizer audioBuffer={audioBuffer} imageUrls={readyImageUrls} />
          <ExportButton
            audioBuffer={audioBuffer}
            audioFilename={audioFilename}
            presetKey="ai-hybrid"
            mode="ai"
            aiImageUrls={readyImageUrls}
          />
        </>
      )}

      {!allReady && completedCount > 0 && (
        <div className="px-6 py-4 rounded-2xl bg-neutral-900 border border-neutral-800 text-sm text-neutral-400 text-center">
          AI náhled se zobrazí, jakmile budou hotové všechny {KEYFRAME_COUNT}{' '}
          keyframes ({completedCount} / {KEYFRAME_COUNT}).
        </div>
      )}

      {/* AI cache karta — indikátor využití + reset tlačítko. */}
      <div className="px-6 py-5 rounded-2xl bg-neutral-900 border border-neutral-800 transition-colors hover:border-neutral-700">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs uppercase tracking-wider text-neutral-500">
            AI cache
          </div>
          {cacheStats && cacheStats.entries > 0 && (
            <button
              type="button"
              onClick={handleClearCache}
              disabled={isGenerating}
              className="text-xs text-red-400 hover:text-red-300 disabled:text-neutral-600 disabled:cursor-not-allowed transition-colors"
            >
              Vyčistit cache
            </button>
          )}
        </div>
        {cacheStats === null ? (
          <p className="text-xs text-neutral-500">Načítám stav cache…</p>
        ) : cacheStats.entries === 0 ? (
          <p className="text-xs text-neutral-500">
            Cache je prázdná. Vygenerované keyframes se sem ukládají automaticky
            a při dalším otevření stejného souboru + stylu se načtou okamžitě.
          </p>
        ) : (
          <p className="text-xs text-neutral-400">
            <strong className="text-neutral-200">{cacheStats.entries}</strong>{' '}
            {cacheStats.entries === 1 ? 'záznam' : cacheStats.entries < 5 ? 'záznamy' : 'záznamů'}{' '}
            ·{' '}
            <strong className="text-neutral-200">{cacheStats.keyframes}</strong>{' '}
            keyframes ·{' '}
            <strong className="text-neutral-200">
              {formatBytes(cacheStats.totalBytes)}
            </strong>
          </p>
        )}
      </div>

      <p className="text-xs text-neutral-500 text-center">
        Fáze 3.3 — AI náhled s crossfade mezi keyframes. Export AI módu přijde v 3.4+.
      </p>

      {/* Custom prompt modal (Fáze 4.4) */}
      {editPromptIdx !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={closePromptEditor}
        >
          <div
            className="w-full max-w-2xl rounded-2xl bg-neutral-900 border border-neutral-800 p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs uppercase tracking-wider text-neutral-500">
                  Custom prompt · keyframe {editPromptIdx + 1} / {KEYFRAME_COUNT}
                </div>
                <div className="text-sm text-neutral-400 mt-1">
                  Interval:{' '}
                  <span className="font-mono">
                    {formatSection(editPromptIdx, audioBuffer.duration)}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={closePromptEditor}
                className="h-8 w-8 flex items-center justify-center rounded-full bg-neutral-800 hover:bg-neutral-700 text-neutral-400 hover:text-neutral-200 transition-colors"
                aria-label="Zavřít"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            <textarea
              value={editPromptDraft}
              onChange={(e) => setEditPromptDraft(e.target.value)}
              rows={6}
              autoFocus
              placeholder="Popiš, co má AI nakreslit. Detail, barvy, atmosféra, styl…"
              className="w-full px-3 py-2 rounded-lg bg-neutral-950 border border-neutral-700 text-sm text-neutral-100 font-mono focus:outline-none focus:border-purple-500 resize-vertical"
            />

            <div className="text-xs text-neutral-500">
              <span className="text-neutral-400">Tip:</span> ponecháš prázdné = použije se defaultní prompt podle vybraného stylu.
              Při generování (nebo regenerování) tohoto slotu se použije tento custom prompt.
            </div>

            <div className="flex items-center justify-between gap-3 pt-2">
              <button
                type="button"
                onClick={resetPromptEditor}
                className="text-sm text-neutral-400 hover:text-neutral-200 transition-colors"
              >
                Reset na defaultní prompt
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={closePromptEditor}
                  className="px-4 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-sm transition-colors"
                >
                  Zrušit
                </button>
                <button
                  type="button"
                  onClick={savePromptEditor}
                  className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium transition-colors"
                >
                  Uložit prompt
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
