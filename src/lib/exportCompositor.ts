/**
 * Compositor utility pro export pipeline (Fáze 4.12 + 4.13).
 *
 * Architektura:
 *   Internal canvas (WebGL Butterchurn / WebGPU Three.js) → drawImage do
 *   compositor canvas (2D OffscreenCanvas) → optional overlay (watermark,
 *   intro/outro text) → Mediabunny CanvasSource.add().
 *
 * Compositor canvas je 2D, takže můžeme libovolně `drawText`, `fillRect`
 * a `drawImage` přes hotový snímek vizualizéru. WebGL ani WebGPU sami
 * `drawText` neumí (nemají 2D context), takže tahle vrstva je nutná pro
 * jakýkoliv overlay.
 */

import type { ExportRange } from './export'

/**
 * Volitelné credits — když nastavené, render přidá intro frame na začátek
 * a outro frame na konec. Audio se pad-uje silence aby seděl uprostřed.
 */
export interface ExportCredits {
  /** Název skladby (povinný). */
  title: string
  /** Autor (volitelný, vynechá se pokud chybí). */
  artist?: string
  /** Délka intro framu v sekundách. Default 3. */
  introDurationSec?: number
  /** Délka outro framu v sekundách. Default 3. */
  outroDurationSec?: number
}

export const DEFAULT_INTRO_DURATION = 3
export const DEFAULT_OUTRO_DURATION = 3
export const OUTRO_TEXT = 'Made with DJ Enda'

/**
 * Resolved metadata o credits — délky v sekundách + framech.
 */
export interface CreditsTiming {
  introDurationSec: number
  outroDurationSec: number
  introFrames: number
  outroFrames: number
  /** Frame, od kterého začíná hlavní obsah (= introFrames). */
  mainStartFrame: number
  /** Frame, na kterém končí hlavní obsah a začíná outro. */
  outroStartFrame: number
}

export function resolveCreditsTiming(
  credits: ExportCredits | undefined,
  mainFrames: number,
  fps: number,
): CreditsTiming {
  const introSec = credits ? credits.introDurationSec ?? DEFAULT_INTRO_DURATION : 0
  const outroSec = credits ? credits.outroDurationSec ?? DEFAULT_OUTRO_DURATION : 0
  const introFrames = Math.round(introSec * fps)
  const outroFrames = Math.round(outroSec * fps)
  return {
    introDurationSec: introSec,
    outroDurationSec: outroSec,
    introFrames,
    outroFrames,
    mainStartFrame: introFrames,
    outroStartFrame: introFrames + mainFrames,
  }
}

/**
 * Pad-uje AudioBuffer silence na začátku a konci. Pokud `introSec` i
 * `outroSec` jsou 0, vrací původní buffer beze změny.
 */
export function padAudioBufferWithSilence(
  buffer: AudioBuffer,
  introSec: number,
  outroSec: number,
): AudioBuffer {
  if (introSec <= 0 && outroSec <= 0) return buffer
  const sampleRate = buffer.sampleRate
  const introSamples = Math.round(introSec * sampleRate)
  const outroSamples = Math.round(outroSec * sampleRate)
  const totalSamples = introSamples + buffer.length + outroSamples
  const tmpCtx = new AudioContext({ sampleRate })
  const out = tmpCtx.createBuffer(buffer.numberOfChannels, totalSamples, sampleRate)
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const src = buffer.getChannelData(ch)
    const dst = new Float32Array(totalSamples)
    dst.set(src, introSamples)
    // intro samples (0..introSamples) a outro samples (introSamples+length..end)
    // zůstávají jako 0 = ticho.
    out.copyToChannel(dst, ch)
  }
  tmpCtx.close().catch(() => {})
  return out
}

/**
 * Nakreslí intro frame — gradient pozadí + skladba + autor.
 * Animace: fade in title (0..0.5s), fade in artist (0.3..0.8s), full hold do konce.
 */
export function drawIntroFrame(
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  width: number,
  height: number,
  frameTime: number,
  totalDuration: number,
  title: string,
  artist?: string,
): void {
  // Dark gradient background.
  const grad = ctx.createLinearGradient(0, 0, 0, height)
  grad.addColorStop(0, '#0a0a0a')
  grad.addColorStop(1, '#1a0e2e')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, width, height)

  // Fade-in alpha based on frame time.
  const titleAlpha = Math.min(1, frameTime / 0.5)
  const artistAlpha = artist ? Math.min(1, Math.max(0, (frameTime - 0.3) / 0.5)) : 0
  // Fade-out v posledních 0.3s před koncem intro.
  const fadeOut = Math.max(0, Math.min(1, (totalDuration - frameTime) / 0.3))

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  // Label „Track".
  ctx.globalAlpha = titleAlpha * fadeOut * 0.6
  ctx.fillStyle = '#9333ea'
  const labelSize = Math.floor(height * 0.04)
  ctx.font = `${labelSize}px system-ui, -apple-system, sans-serif`
  ctx.fillText('TRACK', width / 2, height / 2 - height * 0.12)

  // Title.
  ctx.globalAlpha = titleAlpha * fadeOut
  ctx.fillStyle = '#fafafa'
  const titleSize = Math.floor(height * 0.1)
  ctx.font = `700 ${titleSize}px system-ui, -apple-system, sans-serif`
  ctx.fillText(title, width / 2, height / 2)

  // Artist (volitelný).
  if (artist) {
    ctx.globalAlpha = artistAlpha * fadeOut
    ctx.fillStyle = '#a3a3a3'
    const artistSize = Math.floor(height * 0.05)
    ctx.font = `${artistSize}px system-ui, -apple-system, sans-serif`
    ctx.fillText(`by ${artist}`, width / 2, height / 2 + height * 0.12)
  }

  ctx.globalAlpha = 1
}

/**
 * Nakreslí outro frame — gradient pozadí + „Made with DJ Enda" + logo akcent.
 * Animace: fade in v prvních 0.5s, full hold do konce.
 */
export function drawOutroFrame(
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  width: number,
  height: number,
  frameTime: number,
  totalDuration: number,
): void {
  const grad = ctx.createLinearGradient(0, 0, 0, height)
  grad.addColorStop(0, '#0a0a0a')
  grad.addColorStop(1, '#1a0e2e')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, width, height)

  const fadeIn = Math.min(1, frameTime / 0.5)
  const fadeOut = Math.max(0, Math.min(1, (totalDuration - frameTime) / 0.3))
  const alpha = fadeIn * fadeOut

  // Logo akcent — fialový čtverec s DJE iniciálami.
  ctx.globalAlpha = alpha
  ctx.fillStyle = '#0a0a0a'
  const logoSize = Math.floor(height * 0.18)
  const logoX = width / 2 - logoSize / 2
  const logoY = height / 2 - logoSize - height * 0.04
  ctx.strokeStyle = '#9333ea'
  ctx.lineWidth = Math.max(2, logoSize * 0.05)
  ctx.beginPath()
  // Rounded rect (manual — OffscreenCanvas roundRect support cross-browser unreliable).
  const radius = logoSize * 0.2
  ctx.moveTo(logoX + radius, logoY)
  ctx.lineTo(logoX + logoSize - radius, logoY)
  ctx.quadraticCurveTo(logoX + logoSize, logoY, logoX + logoSize, logoY + radius)
  ctx.lineTo(logoX + logoSize, logoY + logoSize - radius)
  ctx.quadraticCurveTo(logoX + logoSize, logoY + logoSize, logoX + logoSize - radius, logoY + logoSize)
  ctx.lineTo(logoX + radius, logoY + logoSize)
  ctx.quadraticCurveTo(logoX, logoY + logoSize, logoX, logoY + logoSize - radius)
  ctx.lineTo(logoX, logoY + radius)
  ctx.quadraticCurveTo(logoX, logoY, logoX + radius, logoY)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()

  // DJE iniciály uvnitř loga.
  ctx.fillStyle = '#fafafa'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `700 ${Math.floor(logoSize * 0.4)}px system-ui, -apple-system, sans-serif`
  ctx.fillText('DJE', logoX + logoSize / 2, logoY + logoSize / 2 + logoSize * 0.05)

  // Text „Made with DJ Enda".
  ctx.fillStyle = '#fafafa'
  ctx.font = `600 ${Math.floor(height * 0.06)}px system-ui, -apple-system, sans-serif`
  ctx.fillText(OUTRO_TEXT, width / 2, height / 2 + height * 0.06)

  ctx.globalAlpha = 1
}

/**
 * Nakreslí watermark (DJE logo + text) do pravého dolního rohu hotového snímku.
 * Polopropustný, decentní — neruší vizuál.
 */
export function drawWatermark(
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  const padding = Math.floor(height * 0.025)
  const logoSize = Math.floor(height * 0.045)
  const x = width - padding - logoSize
  const y = height - padding - logoSize

  ctx.save()
  ctx.globalAlpha = 0.55

  // Logo box.
  ctx.fillStyle = '#0a0a0a'
  ctx.strokeStyle = '#9333ea'
  ctx.lineWidth = Math.max(1.5, logoSize * 0.06)
  const r = logoSize * 0.22
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + logoSize - r, y)
  ctx.quadraticCurveTo(x + logoSize, y, x + logoSize, y + r)
  ctx.lineTo(x + logoSize, y + logoSize - r)
  ctx.quadraticCurveTo(x + logoSize, y + logoSize, x + logoSize - r, y + logoSize)
  ctx.lineTo(x + r, y + logoSize)
  ctx.quadraticCurveTo(x, y + logoSize, x, y + logoSize - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()

  // DJE iniciály.
  ctx.fillStyle = '#fafafa'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `700 ${Math.floor(logoSize * 0.45)}px system-ui, -apple-system, sans-serif`
  ctx.fillText('DJE', x + logoSize / 2, y + logoSize / 2 + logoSize * 0.04)

  ctx.restore()
}

/**
 * Hlavní compose krok — vezme zdrojový (visualizér) canvas a nakreslí ho
 * na compositor; pokud je zapnutý watermark, přidá ho přes.
 */
export function compositeMainFrame(
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  source:
    | HTMLCanvasElement
    | OffscreenCanvas
    | HTMLImageElement
    | ImageBitmap,
  width: number,
  height: number,
  withWatermark: boolean,
): void {
  ctx.drawImage(source, 0, 0, width, height)
  if (withWatermark) {
    drawWatermark(ctx, width, height)
  }
}

// Re-export ExportRange typ, ať ho compositor users nemusí importovat dvakrát.
export type { ExportRange }
