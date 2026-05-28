import {
  Output,
  Mp4OutputFormat,
  BufferTarget,
  CanvasSource,
  AudioBufferSource,
} from 'mediabunny'
import butterchurn from '@webamp/butterchurn'
import butterchurnPresets from 'butterchurn-presets'
import * as THREE from 'three'
import { WebGPURenderer } from 'three/webgpu'
import { extractFeatures } from './audioFeatures'
import { createUniforms, getPresetById } from './modernPresets'

const AUDIO_BITRATE = 128_000 // 128 kbps AAC — konstantní napříč všemi presety

export type ExportStage = 'extract' | 'render' | 'finalize'

export interface ExportProgress {
  frame: number
  totalFrames: number
  etaSec: number
  fps: number
  /** Volitelná indikace fáze pro UI (default 'render'). */
  stage?: ExportStage
}

/**
 * Video kvalitativní preset — rozlišení, FPS, bitrate.
 *
 * Aktuální nabídka odpovídá YouTube doporučením pro 1080p / 1440p uploady.
 * Audio bitrate je konstantní (128 kbps AAC) — kvalita videa je dominantní
 * faktor velikosti.
 */
export interface ExportQuality {
  id: string
  name: string
  description: string
  width: number
  height: number
  fps: number
  videoBitrate: number
}

export const EXPORT_QUALITIES: ExportQuality[] = [
  {
    id: 'fast',
    name: 'Rychlý',
    description: '720p30 · 5 Mbps · pro test nebo sociální média',
    width: 1280,
    height: 720,
    fps: 30,
    videoBitrate: 5_000_000,
  },
  {
    id: 'standard',
    name: 'Standard',
    description: '1080p60 · 12 Mbps · YouTube doporučeno',
    width: 1920,
    height: 1080,
    fps: 60,
    videoBitrate: 12_000_000,
  },
  {
    id: 'cinema',
    name: 'Filmový',
    description: '1080p30 · 10 Mbps · plynulý ale plynulý',
    width: 1920,
    height: 1080,
    fps: 30,
    videoBitrate: 10_000_000,
  },
  {
    id: 'hq',
    name: 'Vysoká kvalita',
    description: '1440p30 · 16 Mbps · pro archiv',
    width: 2560,
    height: 1440,
    fps: 30,
    videoBitrate: 16_000_000,
  },
]

export const DEFAULT_EXPORT_QUALITY_ID = 'standard'

export function getExportQualityById(id: string): ExportQuality | undefined {
  return EXPORT_QUALITIES.find((q) => q.id === id)
}

function resolveQuality(id: string | undefined): ExportQuality {
  return (
    (id ? getExportQualityById(id) : undefined) ??
    getExportQualityById(DEFAULT_EXPORT_QUALITY_ID)!
  )
}

export interface ExportOptions {
  audioBuffer: AudioBuffer
  presetKey: string
  qualityId?: string
  onProgress: (progress: ExportProgress) => void
  signal?: AbortSignal
}

export interface ExportModernOptions {
  audioBuffer: AudioBuffer
  /** ID Modern presetu (z `MODERN_PRESETS`). */
  presetId: string
  qualityId?: string
  onProgress: (progress: ExportProgress) => void
  signal?: AbortSignal
}

/**
 * Vyexportuje audio + Butterchurn vizualizér do MP4 souboru (H.264 + AAC, 1080p60).
 *
 * Pipeline:
 *   AudioBuffer → AudioBufferSource → AAC encoder ─┐
 *                                                  ├→ MP4 muxer → Blob
 *   AudioBuffer → AudioContext → AnalyserNode      │
 *                            │                     │
 *   OffscreenCanvas ← Butterchurn.render() → CanvasSource → H.264 encoder ─┘
 *
 * Render je synchronizován s reálným časem přehrávání audia (Butterchurn potřebuje
 * běžící AnalyserNode v real-time AudioContextu pro frekvenční analýzu). To znamená,
 * že export trvá ~stejně dlouho jako délka audia. Skutečný offline render rychlejší
 * než real-time přijde ve Fázi 2 s vlastními Three.js + TSL shadery.
 *
 * Pozn.: audio NENÍ připojeno do `audioCtx.destination`, takže během exportu
 * uživatel nic neslyší.
 */
export async function exportVideo(options: ExportOptions): Promise<Blob> {
  const { audioBuffer, presetKey, qualityId, onProgress, signal } = options
  const quality = resolveQuality(qualityId)
  const EXPORT_WIDTH = quality.width
  const EXPORT_HEIGHT = quality.height
  const EXPORT_FPS = quality.fps
  const VIDEO_BITRATE = quality.videoBitrate

  const duration = audioBuffer.duration
  const totalFrames = Math.floor(duration * EXPORT_FPS)
  const frameDuration = 1 / EXPORT_FPS

  // 1. Offscreen canvas v plné velikosti
  const canvas = new OffscreenCanvas(EXPORT_WIDTH, EXPORT_HEIGHT)

  // 2. AudioContext pro Butterchurn (audio nezní — pouze pro feedu analyseru)
  const audioCtx = new AudioContext({ sampleRate: audioBuffer.sampleRate })
  const source = audioCtx.createBufferSource()
  source.buffer = audioBuffer

  // 3. Butterchurn vizualizér na offscreen canvasu
  const visualizer = butterchurn.createVisualizer(
    audioCtx,
    canvas as unknown as HTMLCanvasElement,
    {
      width: EXPORT_WIDTH,
      height: EXPORT_HEIGHT,
      pixelRatio: 1,
    },
  )
  visualizer.connectAudio(source)

  const presets = butterchurnPresets.getPresets()
  const preset = presets[presetKey]
  if (!preset) {
    throw new Error(`Preset "${presetKey}" neexistuje.`)
  }
  visualizer.loadPreset(preset, 0)

  // 4. Mediabunny output
  const output = new Output({
    format: new Mp4OutputFormat(),
    target: new BufferTarget(),
  })

  const videoSource = new CanvasSource(canvas, {
    codec: 'avc',
    bitrate: VIDEO_BITRATE,
    keyFrameInterval: 2,
  })
  output.addVideoTrack(videoSource, { frameRate: EXPORT_FPS })

  const audioSource = new AudioBufferSource({
    codec: 'aac',
    bitrate: AUDIO_BITRATE,
  })
  output.addAudioTrack(audioSource)

  await output.start()

  try {
    // 5. Audio: přidat celý buffer najednou — Mediabunny ho rozseká interně
    await audioSource.add(audioBuffer)

    // 6. Spustit přehrávání audia (jen pro Butterchurn analyser, ne destination)
    source.start(0)
    const startWallTime = performance.now()
    const startCtxTime = audioCtx.currentTime

    // 7. Video render loop — sync na real-time audio playback
    for (let i = 0; i < totalFrames; i++) {
      if (signal?.aborted) {
        throw new Error('Export zrušen uživatelem')
      }

      const targetCtxTime = startCtxTime + i / EXPORT_FPS

      // Čekáme, dokud audio nedosáhne požadovaného času. Tím garantujeme,
      // že Butterchurn vidí frekvenční data odpovídající aktuálnímu snímku.
      while (audioCtx.currentTime < targetCtxTime) {
        if (signal?.aborted) {
          throw new Error('Export zrušen uživatelem')
        }
        await new Promise<void>((r) => setTimeout(r, 1))
      }

      // Render snímku
      visualizer.render()

      // Přidat snímek do Mediabunny (await respektuje encoder backpressure)
      await videoSource.add(i / EXPORT_FPS, frameDuration)

      // Progress každých 30 snímků (= 2× za sekundu při 60 FPS)
      if (i % 30 === 0 || i === totalFrames - 1) {
        const elapsedSec = (performance.now() - startWallTime) / 1000
        const framesDone = i + 1
        const fps = framesDone / elapsedSec
        const remainingFrames = totalFrames - framesDone
        const etaSec = fps > 0 ? remainingFrames / fps : 0
        onProgress({ frame: framesDone, totalFrames, etaSec, fps })
      }
    }

    // 8. Finalize
    await output.finalize()
  } catch (err) {
    // Při chybě nebo zrušení uklidíme output
    await output.cancel().catch(() => {})
    throw err
  } finally {
    // Cleanup audio
    try {
      source.stop()
    } catch {
      // už byl zastavený
    }
    source.disconnect()
    await audioCtx.close().catch(() => {})
  }

  // 9. Vytvořit Blob z bufferu
  const buffer = output.target.buffer
  if (!buffer) {
    throw new Error('Mediabunny output nevrátil buffer.')
  }
  return new Blob([buffer], { type: 'video/mp4' })
}

/**
 * Vyexportuje audio + Modern (Three.js) vizualizér do MP4 (H.264 + AAC, 1080p60).
 *
 * Oproti Classic exportu (`exportVideo`) **NENÍ synchronizován s real-time audio
 * playback** — využívá pre-computed Meyda features (z 2.4) a iteruje frame-by-frame
 * bez čekání. Render rychlost je čistě GPU-bound, tj. **typicky 2-5× rychlejší
 * než délka tracku** na M-series.
 *
 * Pipeline:
 *   AudioBuffer → Meyda offline extract → AudioFeatures
 *               ↓
 *   pro každý frame i: features[i] → uniforms → Three.js render → CanvasSource
 *               ↓
 *   AudioBuffer → AudioBufferSource → AAC encoder ─┐
 *                                                  ├→ MP4 muxer → Blob
 *   OffscreenCanvas → CanvasSource → H.264 encoder ┘
 */
export async function exportVideoModern(
  options: ExportModernOptions,
): Promise<Blob> {
  const { audioBuffer, presetId, qualityId, onProgress, signal } = options
  const quality = resolveQuality(qualityId)
  const EXPORT_WIDTH = quality.width
  const EXPORT_HEIGHT = quality.height
  const EXPORT_FPS = quality.fps
  const VIDEO_BITRATE = quality.videoBitrate

  // 1. Najít preset
  const preset = getPresetById(presetId)
  if (!preset) {
    throw new Error(`Modern preset "${presetId}" neexistuje.`)
  }

  const totalFrames = Math.floor(audioBuffer.duration * EXPORT_FPS)
  const frameDuration = 1 / EXPORT_FPS

  // 2. Pre-compute audio features (Meyda offline)
  const features = await extractFeatures(
    audioBuffer,
    EXPORT_FPS,
    (pct) => {
      onProgress({
        frame: 0,
        totalFrames,
        etaSec: 0,
        fps: 0,
        stage: 'extract',
      })
      void pct
    },
  )

  if (signal?.aborted) throw new Error('Export zrušen uživatelem')

  // 3. OffscreenCanvas + WebGPURenderer
  const canvas = new OffscreenCanvas(EXPORT_WIDTH, EXPORT_HEIGHT)
  const renderer = new WebGPURenderer({
    canvas: canvas as unknown as HTMLCanvasElement,
    antialias: true,
  })
  renderer.setSize(EXPORT_WIDTH, EXPORT_HEIGHT, false)
  renderer.setClearColor(0x0a0a0a, 1)
  await renderer.init()

  // 4. Scene + camera + uniforms + preset
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(
    60,
    EXPORT_WIDTH / EXPORT_HEIGHT,
    0.1,
    1000,
  )
  camera.position.z = 3

  const uniforms = createUniforms()
  const presetInstance = preset.setup(scene, uniforms)

  // 5. Mediabunny output
  const output = new Output({
    format: new Mp4OutputFormat(),
    target: new BufferTarget(),
  })

  const videoSource = new CanvasSource(canvas, {
    codec: 'avc',
    bitrate: VIDEO_BITRATE,
    keyFrameInterval: 2,
  })
  output.addVideoTrack(videoSource, { frameRate: EXPORT_FPS })

  const audioSource = new AudioBufferSource({
    codec: 'aac',
    bitrate: AUDIO_BITRATE,
  })
  output.addAudioTrack(audioSource)

  await output.start()

  try {
    // 6. Audio přidat celý buffer najednou
    await audioSource.add(audioBuffer)

    // 7. Render loop bez čekání na real-time — frame-by-frame z features
    const startWallTime = performance.now()
    let beatDecay = 0

    for (let i = 0; i < totalFrames; i++) {
      if (signal?.aborted) {
        throw new Error('Export zrušen uživatelem')
      }

      // Bezpečnostně omezit index features (totalFrames v features by měl být
      // ≥ totalFrames v exportu, ale jistota nezaškodí).
      const fi = Math.min(i, features.totalFrames - 1)

      uniforms.rms.value = features.rms[fi]
      uniforms.low.value = features.low[fi]
      uniforms.mid.value = features.mid[fi]
      uniforms.high.value = features.high[fi]
      uniforms.centroid.value = features.spectralCentroid[fi]
      uniforms.audioTime.value = i / EXPORT_FPS

      const beatNow = features.beat[fi]
      beatDecay = Math.max(beatNow, beatDecay * 0.85)
      uniforms.beat.value = beatDecay

      // Preset update callback (rotation, particle pozice, atd.)
      if (presetInstance.update) {
        presetInstance.update(uniforms, frameDuration)
      }

      // Render snímku (WebGPU async)
      await renderer.renderAsync(scene, camera)

      // Přidat snímek do Mediabunny (await respektuje backpressure)
      await videoSource.add(i / EXPORT_FPS, frameDuration)

      // Progress každých 30 snímků
      if (i % 30 === 0 || i === totalFrames - 1) {
        const elapsedSec = (performance.now() - startWallTime) / 1000
        const framesDone = i + 1
        const fps = framesDone / elapsedSec
        const remainingFrames = totalFrames - framesDone
        const etaSec = fps > 0 ? remainingFrames / fps : 0
        onProgress({
          frame: framesDone,
          totalFrames,
          etaSec,
          fps,
          stage: 'render',
        })
      }
    }

    onProgress({
      frame: totalFrames,
      totalFrames,
      etaSec: 0,
      fps: 0,
      stage: 'finalize',
    })

    await output.finalize()
  } catch (err) {
    await output.cancel().catch(() => {})
    throw err
  } finally {
    // Cleanup
    presetInstance.dispose()
    renderer.dispose()
  }

  const buffer = output.target.buffer
  if (!buffer) {
    throw new Error('Mediabunny output nevrátil buffer.')
  }
  return new Blob([buffer], { type: 'video/mp4' })
}

/**
 * Odhadne velikost výstupního souboru v bajtech pro zvolenou kvalitu.
 */
export function estimateOutputSize(
  durationSeconds: number,
  qualityId?: string,
): number {
  const quality = resolveQuality(qualityId)
  const videoBytes = (durationSeconds * quality.videoBitrate) / 8
  const audioBytes = (durationSeconds * AUDIO_BITRATE) / 8
  return Math.floor(videoBytes + audioBytes)
}

/**
 * Spustí stažení Blob jako soubor.
 */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // Mírná prodleva před revokem — Chrome jinak download občas přeruší
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Sestaví filename pro export — z původního názvu audia + .mp4 koncovka.
 *   "Nordmarka 2026.mp3" → "dj-enda-Nordmarka 2026.mp4"
 */
export function buildExportFilename(audioFilename: string): string {
  const lastDot = audioFilename.lastIndexOf('.')
  const stem = lastDot > 0 ? audioFilename.slice(0, lastDot) : audioFilename
  return `dj-enda-${stem}.mp4`
}

/**
 * Naformátuje sekundy do mm:ss nebo h:mm:ss.
 */
export function formatEta(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '—'
  const total = Math.ceil(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  return `${m}:${String(s).padStart(2, '0')}`
}

/**
 * Naformátuje bajty na lidsky čitelný řetězec.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}
