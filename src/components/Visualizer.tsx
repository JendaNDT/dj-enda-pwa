import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import butterchurn from '@webamp/butterchurn'
import butterchurnPresets from 'butterchurn-presets'
import type { Visualizer as ButterchurnVisualizer } from '@webamp/butterchurn'
import { PresetCombobox, type PresetComboboxHandle } from './PresetCombobox'
import { useFavorites } from '../lib/favorites'
import { usePresetThumbnails } from '../lib/usePresetThumbnails'
import type { VisualizerHandle } from '../types/visualizerHandle'

interface VisualizerProps {
  audioBuffer: AudioBuffer
  currentPreset: string
  onPresetChange: (key: string) => void
}

// Re-export pro App.tsx — výchozí preset key pro inicializaci.
export function pickInitialPreset(): string {
  return PRESET_KEYS[Math.floor(Math.random() * PRESET_KEYS.length)]
}

type PlaybackStatus = 'idle' | 'playing' | 'paused' | 'ended'

const CANVAS_WIDTH = 640
const CANVAS_HEIGHT = 360
const PRESET_BLEND_SECONDS = 2

// Načte presety jen jednou na úrovni modulu — knihovna jich má cca 150 a getPresets()
// vrací stejný objekt při každém volání.
const ALL_PRESETS = butterchurnPresets.getPresets()
const PRESET_KEYS = Object.keys(ALL_PRESETS).sort()

/**
 * Audio-reaktivní vizualizér s plnými controls.
 *
 * Audio routing:
 *   source ─→ gain ─→ destination      (slyšitelný výstup, ovlivněn volume)
 *          └─→ visualizer.connectAudio  (vizuál, plné spektrum)
 *
 * Pause/resume přes AudioContext.suspend()/resume() zachovává pozici přehrávání.
 * Po dohrání skladby (`onended`) lze přehrávání restartovat — vytvoří se nový
 * source, protože AudioBufferSourceNode je jednorázový.
 */
export const Visualizer = forwardRef<VisualizerHandle, VisualizerProps>(function Visualizer(
  { audioBuffer, currentPreset, onPresetChange },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const sourceRef = useRef<AudioBufferSourceNode | null>(null)
  const gainRef = useRef<GainNode | null>(null)
  const visualizerRef = useRef<ButterchurnVisualizer | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const comboboxRef = useRef<PresetComboboxHandle | null>(null)
  /** Silent oscillator + analyser pro idle preview (Fáze 5.11) — Butterchurn
   *  potřebuje nějakou audio node v `connectAudio`, jinak vidí undefined.
   *  V idle režimu krmíme analyser tichem, Butterchurn render preset s vlastní
   *  time-based logikou (pomalý drift bez audio reactivity). Při klik "Spustit"
   *  swapneme za reálný AudioBufferSourceNode. */
  const idleOscillatorRef = useRef<OscillatorNode | null>(null)
  const idleGainRef = useRef<GainNode | null>(null)

  const [status, setStatus] = useState<PlaybackStatus>('idle')
  const [volume, setVolume] = useState(0.8)
  const [error, setError] = useState<string | null>(null)

  // Memoizovaná lookup-řada pro combobox (jen referenční optimalizace).
  const presetOptions = useMemo(() => PRESET_KEYS, [])

  // Oblíbené presety Classic — perzistované v localStorage.
  const { favorites, toggle: toggleFavorite } = useFavorites('classic')

  // Náhledy presetů (Fáze 5.13) — cache v IndexedDB + background generování.
  // Pauza generování když hraje audio, ať nebereme GPU živému vizualizéru.
  const {
    thumbnails,
    generated: thumbsDone,
    total: thumbsTotal,
    generating: thumbsGenerating,
    regenerate: regenerateThumbs,
  } = usePresetThumbnails(presetOptions, ALL_PRESETS, {
    paused: status === 'playing',
  })

  // Cleanup při unmountu nebo změně audioBuffer (jiný soubor).
  useEffect(() => {
    return () => {
      stopAndCleanup()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioBuffer])

  // ─── Idle preview setup po mountu (Fáze 5.11) ────────────────────────────
  // Vytvoří Butterchurn vizualizér s silent oscillatorem napojeným přes analyser.
  // Preset se hýbe vlastním time-driven patternem (bez audio reactivity).
  // Při klik „Spustit náhled" se v start() oscilátor odpojí a připojí audio source.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let mounted = true
    let pendingResume: (() => void) | null = null

    const setupIdlePreview = async () => {
      try {
        const audioCtx = new AudioContext()
        if (!mounted) {
          await audioCtx.close()
          return
        }
        audioCtxRef.current = audioCtx

        // Silent oscillator → gain (0) → destination. Frekvence libovolná,
        // ale gain 0 zajistí ticho. Oscillator musí běžet, aby AnalyserNode
        // (přes connectAudio do Butterchurn) měl data k samplingu.
        const osc = audioCtx.createOscillator()
        osc.frequency.value = 110
        const idleGain = audioCtx.createGain()
        idleGain.gain.value = 0
        osc.connect(idleGain)
        idleGain.connect(audioCtx.destination)
        idleOscillatorRef.current = osc
        idleGainRef.current = idleGain

        // Butterchurn vizualizér.
        const visualizer = butterchurn.createVisualizer(audioCtx, canvas, {
          width: CANVAS_WIDTH,
          height: CANVAS_HEIGHT,
          pixelRatio: window.devicePixelRatio || 1,
        })
        visualizerRef.current = visualizer
        visualizer.connectAudio(osc)
        visualizer.loadPreset(ALL_PRESETS[currentPreset], 0)

        // Spustit oscillator. Pokud je context suspended (Chrome autoplay policy
        // před user gesture), pokus o start může selhat — pak resume při prvním
        // user gesture (klik kdekoliv).
        try {
          osc.start(0)
        } catch {
          // už spuštěný — ignorujeme
        }

        if (audioCtx.state === 'suspended') {
          // Naplánujeme resume při prvním user gesture na dokumentu.
          pendingResume = () => {
            audioCtx.resume().catch(() => {})
            document.removeEventListener('pointerdown', pendingResume!)
          }
          document.addEventListener('pointerdown', pendingResume)
        }

        // Render loop — i v suspended stavu Butterchurn renderuje preset
        // s time-driven motion (presety mají vlastní `time` uniforms).
        const renderFrame = () => {
          visualizer.render()
          animationFrameRef.current = requestAnimationFrame(renderFrame)
        }
        animationFrameRef.current = requestAnimationFrame(renderFrame)
      } catch (e: unknown) {
        // Idle preview failure není fatal — uživatel může kliknout Spustit
        // a normální pipeline se rozjede. Logujeme, ale nezobrazujeme error.
        console.warn('Idle preview setup failed:', e)
      }
    }

    void setupIdlePreview()

    return () => {
      mounted = false
      if (pendingResume) {
        document.removeEventListener('pointerdown', pendingResume)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioBuffer])

  const stopAndCleanup = () => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }
    if (sourceRef.current) {
      try {
        sourceRef.current.stop()
      } catch {
        // Source může být už zastavený nebo nikdy nespuštěný; ignorujeme.
      }
      sourceRef.current.disconnect()
      sourceRef.current = null
    }
    if (gainRef.current) {
      gainRef.current.disconnect()
      gainRef.current = null
    }
    if (idleOscillatorRef.current) {
      try {
        idleOscillatorRef.current.stop()
      } catch {
        // už zastavený
      }
      idleOscillatorRef.current.disconnect()
      idleOscillatorRef.current = null
    }
    if (idleGainRef.current) {
      idleGainRef.current.disconnect()
      idleGainRef.current = null
    }
    visualizerRef.current = null
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {})
      audioCtxRef.current = null
    }
  }

  const start = async () => {
    const canvas = canvasRef.current
    if (!canvas) return

    try {
      // Reuse existing idle preview AudioContext + Butterchurn vizualizér.
      // Pokud z nějakého důvodu chybí (idle preview selhal), fallback na fresh setup.
      let audioCtx = audioCtxRef.current
      let visualizer = visualizerRef.current

      if (!audioCtx || !visualizer) {
        // Fallback path — vytvoříme čerstvé, jako před 5.11.
        stopAndCleanup()
        audioCtx = new AudioContext()
        audioCtxRef.current = audioCtx
        visualizer = butterchurn.createVisualizer(audioCtx, canvas, {
          width: CANVAS_WIDTH,
          height: CANVAS_HEIGHT,
          pixelRatio: window.devicePixelRatio || 1,
        })
        visualizerRef.current = visualizer
        visualizer.loadPreset(ALL_PRESETS[currentPreset], 0)
      }

      // Resume context (Chrome autoplay policy uvolní gesture).
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume()
      }

      // Odpojit a zastavit silent oscillator z idle preview.
      if (idleOscillatorRef.current) {
        try {
          idleOscillatorRef.current.stop()
        } catch {
          // už zastavený
        }
        idleOscillatorRef.current.disconnect()
        idleOscillatorRef.current = null
      }
      if (idleGainRef.current) {
        idleGainRef.current.disconnect()
        idleGainRef.current = null
      }

      // Vytvořit reálný audio source z bufferu.
      const source = audioCtx.createBufferSource()
      source.buffer = audioBuffer
      sourceRef.current = source

      // GainNode pro hlasitost.
      const gain = audioCtx.createGain()
      gain.gain.value = volume
      gainRef.current = gain

      source.connect(gain)
      gain.connect(audioCtx.destination)

      // Přesměrovat Butterchurn na real source.
      visualizer.connectAudio(source)

      // Spustit přehrávání.
      source.start(0)
      setStatus('playing')
      setError(null)

      // Render loop už běží z idle preview useEffectu — pokud z nějakého důvodu
      // neběží (fallback path), spustíme ho teď.
      if (animationFrameRef.current === null) {
        const vis = visualizer
        const renderFrame = () => {
          vis.render()
          animationFrameRef.current = requestAnimationFrame(renderFrame)
        }
        animationFrameRef.current = requestAnimationFrame(renderFrame)
      }

      source.onended = () => {
        if (animationFrameRef.current !== null) {
          cancelAnimationFrame(animationFrameRef.current)
          animationFrameRef.current = null
        }
        // Pozn.: source.onended se může spustit i při manuálním stop() —
        // v tom případě stopAndCleanup() už status nastavil, takže
        // přepisování na 'ended' by bylo nesprávné. Kontrolujeme,
        // jestli ještě existuje audioCtx (po cleanup je null).
        if (audioCtxRef.current) {
          setStatus('ended')
        }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Neznámá chyba'
      setError(`Nelze spustit vizualizér: ${msg}`)
      stopAndCleanup()
      setStatus('idle')
    }
  }

  const togglePlayPause = async () => {
    const ctx = audioCtxRef.current
    if (!ctx) return

    if (status === 'playing') {
      await ctx.suspend()
      setStatus('paused')
    } else if (status === 'paused') {
      await ctx.resume()
      setStatus('playing')
    }
  }

  const changePreset = (key: string) => {
    onPresetChange(key)
    const vis = visualizerRef.current
    if (vis) {
      vis.loadPreset(ALL_PRESETS[key], PRESET_BLEND_SECONDS)
    }
  }

  const changeVolume = (v: number) => {
    setVolume(v)
    if (gainRef.current) {
      gainRef.current.gain.value = v
    }
  }

  const isRunning = status === 'playing' || status === 'paused'

  // Imperative API pro App.tsx keyboard shortcuts (Fáze 4.6).
  useImperativeHandle(
    ref,
    (): VisualizerHandle => ({
      togglePlayPause: () => {
        if (status === 'playing' || status === 'paused') {
          void togglePlayPause()
        } else {
          // Z idle stavu Space spustí náhled.
          void start()
        }
      },
      nextPreset: () => {
        const idx = presetOptions.indexOf(currentPreset)
        const next = presetOptions[(idx + 1) % presetOptions.length]
        if (next) changePreset(next)
      },
      prevPreset: () => {
        const idx = presetOptions.indexOf(currentPreset)
        const prev = presetOptions[(idx - 1 + presetOptions.length) % presetOptions.length]
        if (prev) changePreset(prev)
      },
      randomPreset: () => {
        const rand = presetOptions[Math.floor(Math.random() * presetOptions.length)]
        if (rand) changePreset(rand)
      },
      focusSearch: () => {
        comboboxRef.current?.focus()
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [status, currentPreset, presetOptions],
  )

  return (
    <div className="px-6 py-5 rounded-2xl bg-neutral-900 border border-neutral-800">
      <div className="text-xs uppercase tracking-wider text-neutral-500 mb-3">
        Vizualizér
      </div>

      <div className="relative w-full aspect-video bg-black rounded-lg overflow-hidden">
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          className="w-full h-full"
        />

        {/* Overlay pro idle a ended stavy — semi-transparent aby vizualizér
            byl vidět pod overlay (Fáze 5.6 + 5.11). Live preview běží z idle
            useEffectu, uživatel hned vidí, jak preset vypadá. */}
        {(status === 'idle' || status === 'ended') && !error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-neutral-950/70 via-purple-950/40 to-neutral-950/70 backdrop-blur-[2px]">
            <svg
              viewBox="0 0 48 48"
              className="h-16 w-16 mb-4 opacity-70 animate-pulse drop-shadow-[0_0_12px_rgba(147,51,234,0.6)]"
              aria-hidden="true"
            >
              <rect
                x="2"
                y="2"
                width="44"
                height="44"
                rx="10"
                fill="#0a0a0a"
                stroke="#9333ea"
                strokeWidth="2"
              />
              <circle cx="36" cy="12" r="2.5" fill="#9333ea" />
              <text
                x="24"
                y="32"
                textAnchor="middle"
                fontSize="16"
                fontFamily="system-ui, -apple-system, sans-serif"
                fontWeight="700"
                fill="#fafafa"
              >
                DJE
              </text>
            </svg>
            <button
              type="button"
              onClick={start}
              className="px-6 py-3 rounded-full bg-purple-600 hover:bg-purple-500 text-white font-medium transition-colors shadow-lg shadow-purple-900/40"
            >
              {status === 'ended' ? 'Spustit znovu' : 'Spustit náhled'}
            </button>
          </div>
        )}
      </div>

      {/* Control panel — vždy viditelný (Fáze 5.2).
          V idle stavu: play tlačítko spustí náhled, preset combobox a volume
          slider jsou aktivní (uživatel může vybrat preset / nastavit volume
          ještě před prvním spuštěním). */}
      <div className="mt-4 flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={isRunning ? togglePlayPause : start}
          className="h-10 w-10 flex items-center justify-center rounded-full bg-neutral-800 hover:bg-neutral-700 text-white transition-colors"
          aria-label={status === 'playing' ? 'Pauza' : 'Přehrát'}
        >
          {status === 'playing' ? (
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
              <rect x="6" y="5" width="4" height="14" rx="1" />
              <rect x="14" y="5" width="4" height="14" rx="1" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>

        <PresetCombobox
          ref={comboboxRef}
          options={presetOptions}
          value={currentPreset}
          onChange={changePreset}
          favorites={favorites}
          onToggleFavorite={toggleFavorite}
          thumbnails={thumbnails}
          thumbnailsGenerating={thumbsGenerating}
          thumbnailsDone={thumbsDone}
          thumbnailsTotal={thumbsTotal}
          className="flex-1 min-w-0"
        />

        <div className="flex items-center gap-2 min-w-[140px]">
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4 text-neutral-400 shrink-0"
            fill="currentColor"
          >
            <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3a4.5 4.5 0 0 0-2.5-4.03v8.06A4.5 4.5 0 0 0 16.5 12z" />
          </svg>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(e) => changeVolume(parseFloat(e.target.value))}
            className="flex-1 accent-purple-500"
            aria-label="Hlasitost"
          />
        </div>
      </div>

      {/* Náhledy presetů (Fáze 5.13) — progress během generování, jinak
          tlačítko přegenerovat. Decentní, zarovnané vpravo. */}
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          onClick={regenerateThumbs}
          disabled={thumbsGenerating}
          className="text-[11px] text-neutral-500 hover:text-neutral-300 disabled:opacity-50 disabled:cursor-default transition-colors"
          title="Smaže cache náhledů a vygeneruje je znovu"
        >
          {thumbsGenerating
            ? `Generuji náhledy… ${thumbsDone}/${thumbsTotal}`
            : '↻ Přegenerovat náhledy'}
        </button>
      </div>

      {error && (
        <div className="mt-3 px-3 py-2 rounded bg-red-950/50 border border-red-800 text-sm text-red-200">
          {error}
        </div>
      )}
    </div>
  )
})
