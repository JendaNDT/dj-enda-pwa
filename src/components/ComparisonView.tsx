import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { WebGPURenderer } from 'three/webgpu'
import butterchurn from '@webamp/butterchurn'
import butterchurnPresets from 'butterchurn-presets'
import type { Visualizer as ButterchurnVisualizer } from '@webamp/butterchurn'
import { extractFeatures, type AudioFeatures } from '../lib/audioFeatures'
import {
  createUniforms,
  getPresetById,
  MODERN_PRESETS,
  type ModernPreset,
  type PresetInstance,
  type VisualizerUniforms,
} from '../lib/modernPresets'

interface ComparisonViewProps {
  audioBuffer: AudioBuffer
  /** Aktuální Classic (Butterchurn) preset — sdílený s Classic módem v App. */
  classicPreset: string
  onClassicPresetChange: (key: string) => void
  /** Aktuální Modern (Three TSL) preset id — sdílený s Modern módem v App. */
  modernPresetId: string
  onModernPresetChange: (id: string) => void
}

type Status = 'idle' | 'analyzing' | 'playing' | 'paused' | 'ended'

const CANVAS_WIDTH = 640
const CANVAS_HEIGHT = 360
const TARGET_FPS = 60
const PRESET_BLEND_SECONDS = 2

// Stejný pattern jako Visualizer.tsx — načte se jednou na úrovni modulu.
const ALL_PRESETS = butterchurnPresets.getPresets()
const PRESET_KEYS = Object.keys(ALL_PRESETS).sort()

/** Malé tlačítko „Náhodný preset" pro dlaždici. Modulová úroveň (ne uvnitř
 *  komponenty), aby se nevytvářelo při každém renderu. */
function RandomButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 px-2.5 h-8 flex items-center gap-1 rounded-lg bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-xs text-neutral-300 transition-colors"
      title="Náhodný preset"
    >
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
      </svg>
      Náhodný
    </button>
  )
}

/**
 * Comparison mode (Fáze 5.12) — Classic (Butterchurn) a Modern (Three.js TSL)
 * vedle sebe nad **jedním sdíleným audio zdrojem**.
 *
 * Sdílené audio:
 *   - Jeden `AudioContext`, jeden `AudioBufferSourceNode` → gain → destination
 *     (slyšitelný výstup).
 *   - Classic: `butterchurn.connectAudio(source)` — Butterchurn si z node staví
 *     vlastní analyser (real-time spektrum).
 *   - Modern: čte předpočítané Meyda features indexované přes
 *     `audioCtx.currentTime − startTime` (stejně jako ThreeVisualizer).
 *   - Jeden `requestAnimationFrame` loop renderuje oba enginy → dokonalý sync.
 *
 * Idle preview: před spuštěním běží Classic přes tichý oscilátor (jako 5.11)
 * a Modern v decay módu (wall-clock audioTime), takže oba dlaždice „žijí".
 *
 * Tenhle komponent je záměrně samostatný — nesahá do funkčních Classic / Modern
 * / AI módů, aby comparison nemohl způsobit regrese.
 */
export function ComparisonView({
  audioBuffer,
  classicPreset,
  onClassicPresetChange,
  modernPresetId,
  onModernPresetChange,
}: ComparisonViewProps) {
  const classicCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const modernCanvasRef = useRef<HTMLCanvasElement | null>(null)

  // Sdílené audio.
  const ctxRef = useRef<AudioContext | null>(null)
  const sourceRef = useRef<AudioBufferSourceNode | null>(null)
  const gainRef = useRef<GainNode | null>(null)
  const audioStartTimeRef = useRef<number>(0)
  const idleOscRef = useRef<OscillatorNode | null>(null)
  const idleGainRef = useRef<GainNode | null>(null)

  // Classic (Butterchurn).
  const bcVisRef = useRef<ButterchurnVisualizer | null>(null)

  // Modern (Three).
  const rendererRef = useRef<WebGPURenderer | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const uniformsRef = useRef<VisualizerUniforms | null>(null)
  const presetInstanceRef = useRef<PresetInstance | null>(null)

  // Features + render loop.
  const featuresRef = useRef<AudioFeatures | null>(null)
  const beatDecayRef = useRef<number>(0)
  const rafRef = useRef<number | null>(null)
  const lastFrameTimeRef = useRef<number>(0)

  // Aktuální presety dostupné uvnitř setup efektu bez jeho restartu.
  const classicPresetRef = useRef(classicPreset)
  const modernPresetIdRef = useRef(modernPresetId)

  const [status, setStatus] = useState<Status>('idle')
  const [volume, setVolume] = useState(0.8)
  const [error, setError] = useState<string | null>(null)
  const [analysisProgress, setAnalysisProgress] = useState(0)

  // ─── Aplikace Modern presetu ─────────────────────────────────────────────
  const applyPreset = (preset: ModernPreset) => {
    const scene = sceneRef.current
    const uniforms = uniformsRef.current
    if (!scene || !uniforms) return
    if (presetInstanceRef.current) {
      presetInstanceRef.current.dispose()
      presetInstanceRef.current = null
    }
    try {
      presetInstanceRef.current = preset.setup(scene, uniforms)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Neznámá chyba'
      setError(`Modern preset "${preset.name}" selhal: ${msg}`)
    }
  }

  // ─── Setup obou enginů + idle preview (mount / změna audioBufferu) ────────
  useEffect(() => {
    const classicCanvas = classicCanvasRef.current
    const modernCanvas = modernCanvasRef.current
    if (!classicCanvas || !modernCanvas) return

    let cancelled = false
    let pendingResume: (() => void) | null = null

    const setup = async () => {
      try {
        // Sdílený AudioContext + tichý oscilátor pro Classic idle preview.
        const ctx = new AudioContext()
        if (cancelled) {
          await ctx.close()
          return
        }
        ctxRef.current = ctx

        const osc = ctx.createOscillator()
        osc.frequency.value = 110
        const idleGain = ctx.createGain()
        idleGain.gain.value = 0
        osc.connect(idleGain)
        idleGain.connect(ctx.destination)
        idleOscRef.current = osc
        idleGainRef.current = idleGain

        // Classic — Butterchurn.
        const bcVis = butterchurn.createVisualizer(ctx, classicCanvas, {
          width: CANVAS_WIDTH,
          height: CANVAS_HEIGHT,
          pixelRatio: window.devicePixelRatio || 1,
        })
        bcVisRef.current = bcVis
        bcVis.connectAudio(osc)
        bcVis.loadPreset(
          ALL_PRESETS[classicPresetRef.current] ?? ALL_PRESETS[PRESET_KEYS[0]],
          0,
        )
        try {
          osc.start(0)
        } catch {
          // už spuštěný
        }
        if (ctx.state === 'suspended') {
          pendingResume = () => {
            ctx.resume().catch(() => {})
            if (pendingResume) document.removeEventListener('pointerdown', pendingResume)
          }
          document.addEventListener('pointerdown', pendingResume)
        }

        // Modern — Three WebGPU.
        const renderer = new WebGPURenderer({ canvas: modernCanvas, antialias: true })
        renderer.setSize(CANVAS_WIDTH, CANVAS_HEIGHT, false)
        renderer.setClearColor(0x0a0a0a, 1)
        await renderer.init()
        if (cancelled) {
          renderer.dispose()
          return
        }
        rendererRef.current = renderer

        const scene = new THREE.Scene()
        sceneRef.current = scene
        const camera = new THREE.PerspectiveCamera(
          60,
          CANVAS_WIDTH / CANVAS_HEIGHT,
          0.1,
          1000,
        )
        camera.position.z = 3
        cameraRef.current = camera
        uniformsRef.current = createUniforms()
        applyPreset(getPresetById(modernPresetIdRef.current) ?? MODERN_PRESETS[0])

        // eslint-disable-next-line react-hooks/immutability
        startRenderLoop()
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Neznámá chyba'
        setError(`Comparison setup selhal: ${msg}`)
      }
    }

    void setup()

    return () => {
      cancelled = true
      if (pendingResume) document.removeEventListener('pointerdown', pendingResume)
      // eslint-disable-next-line react-hooks/immutability
      cleanupAll()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioBuffer])

  // Změna Classic presetu zvenku.
  useEffect(() => {
    classicPresetRef.current = classicPreset
    bcVisRef.current?.loadPreset(
      ALL_PRESETS[classicPreset] ?? ALL_PRESETS[PRESET_KEYS[0]],
      PRESET_BLEND_SECONDS,
    )
  }, [classicPreset])

  // Změna Modern presetu zvenku.
  useEffect(() => {
    modernPresetIdRef.current = modernPresetId
    const p = getPresetById(modernPresetId)
    if (p && sceneRef.current && uniformsRef.current) applyPreset(p)
  }, [modernPresetId])

  // ─── Render loop (oba enginy v jednom ticku) ─────────────────────────────
  const startRenderLoop = () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)

    const tick = () => {
      const now = performance.now()
      const deltaTime = lastFrameTimeRef.current
        ? (now - lastFrameTimeRef.current) / 1000
        : 0
      lastFrameTimeRef.current = now

      // Modern.
      const renderer = rendererRef.current
      const scene = sceneRef.current
      const camera = cameraRef.current
      const uniforms = uniformsRef.current
      if (renderer && scene && camera && uniforms) {
        const ctx = ctxRef.current
        const features = featuresRef.current
        if (ctx && features && ctx.state === 'running') {
          const elapsed = ctx.currentTime - audioStartTimeRef.current
          const frameIdx = Math.min(
            features.totalFrames - 1,
            Math.max(0, Math.floor(elapsed * features.fps)),
          )
          uniforms.rms.value = features.rms[frameIdx]
          uniforms.low.value = features.low[frameIdx]
          uniforms.mid.value = features.mid[frameIdx]
          uniforms.high.value = features.high[frameIdx]
          uniforms.centroid.value = features.spectralCentroid[frameIdx]
          uniforms.audioTime.value = elapsed
          const beatNow = features.beat[frameIdx]
          beatDecayRef.current = Math.max(beatNow, beatDecayRef.current * 0.85)
          uniforms.beat.value = beatDecayRef.current
        } else {
          uniforms.rms.value *= 0.92
          uniforms.low.value *= 0.92
          uniforms.mid.value *= 0.92
          uniforms.high.value *= 0.92
          uniforms.beat.value *= 0.85
          uniforms.centroid.value = uniforms.centroid.value * 0.9 + 0.5 * 0.1
          uniforms.audioTime.value += deltaTime
        }
        if (presetInstanceRef.current?.update) {
          presetInstanceRef.current.update(uniforms, deltaTime)
        }
        renderer.render(scene, camera)
      }

      // Classic.
      const bcVis = bcVisRef.current
      if (bcVis) {
        try {
          bcVis.render()
        } catch {
          // ojedinělý render error nesmí shodit celý loop
        }
      }

      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
  }

  // ─── Audio nodes ─────────────────────────────────────────────────────────
  const stopAudioNodes = () => {
    if (sourceRef.current) {
      try {
        sourceRef.current.stop()
      } catch {
        // už zastavený
      }
      sourceRef.current.disconnect()
      sourceRef.current = null
    }
    if (gainRef.current) {
      gainRef.current.disconnect()
      gainRef.current = null
    }
    if (idleOscRef.current) {
      try {
        idleOscRef.current.stop()
      } catch {
        // už zastavený
      }
      idleOscRef.current.disconnect()
      idleOscRef.current = null
    }
    if (idleGainRef.current) {
      idleGainRef.current.disconnect()
      idleGainRef.current = null
    }
  }

  const cleanupAll = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    stopAudioNodes()
    if (presetInstanceRef.current) {
      presetInstanceRef.current.dispose()
      presetInstanceRef.current = null
    }
    bcVisRef.current = null
    if (rendererRef.current) {
      rendererRef.current.dispose()
      rendererRef.current = null
    }
    if (ctxRef.current) {
      ctxRef.current.close().catch(() => {})
      ctxRef.current = null
    }
  }

  // ─── Akce ────────────────────────────────────────────────────────────────
  const start = async () => {
    const ctx = ctxRef.current
    if (!ctx) return
    try {
      // 1) Meyda features pro Modern (idle oscilátor zatím dál krmí Classic).
      if (!featuresRef.current) {
        setStatus('analyzing')
        setAnalysisProgress(0)
        featuresRef.current = await extractFeatures(audioBuffer, TARGET_FPS, (pct) => {
          setAnalysisProgress(pct)
        })
      }

      if (ctx.state === 'suspended') await ctx.resume()

      // 2) Zahodit idle oscilátor (i případný předchozí source při restartu).
      stopAudioNodes()

      // 3) Reálný sdílený source.
      const source = ctx.createBufferSource()
      source.buffer = audioBuffer
      sourceRef.current = source
      const gain = ctx.createGain()
      gain.gain.value = volume
      gainRef.current = gain
      source.connect(gain)
      gain.connect(ctx.destination)

      // Classic přepojit na reálný source.
      bcVisRef.current?.connectAudio(source)

      source.start(0)
      audioStartTimeRef.current = ctx.currentTime
      beatDecayRef.current = 0
      setStatus('playing')
      setError(null)

      source.onended = () => {
        if (ctxRef.current) setStatus('ended')
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Neznámá chyba'
      setError(`Nelze spustit srovnání: ${msg}`)
      setStatus('idle')
    }
  }

  const togglePlayPause = async () => {
    const ctx = ctxRef.current
    if (!ctx) return
    if (status === 'playing') {
      await ctx.suspend()
      setStatus('paused')
    } else if (status === 'paused') {
      await ctx.resume()
      setStatus('playing')
    }
  }

  const changeVolume = (v: number) => {
    setVolume(v)
    if (gainRef.current) gainRef.current.gain.value = v
  }

  const randomClassic = () => {
    const k = PRESET_KEYS[Math.floor(Math.random() * PRESET_KEYS.length)]
    if (k) onClassicPresetChange(k)
  }
  const randomModern = () => {
    const p = MODERN_PRESETS[Math.floor(Math.random() * MODERN_PRESETS.length)]
    if (p) onModernPresetChange(p.id)
  }

  const isRunning = status === 'playing' || status === 'paused'
  const modernName = getPresetById(modernPresetId)?.name ?? modernPresetId

  return (
    <div className="px-6 py-5 rounded-2xl bg-neutral-900 border border-neutral-800">
      <div className="text-xs uppercase tracking-wider text-neutral-500 mb-3">
        Srovnání · Classic vs Modern
      </div>

      <div className="relative">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Classic */}
          <div>
            <div className="relative w-full aspect-video bg-black rounded-lg overflow-hidden">
              <canvas
                ref={classicCanvasRef}
                width={CANVAS_WIDTH}
                height={CANVAS_HEIGHT}
                className="w-full h-full"
              />
              <span className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-black/60 backdrop-blur-sm text-[10px] uppercase tracking-wider text-neutral-300">
                Classic
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-xs text-neutral-300 font-medium">
                  Butterchurn
                </div>
                <div className="text-[11px] text-neutral-500 truncate" title={classicPreset}>
                  {classicPreset}
                </div>
              </div>
              <RandomButton onClick={randomClassic} />
            </div>
          </div>

          {/* Modern */}
          <div>
            <div className="relative w-full aspect-video bg-black rounded-lg overflow-hidden">
              <canvas
                ref={modernCanvasRef}
                width={CANVAS_WIDTH}
                height={CANVAS_HEIGHT}
                className="w-full h-full"
              />
              <span className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-black/60 backdrop-blur-sm text-[10px] uppercase tracking-wider text-neutral-300">
                Modern
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-xs text-neutral-300 font-medium">
                  Three.js (TSL)
                </div>
                <div className="text-[11px] text-neutral-500 truncate" title={modernName}>
                  {modernName}
                </div>
              </div>
              <RandomButton onClick={randomModern} />
            </div>
          </div>
        </div>

        {/* Analyzing overlay (přes celý grid). */}
        {status === 'analyzing' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 gap-3 rounded-lg">
            <div className="h-5 w-5 rounded-full border-2 border-purple-500 border-t-transparent animate-spin" />
            <div className="text-sm text-neutral-200">Analyzuji audio přes Meyda…</div>
            <div className="h-1.5 w-48 rounded-full bg-neutral-800 overflow-hidden">
              <div
                className="h-full bg-purple-600 transition-all duration-200"
                style={{ width: `${(analysisProgress * 100).toFixed(0)}%` }}
              />
            </div>
            <div className="text-xs text-neutral-500">
              {(analysisProgress * 100).toFixed(0)} %
            </div>
          </div>
        )}
      </div>

      {/* Společný control panel. */}
      {status !== 'analyzing' && (
        <div className="mt-4 flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={isRunning ? togglePlayPause : start}
            className="h-10 px-4 flex items-center gap-2 rounded-full bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium transition-colors shadow-lg shadow-purple-900/40"
            aria-label={status === 'playing' ? 'Pauza' : 'Přehrát'}
          >
            {status === 'playing' ? (
              <>
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
                  <rect x="6" y="5" width="4" height="14" rx="1" />
                  <rect x="14" y="5" width="4" height="14" rx="1" />
                </svg>
                Pauza
              </>
            ) : (
              <>
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
                  <path d="M8 5v14l11-7z" />
                </svg>
                {status === 'idle' ? 'Spustit srovnání' : status === 'ended' ? 'Spustit znovu' : 'Pokračovat'}
              </>
            )}
          </button>

          <div className="flex items-center gap-2 min-w-[140px] flex-1">
            <svg viewBox="0 0 24 24" className="h-4 w-4 text-neutral-400 shrink-0" fill="currentColor">
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

      {error && (
        <div className="mt-3 px-3 py-2 rounded bg-red-950/50 border border-red-800 text-sm text-red-200">
          {error}
        </div>
      )}

      <div className="mt-3 text-[11px] text-neutral-500">
        Oba enginy běží na stejný zvuk se sdíleným zdrojem. Až si vybereš, který
        sedí, exportuj ho v daném módu (Classic / Modern).
      </div>
    </div>
  )
}
