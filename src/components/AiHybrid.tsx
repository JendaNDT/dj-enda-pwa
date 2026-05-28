import { useEffect, useMemo, useRef, useState } from 'react'
import {
  getHfToken,
  setHfToken,
  clearHfToken,
  describeRateLimit,
  maskToken,
  generateImage,
} from '../lib/hfClient'
import {
  hashAudioBuffer,
  getCachedKeyframes,
  setCachedKeyframes,
} from '../lib/aiCache'
import { AiVisualizer } from './AiVisualizer'
import { ExportButton } from './ExportButton'

interface AiHybridPropsWithFilename {
  audioBuffer: AudioBuffer
  audioFilename: string
}

interface AiHybridProps extends AiHybridPropsWithFilename {}

interface Keyframe {
  id: string
  prompt: string
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
  const [styleId, setStyleId] = useState<string>(STYLE_OPTIONS[0].id)
  const [keyframes, setKeyframes] = useState<Keyframe[]>(() =>
    buildInitialKeyframes(audioBuffer.duration, STYLE_OPTIONS[0]),
  )
  const [isGenerating, setIsGenerating] = useState(false)
  const [cacheStatus, setCacheStatus] = useState<
    'unknown' | 'checking' | 'hit' | 'miss'
  >('unknown')
  const audioHashRef = useRef<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

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
    // Reset všechny keyframes na nový styl (pokud nejsou hotové)
    setKeyframes((prev) =>
      prev.map((kf, i) => ({
        ...kf,
        prompt: buildPrompt(newStyle, i + 1),
        // Necháme image URL pokud uživatel chce ho behold; nová generace ho přepíše.
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
      const blob = await generateImage(kf.prompt, {
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
      {/* HF Token karta */}
      <div className="px-6 py-5 rounded-2xl bg-neutral-900 border border-neutral-800 transition-colors hover:border-neutral-700">
        <div className="text-xs uppercase tracking-wider text-neutral-500 mb-2">
          HuggingFace token (volitelný)
        </div>

        {hasToken ? (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
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
              <span className="text-sm text-neutral-200 font-mono">
                {maskToken(storedToken!)}
              </span>
            </div>
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
        ) : (
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
        )}
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

      <p className="text-xs text-neutral-500 text-center">
        Fáze 3.3 — AI náhled s crossfade mezi keyframes. Export AI módu přijde v 3.4+.
      </p>
    </div>
  )
}
