import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { WebGPURenderer } from 'three/webgpu'
import { extractFeatures, type AudioFeatures } from '../lib/audioFeatures'
import {
  createUniforms,
  getPresetById,
  MODERN_PRESETS,
  type ModernPreset,
  type PresetInstance,
  type VisualizerUniforms,
} from '../lib/modernPresets'

interface ThreeVisualizerProps {
  audioBuffer: AudioBuffer
  currentPresetId: string
  onPresetChange: (id: string) => void
}

type PlaybackStatus =
  | 'idle'
  | 'analyzing'
  | 'playing'
  | 'paused'
  | 'ended'

const CANVAS_WIDTH = 640
const CANVAS_HEIGHT = 360
const TARGET_FPS = 60

/**
 * Modern vizualizér s TSL preset systémem (Fáze 2.3a).
 *
 * Změny oproti 2.2:
 *   - Místo hardcoded icosahedron používá `ModernPreset.setup()` z `modernPresets.ts`.
 *   - Sdílené `VisualizerUniforms` (rms / beat / centroid) se aktualizují per snímek
 *     z Meyda features. Preset si je váže do TSL node grafu, render loop je jen
 *     vepisuje `uniform.value = …`.
 *   - Preset selector dropdown ve UI (po startu).
 */
export function ThreeVisualizer({
  audioBuffer,
  currentPresetId,
  onPresetChange,
}: ThreeVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameTimeRef = useRef<number>(0)

  const rendererRef = useRef<WebGPURenderer | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const uniformsRef = useRef<VisualizerUniforms | null>(null)
  const presetInstanceRef = useRef<PresetInstance | null>(null)
  const currentPresetIdRef = useRef<string>(currentPresetId)

  const audioCtxRef = useRef<AudioContext | null>(null)
  const sourceRef = useRef<AudioBufferSourceNode | null>(null)
  const gainRef = useRef<GainNode | null>(null)
  const audioStartTimeRef = useRef<number>(0)

  const featuresRef = useRef<AudioFeatures | null>(null)
  const beatDecayRef = useRef<number>(0)

  const [backendName, setBackendName] = useState<string>('inicializuji…')
  const [status, setStatus] = useState<PlaybackStatus>('idle')
  const [volume, setVolume] = useState(0.8)
  const [error, setError] = useState<string | null>(null)
  const [analysisProgress, setAnalysisProgress] = useState(0)

  // ─── Aplikace presetu ────────────────────────────────────────────────────
  const applyPreset = (preset: ModernPreset) => {
    const scene = sceneRef.current
    const uniforms = uniformsRef.current
    if (!scene || !uniforms) return

    // Dispose předchozí instance
    if (presetInstanceRef.current) {
      presetInstanceRef.current.dispose()
      presetInstanceRef.current = null
    }

    // Setup nový
    try {
      presetInstanceRef.current = preset.setup(scene, uniforms)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Neznámá chyba'
      setError(`Preset "${preset.name}" selhal: ${msg}`)
    }
  }

  // ─── Setup scény a renderer ──────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let cancelled = false

    const setup = async () => {
      try {
        const renderer = new WebGPURenderer({ canvas, antialias: true })
        renderer.setSize(CANVAS_WIDTH, CANVAS_HEIGHT, false)
        renderer.setClearColor(0x0a0a0a, 1)
        await renderer.init()

        if (cancelled) {
          renderer.dispose()
          return
        }

        rendererRef.current = renderer

        const isWebGPU =
          renderer.backend?.constructor.name === 'WebGPUBackend' ||
          'requestAdapter' in (renderer.backend ?? {})
        setBackendName(isWebGPU ? 'WebGPU' : 'WebGL2 (fallback)')

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

        // Vytvořit sdílené uniformy
        uniformsRef.current = createUniforms()

        // Aplikovat výchozí preset
        const initial =
          getPresetById(currentPresetIdRef.current) ?? MODERN_PRESETS[0]
        applyPreset(initial)

        startRenderLoop()
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Neznámá chyba'
        setError(`Three.js setup selhal: ${msg}`)
      }
    }

    setup()

    return () => {
      cancelled = true
      cleanupAll()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Změna presetu zvenku
  useEffect(() => {
    currentPresetIdRef.current = currentPresetId
    const preset = getPresetById(currentPresetId)
    if (preset && sceneRef.current && uniformsRef.current) {
      applyPreset(preset)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPresetId])

  // Při změně audioBufferu zastav audio + invalidovat features
  useEffect(() => {
    return () => {
      stopAudio()
      featuresRef.current = null
      setStatus('idle')
      setAnalysisProgress(0)
    }
  }, [audioBuffer])

  // ─── Render loop ─────────────────────────────────────────────────────────
  const startRenderLoop = () => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current)
    }

    const tick = () => {
      const renderer = rendererRef.current
      const scene = sceneRef.current
      const camera = cameraRef.current
      const uniforms = uniformsRef.current

      if (!renderer || !scene || !camera || !uniforms) {
        animationFrameRef.current = requestAnimationFrame(tick)
        return
      }

      const now = performance.now()
      const deltaTime = lastFrameTimeRef.current
        ? (now - lastFrameTimeRef.current) / 1000
        : 0
      lastFrameTimeRef.current = now

      const audioCtx = audioCtxRef.current
      const features = featuresRef.current

      if (audioCtx && features && audioCtx.state === 'running') {
        // Reaktivní režim
        const elapsed = audioCtx.currentTime - audioStartTimeRef.current
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
        // Idle / paused / ended — decay reactive uniforms; audioTime pokračuje
        // wall-clock tempem, aby se shadery neuzamkly.
        uniforms.rms.value *= 0.92
        uniforms.low.value *= 0.92
        uniforms.mid.value *= 0.92
        uniforms.high.value *= 0.92
        uniforms.beat.value *= 0.85
        uniforms.centroid.value =
          uniforms.centroid.value * 0.9 + 0.5 * 0.1
        uniforms.audioTime.value += deltaTime
      }

      // Preset update (rotation atd.)
      if (presetInstanceRef.current?.update) {
        presetInstanceRef.current.update(uniforms, deltaTime)
      }

      renderer.render(scene, camera)
      animationFrameRef.current = requestAnimationFrame(tick)
    }

    animationFrameRef.current = requestAnimationFrame(tick)
  }

  // ─── Cleanup ─────────────────────────────────────────────────────────────
  const cleanupAll = () => {
    stopAudio()
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }
    if (presetInstanceRef.current) {
      presetInstanceRef.current.dispose()
      presetInstanceRef.current = null
    }
    if (rendererRef.current) {
      rendererRef.current.dispose()
      rendererRef.current = null
    }
  }

  const stopAudio = () => {
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
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {})
      audioCtxRef.current = null
    }
  }

  // ─── Akce ────────────────────────────────────────────────────────────────
  const start = async () => {
    try {
      stopAudio()

      if (!featuresRef.current) {
        setStatus('analyzing')
        setAnalysisProgress(0)
        const f = await extractFeatures(audioBuffer, TARGET_FPS, (pct) => {
          setAnalysisProgress(pct)
        })
        featuresRef.current = f
      }

      const audioCtx = new AudioContext()
      audioCtxRef.current = audioCtx

      const source = audioCtx.createBufferSource()
      source.buffer = audioBuffer
      sourceRef.current = source

      const gain = audioCtx.createGain()
      gain.gain.value = volume
      gainRef.current = gain

      source.connect(gain)
      gain.connect(audioCtx.destination)

      source.start(0)
      audioStartTimeRef.current = audioCtx.currentTime
      beatDecayRef.current = 0
      setStatus('playing')
      setError(null)

      source.onended = () => {
        if (audioCtxRef.current) {
          setStatus('ended')
        }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Neznámá chyba'
      setError(`Nelze spustit audio: ${msg}`)
      stopAudio()
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

  const changeVolume = (v: number) => {
    setVolume(v)
    if (gainRef.current) {
      gainRef.current.gain.value = v
    }
  }

  const isRunning = status === 'playing' || status === 'paused'

  return (
    <div className="px-6 py-5 rounded-2xl bg-neutral-900 border border-neutral-800">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs uppercase tracking-wider text-neutral-500">
          Vizualizér · Modern (Three.js)
        </div>
        <div className="text-xs text-neutral-500">
          Backend: <span className="text-neutral-400">{backendName}</span>
        </div>
      </div>

      <div className="relative w-full aspect-video bg-black rounded-lg overflow-hidden">
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          className="w-full h-full"
        />

        {status === 'analyzing' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 gap-3">
            <div className="h-5 w-5 rounded-full border-2 border-purple-500 border-t-transparent animate-spin" />
            <div className="text-sm text-neutral-200">
              Analyzuji audio přes Meyda…
            </div>
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

      {isRunning && (
        <div className="mt-4 flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={togglePlayPause}
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

          <select
            value={currentPresetId}
            onChange={(e) => onPresetChange(e.target.value)}
            className="flex-1 min-w-0 h-10 px-3 rounded-lg bg-neutral-800 border border-neutral-700 text-sm text-neutral-100 focus:outline-none focus:border-purple-500"
          >
            {MODERN_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
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

      {error && (
        <div className="mt-3 px-3 py-2 rounded bg-red-950/50 border border-red-800 text-sm text-red-200">
          {error}
        </div>
      )}

      <div className="mt-3 text-xs text-neutral-500">
        Fáze 2.3a — první TSL preset (Sphere Distortion). Další 2 presety přijdou
        v 2.3b a 2.3c.
      </div>
    </div>
  )
}
