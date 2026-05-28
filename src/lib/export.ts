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
import {
  resolveCreditsTiming,
  padAudioBufferWithSilence,
  drawIntroFrame,
  drawOutroFrame,
  compositeMainFrame,
  type ExportCredits,
} from './exportCompositor'

export type { ExportCredits } from './exportCompositor'

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

/**
 * Volitelné oříznutí audia pro export — uživatel může vybrat jen část skladby
 * přes slidery start/end v ExportButton confirm dialogu.
 *
 * Min délka výstupu = 1 sekunda. Pokud `range` chybí, exportuje se celá skladba.
 */
export interface ExportRange {
  startSec: number
  endSec: number
}

/**
 * Vrátí trimnutý AudioBuffer. Pokud rozsah pokrývá celou skladbu (s tolerance
 * < 0.001 s na obou koncích), vrátí původní buffer beze změny — žádné zbytečné
 * kopírování paměti.
 *
 * Pokud `range` chybí nebo je rozsah neplatný, vrátí původní buffer.
 */
export function trimAudioBuffer(
  buffer: AudioBuffer,
  range?: ExportRange,
): AudioBuffer {
  if (!range) return buffer
  const { startSec, endSec } = range
  const duration = buffer.duration
  const clampedStart = Math.max(0, Math.min(startSec, duration))
  const clampedEnd = Math.max(clampedStart, Math.min(endSec, duration))
  if (clampedEnd - clampedStart < 0.001) return buffer
  if (clampedStart < 0.001 && duration - clampedEnd < 0.001) return buffer

  const sampleRate = buffer.sampleRate
  const startSample = Math.floor(clampedStart * sampleRate)
  const endSample = Math.min(Math.floor(clampedEnd * sampleRate), buffer.length)
  const frameCount = endSample - startSample
  // OfflineAudioContext.createBuffer je dostupný i bez instance ctx přes window.
  // Použijeme dočasný AudioContext jen na createBuffer (neprobudí playback).
  const tmpCtx = new AudioContext({ sampleRate })
  const out = tmpCtx.createBuffer(buffer.numberOfChannels, frameCount, sampleRate)
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const srcData = buffer.getChannelData(ch)
    out.copyToChannel(srcData.subarray(startSample, endSample), ch)
  }
  // Uzavřít tmpCtx asynchronně — buffer je nezávislý.
  tmpCtx.close().catch(() => {})
  return out
}

export interface ExportOptions {
  audioBuffer: AudioBuffer
  presetKey: string
  qualityId?: string
  /** Volitelný trim — pokud chybí, exportuje se celá skladba. */
  range?: ExportRange
  /** Polopropustný DJE watermark v pravém dolním rohu hlavního obsahu (4.13). */
  watermark?: boolean
  /** Intro + outro titulky před a po hlavním obsahu (4.12). */
  credits?: ExportCredits
  onProgress: (progress: ExportProgress) => void
  signal?: AbortSignal
}

export interface ExportModernOptions {
  audioBuffer: AudioBuffer
  /** ID Modern presetu (z `MODERN_PRESETS`). */
  presetId: string
  qualityId?: string
  /** Volitelný trim — pokud chybí, exportuje se celá skladba. */
  range?: ExportRange
  watermark?: boolean
  credits?: ExportCredits
  onProgress: (progress: ExportProgress) => void
  signal?: AbortSignal
}

export interface ExportAiOptions {
  audioBuffer: AudioBuffer
  /** URL všech 8 AI keyframes (musí být ready). */
  imageUrls: ReadonlyArray<string>
  qualityId?: string
  /** Volitelný trim — pokud chybí, exportuje se celá skladba. */
  range?: ExportRange
  watermark?: boolean
  credits?: ExportCredits
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
  const {
    audioBuffer: srcBuffer,
    presetKey,
    qualityId,
    range,
    watermark,
    credits,
    onProgress,
    signal,
  } = options
  const quality = resolveQuality(qualityId)
  const EXPORT_WIDTH = quality.width
  const EXPORT_HEIGHT = quality.height
  const EXPORT_FPS = quality.fps
  const VIDEO_BITRATE = quality.videoBitrate

  // Pokud uživatel zvolil trim, oříznout buffer na požadovaný rozsah.
  const trimmedBuffer = trimAudioBuffer(srcBuffer, range)

  const mainDuration = trimmedBuffer.duration
  const mainFrames = Math.floor(mainDuration * EXPORT_FPS)
  const timing = resolveCreditsTiming(credits, mainFrames, EXPORT_FPS)
  const totalFrames = timing.introFrames + mainFrames + timing.outroFrames

  // Audio padding silence pro intro / outro.
  const audioBuffer = padAudioBufferWithSilence(
    trimmedBuffer,
    timing.introDurationSec,
    timing.outroDurationSec,
  )

  const frameDuration = 1 / EXPORT_FPS

  // 1. Vizualizér canvas (Butterchurn renderuje do WebGL).
  const vizCanvas = new OffscreenCanvas(EXPORT_WIDTH, EXPORT_HEIGHT)
  // Compositor canvas (2D) — sem se kopíruje vizualizér + kreslí overlay.
  const canvas = new OffscreenCanvas(EXPORT_WIDTH, EXPORT_HEIGHT)
  const compositorCtx = canvas.getContext('2d')
  if (!compositorCtx) throw new Error('Compositor 2D context nedostupný')

  // 2. AudioContext pro Butterchurn (audio nezní — pouze pro feedu analyseru)
  const audioCtx = new AudioContext({ sampleRate: audioBuffer.sampleRate })
  const source = audioCtx.createBufferSource()
  source.buffer = audioBuffer

  // 3. Butterchurn vizualizér na vizCanvasu (interní WebGL render).
  const visualizer = butterchurn.createVisualizer(
    audioCtx,
    vizCanvas as unknown as HTMLCanvasElement,
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
    // 5. Audio: padded buffer (silence + main + silence) najednou.
    await audioSource.add(audioBuffer)

    // 6. Spustit přehrávání audia. Hlavní render loop sync na audio čas
    //    POSUNUTÝ o introDuration — audio v intro fázi je silence,
    //    takže Butterchurn analyser nic neuvidí, ale to nevadí (intro
    //    má vlastní static frame, ne vizualizér).
    source.start(0)
    const startWallTime = performance.now()
    const startCtxTime = audioCtx.currentTime

    // 7. Video render loop — všechny snímky (intro + main + outro).
    for (let i = 0; i < totalFrames; i++) {
      if (signal?.aborted) {
        throw new Error('Export zrušen uživatelem')
      }

      const videoTime = i / EXPORT_FPS
      const targetCtxTime = startCtxTime + videoTime

      // Sync na real-time audio playback — Butterchurn potřebuje běžící
      // AnalyserNode, takže čekáme i v intro/outro fázi (silence).
      while (audioCtx.currentTime < targetCtxTime) {
        if (signal?.aborted) {
          throw new Error('Export zrušen uživatelem')
        }
        await new Promise<void>((r) => setTimeout(r, 1))
      }

      // Vykreslit jeden snímek na compositor canvas podle fáze.
      if (i < timing.mainStartFrame) {
        // Intro fáze.
        const introT = videoTime
        drawIntroFrame(
          compositorCtx,
          EXPORT_WIDTH,
          EXPORT_HEIGHT,
          introT,
          timing.introDurationSec,
          credits?.title ?? '',
          credits?.artist,
        )
      } else if (i >= timing.outroStartFrame) {
        // Outro fáze.
        const outroT = videoTime - timing.outroStartFrame / EXPORT_FPS
        drawOutroFrame(
          compositorCtx,
          EXPORT_WIDTH,
          EXPORT_HEIGHT,
          outroT,
          timing.outroDurationSec,
        )
      } else {
        // Main fáze — vykreslit vizualizér a copy do compositoru.
        visualizer.render()
        compositeMainFrame(
          compositorCtx,
          vizCanvas,
          EXPORT_WIDTH,
          EXPORT_HEIGHT,
          watermark === true,
        )
      }

      // Přidat snímek do Mediabunny (await respektuje encoder backpressure)
      await videoSource.add(videoTime, frameDuration)

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
  const {
    audioBuffer: srcBuffer,
    presetId,
    qualityId,
    range,
    watermark,
    credits,
    onProgress,
    signal,
  } = options
  const quality = resolveQuality(qualityId)
  const EXPORT_WIDTH = quality.width
  const EXPORT_HEIGHT = quality.height
  const EXPORT_FPS = quality.fps
  const VIDEO_BITRATE = quality.videoBitrate

  // Pokud uživatel zvolil trim, oříznout buffer na požadovaný rozsah.
  const trimmedBuffer = trimAudioBuffer(srcBuffer, range)

  // 1. Najít preset
  const preset = getPresetById(presetId)
  if (!preset) {
    throw new Error(`Modern preset "${presetId}" neexistuje.`)
  }

  const mainFrames = Math.floor(trimmedBuffer.duration * EXPORT_FPS)
  const timing = resolveCreditsTiming(credits, mainFrames, EXPORT_FPS)
  const totalFrames = timing.introFrames + mainFrames + timing.outroFrames
  const audioBuffer = padAudioBufferWithSilence(
    trimmedBuffer,
    timing.introDurationSec,
    timing.outroDurationSec,
  )
  const frameDuration = 1 / EXPORT_FPS

  // 2. Pre-compute audio features (Meyda offline) — jen z hlavního obsahu.
  const features = await extractFeatures(
    trimmedBuffer,
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

  // 3. Vizualizér canvas (WebGPU render) + compositor canvas (2D overlay).
  const vizCanvas = new OffscreenCanvas(EXPORT_WIDTH, EXPORT_HEIGHT)
  const canvas = new OffscreenCanvas(EXPORT_WIDTH, EXPORT_HEIGHT)
  const compositorCtx = canvas.getContext('2d')
  if (!compositorCtx) throw new Error('Compositor 2D context nedostupný')

  const renderer = new WebGPURenderer({
    canvas: vizCanvas as unknown as HTMLCanvasElement,
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

  // 5. Mediabunny output (compositor canvas je zdrojem video framů).
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
    // 6. Audio přidat padded buffer (intro silence + main + outro silence).
    await audioSource.add(audioBuffer)

    // 7. Render loop bez čekání na real-time — frame-by-frame z features
    const startWallTime = performance.now()
    let beatDecay = 0

    for (let i = 0; i < totalFrames; i++) {
      if (signal?.aborted) {
        throw new Error('Export zrušen uživatelem')
      }

      const videoTime = i / EXPORT_FPS

      // Vykreslit snímek podle fáze (intro / main / outro).
      if (i < timing.mainStartFrame) {
        const introT = videoTime
        drawIntroFrame(
          compositorCtx,
          EXPORT_WIDTH,
          EXPORT_HEIGHT,
          introT,
          timing.introDurationSec,
          credits?.title ?? '',
          credits?.artist,
        )
      } else if (i >= timing.outroStartFrame) {
        const outroT = videoTime - timing.outroStartFrame / EXPORT_FPS
        drawOutroFrame(
          compositorCtx,
          EXPORT_WIDTH,
          EXPORT_HEIGHT,
          outroT,
          timing.outroDurationSec,
        )
      } else {
        // Main fáze — uniforms ze (zero-shifted) main frame indexu, render scene.
        const mainIdx = i - timing.mainStartFrame
        const fi = Math.min(mainIdx, features.totalFrames - 1)

        uniforms.rms.value = features.rms[fi]
        uniforms.low.value = features.low[fi]
        uniforms.mid.value = features.mid[fi]
        uniforms.high.value = features.high[fi]
        uniforms.centroid.value = features.spectralCentroid[fi]
        uniforms.audioTime.value = mainIdx / EXPORT_FPS

        const beatNow = features.beat[fi]
        beatDecay = Math.max(beatNow, beatDecay * 0.85)
        uniforms.beat.value = beatDecay

        if (presetInstance.update) {
          presetInstance.update(uniforms, frameDuration)
        }

        await renderer.renderAsync(scene, camera)
        compositeMainFrame(
          compositorCtx,
          vizCanvas,
          EXPORT_WIDTH,
          EXPORT_HEIGHT,
          watermark === true,
        )
      }

      // Přidat snímek do Mediabunny (await respektuje backpressure)
      await videoSource.add(videoTime, frameDuration)

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
 * Vyexportuje audio + AI vizualizér (crossfade mezi 8 keyframes) do MP4.
 *
 * Pipeline:
 *   - Načte 8 AI obrazů → atlas canvas (4×2 grid).
 *   - CanvasTexture → WebGPURenderer s TSL crossfade shaderem (totožná logika
 *     jako AiVisualizer komponenta v UI).
 *   - Pre-compute Meyda features → frame-by-frame uniforms.
 *   - Rychlejší-než-real-time render.
 */
export async function exportVideoAi(
  options: ExportAiOptions,
): Promise<Blob> {
  const {
    audioBuffer: srcBuffer,
    imageUrls,
    qualityId,
    range,
    watermark,
    credits,
    onProgress,
    signal,
  } = options
  const quality = resolveQuality(qualityId)
  const EXPORT_WIDTH = quality.width
  const EXPORT_HEIGHT = quality.height
  const EXPORT_FPS = quality.fps
  const VIDEO_BITRATE = quality.videoBitrate

  // Pokud uživatel zvolil trim, oříznout buffer na požadovaný rozsah.
  const trimmedBuffer = trimAudioBuffer(srcBuffer, range)

  const KEYFRAME_COUNT = 8
  const ATLAS_COLS = 4
  const ATLAS_ROWS = 2

  if (imageUrls.length < 2) {
    throw new Error('AI export potřebuje alespoň 2 hotové keyframes.')
  }

  const mainFrames = Math.floor(trimmedBuffer.duration * EXPORT_FPS)
  const timing = resolveCreditsTiming(credits, mainFrames, EXPORT_FPS)
  const totalFrames = timing.introFrames + mainFrames + timing.outroFrames
  const audioBuffer = padAudioBufferWithSilence(
    trimmedBuffer,
    timing.introDurationSec,
    timing.outroDurationSec,
  )
  const frameDuration = 1 / EXPORT_FPS

  // 1. Sestavit atlas — cell size proportional k exportu pro nejvyšší detail.
  const cellWidth = Math.min(1280, Math.floor(EXPORT_WIDTH / 2))
  const cellHeight = Math.floor(cellWidth / (EXPORT_WIDTH / EXPORT_HEIGHT))
  const atlasWidth = cellWidth * ATLAS_COLS
  const atlasHeight = cellHeight * ATLAS_ROWS

  const atlasCanvas = document.createElement('canvas')
  atlasCanvas.width = atlasWidth
  atlasCanvas.height = atlasHeight
  const atlasCtx = atlasCanvas.getContext('2d')!
  atlasCtx.fillStyle = '#0a0a0a'
  atlasCtx.fillRect(0, 0, atlasWidth, atlasHeight)

  const imagePromises = imageUrls.map(
    (url) =>
      new Promise<HTMLImageElement | null>((resolve) => {
        const img = new Image()
        img.crossOrigin = 'anonymous'
        img.onload = () => resolve(img)
        img.onerror = () => resolve(null)
        img.src = url
      }),
  )
  const images = await Promise.all(imagePromises)
  let lastImg: HTMLImageElement | null = null
  for (let i = 0; i < KEYFRAME_COUNT; i++) {
    const img: HTMLImageElement | null = images[i] ?? lastImg
    if (img) lastImg = img
    if (!img) continue
    const col = i % ATLAS_COLS
    const row = Math.floor(i / ATLAS_COLS)
    atlasCtx.drawImage(img, col * cellWidth, row * cellHeight, cellWidth, cellHeight)
  }

  // 2. Pre-compute features — pouze z hlavního audia (bez intro/outro silence).
  const features = await extractFeatures(
    trimmedBuffer,
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

  // 3. Vizualizér canvas (WebGPU) + compositor canvas (2D overlay).
  const vizCanvas = new OffscreenCanvas(EXPORT_WIDTH, EXPORT_HEIGHT)
  const offscreen = new OffscreenCanvas(EXPORT_WIDTH, EXPORT_HEIGHT)
  const compositorCtx = offscreen.getContext('2d')
  if (!compositorCtx) throw new Error('Compositor 2D context nedostupný')
  const renderer = new WebGPURenderer({
    canvas: vizCanvas as unknown as HTMLCanvasElement,
    antialias: true,
  })
  renderer.setSize(EXPORT_WIDTH, EXPORT_HEIGHT, false)
  renderer.setClearColor(0x0a0a0a, 1)
  await renderer.init()

  // 4. Scene + camera + plane
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(
    60,
    EXPORT_WIDTH / EXPORT_HEIGHT,
    0.1,
    10,
  )
  camera.position.z = 1.74
  const planeWidth = 3.6
  const planeHeight = planeWidth / (EXPORT_WIDTH / EXPORT_HEIGHT)
  const geometry = new THREE.PlaneGeometry(planeWidth, planeHeight)

  // Atlas texture
  const atlasTexture = new THREE.CanvasTexture(atlasCanvas)
  atlasTexture.colorSpace = THREE.SRGBColorSpace

  // Uniforms — identické s AiVisualizer
  const tsl = await import('three/tsl')
  const wbg = await import('three/webgpu')

  const uniforms = {
    keyframeIdx: tsl.uniform(0),
    rms: tsl.uniform(0),
    beat: tsl.uniform(0),
    audioTime: tsl.uniform(0),
  }
  const textureNode = tsl.texture(atlasTexture)
  const cellWidthN = tsl.float(1.0 / ATLAS_COLS)
  const cellHeightN = tsl.float(1.0 / ATLAS_ROWS)
  const maxIdx = tsl.float(KEYFRAME_COUNT - 1)
  const colsF = tsl.float(ATLAS_COLS)

  const material = new wbg.MeshBasicNodeMaterial({ side: THREE.DoubleSide })
  // Pozn.: Tato logika MUSÍ být identická s `AiVisualizer.tsx` shader.
  material.colorNode = tsl.Fn(() => {
    const baseUv = tsl.uv()
    const centered = baseUv.sub(tsl.vec2(0.5, 0.5))

    // Ken Burns
    const slowZoom = tsl
      .clamp(uniforms.audioTime.mul(0.005), tsl.float(0), tsl.float(0.2))
      .add(1.0)
    const audioZoom = uniforms.rms.mul(0.06).add(1.0)
    const beatZoom = uniforms.beat.mul(0.05).add(1.0)
    const totalZoom = slowZoom.mul(audioZoom).mul(beatZoom)

    const driftX = tsl.sin(uniforms.audioTime.mul(0.13)).mul(0.04)
    const driftY = tsl.cos(uniforms.audioTime.mul(0.11)).mul(0.03)
    const wobbleX = tsl.sin(uniforms.audioTime.mul(1.7)).mul(0.006)
    const wobbleY = tsl.sin(uniforms.audioTime.mul(1.3)).mul(0.006)

    const localUv = centered
      .div(totalZoom)
      .add(tsl.vec2(0.5, 0.5))
      .add(tsl.vec2(driftX, driftY))
      .add(tsl.vec2(wobbleX, wobbleY))

    // Crossfade s parallax
    const idx = uniforms.keyframeIdx.clamp(0, maxIdx)
    const idxA = idx.floor()
    const idxB = idxA.add(1.0).min(maxIdx)
    const t = idx.sub(idxA)

    const parallaxA = tsl.vec2(
      tsl.sin(idxA.mul(2.3).add(0.7)).mul(0.025),
      tsl.cos(idxA.mul(1.9).add(1.3)).mul(0.02),
    )
    const parallaxB = tsl.vec2(
      tsl.sin(idxB.mul(2.3).add(0.7)).mul(0.025),
      tsl.cos(idxB.mul(1.9).add(1.3)).mul(0.02),
    )

    const uvA_local = localUv.add(parallaxA)
    const uvB_local = localUv.add(parallaxB)

    const colA = idxA.mod(colsF)
    const rowA = idxA.div(colsF).floor()
    const uvA = tsl.vec2(
      colA.add(uvA_local.x).mul(cellWidthN),
      rowA.add(uvA_local.y).mul(cellHeightN),
    )
    const colB = idxB.mod(colsF)
    const rowB = idxB.div(colsF).floor()
    const uvB = tsl.vec2(
      colB.add(uvB_local.x).mul(cellWidthN),
      rowB.add(uvB_local.y).mul(cellHeightN),
    )
    const colorA = textureNode.sample(uvA).rgb
    const colorB = textureNode.sample(uvB).rgb
    const baseColor = tsl.mix(colorA, colorB, t)

    // Brightness + vignette
    const brightness = uniforms.beat.mul(0.35).add(1.0)
    const brightened = baseColor.mul(brightness)

    const distFromCenter = tsl.length(baseUv.sub(tsl.vec2(0.5, 0.5)))
    const vigStrength = tsl.oneMinus(uniforms.beat.mul(0.4).add(0.55))
    const vignette = tsl.oneMinus(
      tsl.smoothstep(tsl.float(0.35), tsl.float(0.9), distFromCenter).mul(vigStrength),
    )
    const vignetted = brightened.mul(vignette)

    // Light leaks
    const leakCenter = tsl.vec2(
      tsl.sin(uniforms.audioTime.mul(0.3)).mul(0.3).add(0.5),
      tsl.cos(uniforms.audioTime.mul(0.25)).mul(0.3).add(0.5),
    )
    const distFromLeak = tsl.length(baseUv.sub(leakCenter))
    const leakIntensity = tsl
      .oneMinus(tsl.smoothstep(tsl.float(0.0), tsl.float(0.45), distFromLeak))
      .mul(uniforms.beat)
      .mul(0.5)
    const leakColor = tsl.vec3(1.0, 0.7, 0.45).mul(leakIntensity)
    const withLeak = vignetted.add(leakColor)

    // Particles
    const partSeed = tsl
      .sin(baseUv.x.mul(220.0).add(uniforms.audioTime.mul(1.5)))
      .mul(tsl.sin(baseUv.y.mul(190.0).add(uniforms.audioTime.mul(1.1))))
    const partRaw = tsl.fract(partSeed.mul(53.7))
    const partVisible = tsl.smoothstep(tsl.float(0.96), tsl.float(1.0), partRaw)
    const partAlpha = partVisible.mul(uniforms.rms.add(0.3)).mul(0.5)
    const withParticles = withLeak.add(tsl.vec3(partAlpha, partAlpha, partAlpha))

    // Grain
    const grainSeed = tsl.sin(
      baseUv.x.mul(127.1).add(baseUv.y.mul(311.7)).add(uniforms.audioTime.mul(43.7)),
    )
    const grain = tsl.fract(grainSeed.mul(43758.5453)).mul(0.06).sub(0.03)

    return withParticles.add(tsl.vec3(grain, grain, grain))
  })()

  const mesh = new THREE.Mesh(geometry, material)
  scene.add(mesh)

  // 5. Mediabunny output
  const output = new Output({
    format: new Mp4OutputFormat(),
    target: new BufferTarget(),
  })
  const videoSource = new CanvasSource(offscreen, {
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
    // Audio padded (intro silence + main + outro silence).
    await audioSource.add(audioBuffer)

    const startWallTime = performance.now()
    let beatDecay = 0
    for (let i = 0; i < totalFrames; i++) {
      if (signal?.aborted) throw new Error('Export zrušen uživatelem')

      const videoTime = i / EXPORT_FPS

      // Vykreslit snímek podle fáze (intro / main / outro).
      if (i < timing.mainStartFrame) {
        const introT = videoTime
        drawIntroFrame(
          compositorCtx,
          EXPORT_WIDTH,
          EXPORT_HEIGHT,
          introT,
          timing.introDurationSec,
          credits?.title ?? '',
          credits?.artist,
        )
      } else if (i >= timing.outroStartFrame) {
        const outroT = videoTime - timing.outroStartFrame / EXPORT_FPS
        drawOutroFrame(
          compositorCtx,
          EXPORT_WIDTH,
          EXPORT_HEIGHT,
          outroT,
          timing.outroDurationSec,
        )
      } else {
        // Main fáze — uniforms posunuté o intro offset, keyframeIdx z trimmed audia.
        const mainIdx = i - timing.mainStartFrame
        const fi = Math.min(mainIdx, features.totalFrames - 1)
        uniforms.rms.value = features.rms[fi]
        uniforms.audioTime.value = mainIdx / EXPORT_FPS

        const beatNow = features.beat[fi]
        beatDecay = Math.max(beatNow, beatDecay * 0.85)
        uniforms.beat.value = beatDecay

        const kfFloat =
          ((mainIdx / EXPORT_FPS) * (KEYFRAME_COUNT - 1)) /
          trimmedBuffer.duration
        uniforms.keyframeIdx.value = Math.min(KEYFRAME_COUNT - 1, kfFloat)

        await renderer.renderAsync(scene, camera)
        compositeMainFrame(
          compositorCtx,
          vizCanvas,
          EXPORT_WIDTH,
          EXPORT_HEIGHT,
          watermark === true,
        )
      }

      await videoSource.add(videoTime, frameDuration)

      if (i % 30 === 0 || i === totalFrames - 1) {
        const elapsedSec = (performance.now() - startWallTime) / 1000
        const fps = (i + 1) / elapsedSec
        const remainingFrames = totalFrames - (i + 1)
        const etaSec = fps > 0 ? remainingFrames / fps : 0
        onProgress({
          frame: i + 1,
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
    atlasTexture.dispose()
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
