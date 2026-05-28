import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { WebGPURenderer } from 'three/webgpu'
import {
  Fn,
  uniform,
  uv,
  vec2,
  vec3,
  texture,
  mix,
  sin,
  float,
  length,
  oneMinus,
  smoothstep,
  fract,
} from 'three/tsl'
import { extractFeatures, type AudioFeatures } from '../lib/audioFeatures'

interface AiVisualizerProps {
  audioBuffer: AudioBuffer
  /** Pouze keyframes se statusem 'ready' a non-null imageUrl. */
  imageUrls: ReadonlyArray<string>
}

type PlaybackStatus = 'idle' | 'preparing' | 'playing' | 'paused' | 'ended'

const CANVAS_WIDTH = 640
const CANVAS_HEIGHT = 360
const TARGET_FPS = 60
const KEYFRAME_COUNT = 8
const ATLAS_COLS = 4
const ATLAS_ROWS = 2

// Cell size v atlasu — 640×360 = 16:9 přesně odpovídá náhledu.
const CELL_WIDTH = 640
const CELL_HEIGHT = 360
const ATLAS_WIDTH = CELL_WIDTH * ATLAS_COLS // 2560
const ATLAS_HEIGHT = CELL_HEIGHT * ATLAS_ROWS // 720

/**
 * Vykreslí všech 8 keyframes do jediného atlas canvasu 4×2.
 * Pokud nějaký URL chybí, použijeme předchozí (cycle to last ready).
 */
async function buildAtlasCanvas(
  imageUrls: ReadonlyArray<string>,
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas')
  canvas.width = ATLAS_WIDTH
  canvas.height = ATLAS_HEIGHT
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#0a0a0a'
  ctx.fillRect(0, 0, ATLAS_WIDTH, ATLAS_HEIGHT)

  const loaders: Array<Promise<HTMLImageElement | null>> = imageUrls.map(
    (url) =>
      new Promise<HTMLImageElement | null>((resolve) => {
        const img = new Image()
        img.crossOrigin = 'anonymous'
        img.onload = () => resolve(img)
        img.onerror = () => resolve(null)
        img.src = url
      }),
  )
  const images = await Promise.all(loaders)

  // Vyplníme všech 8 slotů. Pokud jeden chybí, použijeme poslední úspěšný.
  let lastImg: HTMLImageElement | null = null
  for (let i = 0; i < KEYFRAME_COUNT; i++) {
    const img: HTMLImageElement | null = images[i] ?? lastImg
    if (img) lastImg = img
    if (!img) continue

    const col = i % ATLAS_COLS
    const row = Math.floor(i / ATLAS_COLS)
    const dx = col * CELL_WIDTH
    const dy = row * CELL_HEIGHT
    ctx.drawImage(img, dx, dy, CELL_WIDTH, CELL_HEIGHT)
  }

  return canvas
}

/**
 * AI vizualizér — pro 8 keyframes vygenerovaných ve Fázi 3.2.
 *
 * Pipeline:
 *   1. Při startu sestavíme atlas canvas (8 obrazů v 4×2 gridu).
 *   2. CanvasTexture → TSL shader.
 *   3. Shader v každém frame podle `keyframeIdx` (= `audioTime × 7 / duration`)
 *      sampluje dva sousední atlas slots a crossfaduje je.
 *   4. Audio uniformy přidávají RMS zoom efekt + beat brightness boost.
 */
export function AiVisualizer({ audioBuffer, imageUrls }: AiVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameTimeRef = useRef<number>(0)

  const rendererRef = useRef<WebGPURenderer | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const atlasTextureRef = useRef<THREE.CanvasTexture | null>(null)
  const meshRef = useRef<THREE.Mesh | null>(null)

  // TSL uniformy — sdílíme s shaderem skrz closure v setup().
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const uniformsRef = useRef<Record<string, any> | null>(null)

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
  const [prepareProgress, setPrepareProgress] = useState(0)

  // ─── Setup scény ─────────────────────────────────────────────────────────
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

        // Atlas canvas + textura
        const atlasCanvas = await buildAtlasCanvas(imageUrls)
        if (cancelled) return

        const atlasTexture = new THREE.CanvasTexture(atlasCanvas)
        atlasTexture.colorSpace = THREE.SRGBColorSpace
        atlasTextureRef.current = atlasTexture

        // Scene + camera
        const scene = new THREE.Scene()
        sceneRef.current = scene
        const camera = new THREE.PerspectiveCamera(
          60,
          CANVAS_WIDTH / CANVAS_HEIGHT,
          0.1,
          10,
        )
        camera.position.z = 1.74 // FOV 60°, height 2 → fits 16:9 plane width 3.56
        cameraRef.current = camera

        // Plane geometry — pevně 16:9 v normalized units
        const planeWidth = 3.6
        const planeHeight = planeWidth / (CANVAS_WIDTH / CANVAS_HEIGHT)
        const geometry = new THREE.PlaneGeometry(planeWidth, planeHeight)

        // TSL uniformy
        const uniforms = {
          keyframeIdx: uniform(0), // 0..(N-1), float
          rms: uniform(0),
          beat: uniform(0),
          audioTime: uniform(0),
        }
        uniformsRef.current = uniforms

        const textureNode = texture(atlasTexture)

        // Pomocné konstanty (kompilační čas, ne uniformy)
        const cellWidthN = float(1.0 / ATLAS_COLS)
        const cellHeightN = float(1.0 / ATLAS_ROWS)
        const maxIdx = float(KEYFRAME_COUNT - 1)
        const colsF = float(ATLAS_COLS)

        // Crossfade shader
        // Vstup: uv() ∈ 0..1 přes plane.
        // Atlas má colsxrows cells; spočítáme UV pro dvě sousední cells a mixujeme.
        // Note: image v atlas má y=0 nahoře (canvas konvence). UV v Three.js má
        // y=0 dole. Atlas drawn v canvas convenci ale CanvasTexture flippe Y
        // by default, takže UV.y mapuje normálně.
        const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
        const nodeMaterial = new (
          await import('three/webgpu')
        ).MeshBasicNodeMaterial({ side: THREE.DoubleSide })

        nodeMaterial.colorNode = Fn(() => {
          const baseUv = uv()

          // RMS zoom-in efekt (mírný puls do středu na bas).
          const centered = baseUv.sub(vec2(0.5, 0.5))
          const zoom = uniforms.rms.mul(0.06).add(1.0)
          // Vlastní mírný wobble podle audioTime
          const wobble = vec2(
            sin(uniforms.audioTime.mul(1.7)).mul(0.008),
            sin(uniforms.audioTime.mul(1.3)).mul(0.008),
          )
          const localUv = centered.div(zoom).add(vec2(0.5, 0.5)).add(wobble)

          // Crossfade mezi dvěma sousedními keyframes
          const idx = uniforms.keyframeIdx.clamp(0, maxIdx)
          const idxA = idx.floor()
          const idxB = idxA.add(1.0).min(maxIdx)
          const t = idx.sub(idxA)

          // UV pro slot A
          const colA = idxA.mod(colsF)
          const rowA = idxA.div(colsF).floor()
          const uvA = vec2(
            colA.add(localUv.x).mul(cellWidthN),
            rowA.add(localUv.y).mul(cellHeightN),
          )

          // UV pro slot B
          const colB = idxB.mod(colsF)
          const rowB = idxB.div(colsF).floor()
          const uvB = vec2(
            colB.add(localUv.x).mul(cellWidthN),
            rowB.add(localUv.y).mul(cellHeightN),
          )

          const colorA = textureNode.sample(uvA).rgb
          const colorB = textureNode.sample(uvB).rgb
          const baseColor = mix(colorA, colorB, t)

          // Beat brightness boost
          const brightness = uniforms.beat.mul(0.35).add(1.0)
          const brightened = baseColor.mul(brightness)

          // Vignette — tmavší ke krajům, beat ji rozsvítí.
          const distFromCenter = length(baseUv.sub(vec2(0.5, 0.5)))
          const vigStrength = oneMinus(
            uniforms.beat.mul(0.4).add(0.55),
          ) // 0.15 na peak beat, 0.55 v klidu
          const vignette = oneMinus(
            smoothstep(float(0.35), float(0.9), distFromCenter).mul(vigStrength),
          )

          // Film grain — pseudo-noise v UV × audioTime.
          // Drobné modulace pro filmový pocit (~3% intenzity).
          const grainSeed = sin(
            baseUv.x.mul(127.1).add(baseUv.y.mul(311.7)).add(uniforms.audioTime.mul(43.7)),
          )
          const grain = fract(grainSeed.mul(43758.5453)).mul(0.06).sub(0.03)

          return brightened.mul(vignette).add(vec3(grain, grain, grain))
        })()

        const mesh = new THREE.Mesh(geometry, nodeMaterial)
        meshRef.current = mesh
        scene.add(mesh)

        // Pomocná default MeshBasicMaterial slot — zatímco WebGPU dofeed
        void material

        startRenderLoop()
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Neznámá chyba'
        setError(`AI vizualizér setup selhal: ${msg}`)
      }
    }

    setup()

    return () => {
      cancelled = true
      cleanupAll()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioBuffer, imageUrls])

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
        const elapsed = audioCtx.currentTime - audioStartTimeRef.current
        const frameIdx = Math.min(
          features.totalFrames - 1,
          Math.max(0, Math.floor(elapsed * features.fps)),
        )

        uniforms.rms.value = features.rms[frameIdx]
        uniforms.audioTime.value = elapsed

        const beatNow = features.beat[frameIdx]
        beatDecayRef.current = Math.max(beatNow, beatDecayRef.current * 0.85)
        uniforms.beat.value = beatDecayRef.current

        // Keyframe index z elapsed (0..N-1 přes celou délku).
        const kf =
          (elapsed * (KEYFRAME_COUNT - 1)) / audioBuffer.duration
        uniforms.keyframeIdx.value = Math.min(KEYFRAME_COUNT - 1, kf)
      } else {
        // Idle / paused — decay; audioTime advancing pro wobble.
        uniforms.rms.value *= 0.92
        uniforms.beat.value *= 0.85
        uniforms.audioTime.value += deltaTime
        // keyframeIdx zachováme (nepokračuje, jelikož audio nehraje)
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
    if (atlasTextureRef.current) {
      atlasTextureRef.current.dispose()
      atlasTextureRef.current = null
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
        // ignore
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
        setStatus('preparing')
        setPrepareProgress(0)
        const f = await extractFeatures(audioBuffer, TARGET_FPS, (pct) => {
          setPrepareProgress(pct)
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
        if (audioCtxRef.current) setStatus('ended')
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
    if (gainRef.current) gainRef.current.gain.value = v
  }

  const isRunning = status === 'playing' || status === 'paused'

  return (
    <div className="px-6 py-5 rounded-2xl bg-neutral-900 border border-neutral-800 transition-colors hover:border-neutral-700">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs uppercase tracking-wider text-neutral-500">
          Vizualizér · AI Hybrid (Three.js + WebGPU)
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

        {status === 'preparing' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 gap-3">
            <div className="h-5 w-5 rounded-full border-2 border-purple-500 border-t-transparent animate-spin" />
            <div className="text-sm text-neutral-200">Analyzuji audio…</div>
            <div className="h-1.5 w-48 rounded-full bg-neutral-800 overflow-hidden">
              <div
                className="h-full bg-purple-600 transition-all duration-200"
                style={{ width: `${(prepareProgress * 100).toFixed(0)}%` }}
              />
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
              {status === 'ended' ? 'Spustit znovu' : 'Spustit AI náhled'}
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

          <div className="flex items-center gap-2 flex-1 min-w-[140px]">
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
        Fáze 3.3 — AI keyframes crossfade přes TSL shader, RMS zoom puls,
        beat brightness boost. Vlastní AI export přijde v 3.4+.
      </div>
    </div>
  )
}

// Pomocný unused helper — only pro lazy import side-effect kontroly TypeScriptem.
// (Není použit, MeshBasicNodeMaterial bereme dynamicky uvnitř setup.)
void vec3
