import {
  Output,
  Mp4OutputFormat,
  BufferTarget,
  CanvasSource,
  AudioBufferSource,
} from 'mediabunny'
import butterchurn from '@webamp/butterchurn'
import butterchurnPresets from 'butterchurn-presets'

const EXPORT_WIDTH = 1920
const EXPORT_HEIGHT = 1080
const EXPORT_FPS = 60
const VIDEO_BITRATE = 12_000_000 // 12 Mbps H.264
const AUDIO_BITRATE = 128_000 // 128 kbps AAC

export interface ExportProgress {
  frame: number
  totalFrames: number
  etaSec: number
  fps: number
}

export interface ExportOptions {
  audioBuffer: AudioBuffer
  presetKey: string
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
  const { audioBuffer, presetKey, onProgress, signal } = options

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
 * Odhadne velikost výstupního souboru v bajtech.
 */
export function estimateOutputSize(durationSeconds: number): number {
  const videoBytes = (durationSeconds * VIDEO_BITRATE) / 8
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
