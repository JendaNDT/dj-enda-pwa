import { useEffect, useMemo, useRef, useState } from 'react'
import butterchurn from '@webamp/butterchurn'
import butterchurnPresets from 'butterchurn-presets'
import type { Visualizer as ButterchurnVisualizer } from '@webamp/butterchurn'

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
export function Visualizer({
  audioBuffer,
  currentPreset,
  onPresetChange,
}: VisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const sourceRef = useRef<AudioBufferSourceNode | null>(null)
  const gainRef = useRef<GainNode | null>(null)
  const visualizerRef = useRef<ButterchurnVisualizer | null>(null)
  const animationFrameRef = useRef<number | null>(null)

  const [status, setStatus] = useState<PlaybackStatus>('idle')
  const [volume, setVolume] = useState(0.8)
  const [error, setError] = useState<string | null>(null)

  // Memoizovaná lookup-řada pro select (jen referenční optimalizace).
  const presetOptions = useMemo(() => PRESET_KEYS, [])

  // Cleanup při unmountu nebo změně audioBuffer (jiný soubor).
  useEffect(() => {
    return () => {
      stopAndCleanup()
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
    visualizerRef.current = null
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {})
      audioCtxRef.current = null
    }
  }

  const start = async () => {
    const canvas = canvasRef.current
    if (!canvas) return

    // Pokud běží z předchozího spuštění (např. restart po 'ended'), nejdřív uklidíme.
    stopAndCleanup()

    try {
      // 1. AudioContext (uvnitř user gesture handleru kvůli autoplay policy).
      const audioCtx = new AudioContext()
      audioCtxRef.current = audioCtx

      // 2. Source node z dekódovaného AudioBufferu.
      const source = audioCtx.createBufferSource()
      source.buffer = audioBuffer
      sourceRef.current = source

      // 3. GainNode pro hlasitost — vložen mezi source a destination.
      const gain = audioCtx.createGain()
      gain.gain.value = volume
      gainRef.current = gain

      source.connect(gain)
      gain.connect(audioCtx.destination)

      // 4. Butterchurn vizualizér s aktuálním canvasem.
      const visualizer = butterchurn.createVisualizer(audioCtx, canvas, {
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        pixelRatio: window.devicePixelRatio || 1,
      })
      visualizerRef.current = visualizer

      // 5. Paralelně připojit source do vizualizéru (fan-out na source).
      //    Vizualizér tak vidí plné spektrum nezávisle na nastavení hlasitosti.
      visualizer.connectAudio(source)

      // 6. Načíst aktuálně vybraný preset.
      visualizer.loadPreset(ALL_PRESETS[currentPreset], 0)

      // 7. Spustit přehrávání a render loop.
      source.start(0)
      setStatus('playing')
      setError(null)

      const renderFrame = () => {
        visualizer.render()
        animationFrameRef.current = requestAnimationFrame(renderFrame)
      }
      animationFrameRef.current = requestAnimationFrame(renderFrame)

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

        {/* Overlay pro idle a ended stavy */}
        {(status === 'idle' || status === 'ended') && !error && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60">
            <button
              type="button"
              onClick={start}
              className="px-6 py-3 rounded-full bg-purple-600 hover:bg-purple-500 text-white font-medium transition-colors"
            >
              {status === 'ended' ? 'Spustit znovu' : 'Spustit náhled'}
            </button>
          </div>
        )}
      </div>

      {/* Control panel — viditelný jen když běží nebo je pozastaveno */}
      {isRunning && (
        <div className="mt-4 flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={togglePlayPause}
            className="h-10 w-10 flex items-center justify-center rounded-full bg-neutral-800 hover:bg-neutral-700 text-white transition-colors"
            aria-label={status === 'playing' ? 'Pauza' : 'Přehrát'}
          >
            {status === 'playing' ? (
              // Pause icon
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
                <rect x="6" y="5" width="4" height="14" rx="1" />
                <rect x="14" y="5" width="4" height="14" rx="1" />
              </svg>
            ) : (
              // Play icon
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>

          <select
            value={currentPreset}
            onChange={(e) => changePreset(e.target.value)}
            className="flex-1 min-w-0 h-10 px-3 rounded-lg bg-neutral-800 border border-neutral-700 text-sm text-neutral-100 focus:outline-none focus:border-purple-500"
          >
            {presetOptions.map((key) => (
              <option key={key} value={key}>
                {key}
              </option>
            ))}
          </select>

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
      )}

      {/* Idle / ended preset info (mimo control panel) */}
      {!isRunning && currentPreset && (
        <div className="mt-3 text-xs text-neutral-500">
          Preset: <span className="text-neutral-400">{currentPreset}</span>
        </div>
      )}

      {error && (
        <div className="mt-3 px-3 py-2 rounded bg-red-950/50 border border-red-800 text-sm text-red-200">
          {error}
        </div>
      )}
    </div>
  )
}
