import Meyda from 'meyda'

/**
 * Offline audio analýza přes Meyda — předpočítá features pro každý frame videa.
 *
 * Proč offline místo runtime AnalyserNode:
 *   - Lepší beat detection (spectral flux s adaptivní normalizací).
 *   - Cesta k rychlejšímu-než-real-time exportu (2.5): během exportu krmíme
 *     visualizer features podle frame indexu, ne podle reálně přehrávaného audia.
 *   - Konzistence: stejné features pro live preview i export.
 */

const WINDOW_SIZE = 1024 // FFT velikost pro Meyda (~21 ms při 48 kHz)
const HISTORY_WINDOWS = 32 // ~0.5 s history pro adaptivní beat threshold

// Band separation: hranice frekvenčních pásem v bins (FFT 1024, sample rate
// 44.1-48 kHz → bin width ~22-23 Hz). Hodnoty jsou bins, ne Hz.
const LOW_BIN_END = 8 // ~0-180 Hz (kick, sub-bass)
const MID_BIN_END = 128 // ~180-2900 Hz (snare, vokál, melody)
const HIGH_BIN_END = 512 // ~2900-11600 Hz (hi-hat, brightness)

export interface AudioFeatures {
  /** RMS amplitude per frame (0..1). */
  rms: Float32Array
  /** RMS dolního pásma (kick / sub-bass) 0..1. */
  low: Float32Array
  /** RMS středního pásma (snare / melody) 0..1. */
  mid: Float32Array
  /** RMS vysokého pásma (hi-hat / brightness) 0..1. */
  high: Float32Array
  /** Spectral centroid normalizovaný 0..1 (0 = nízké tóny, 1 = vysoké). */
  spectralCentroid: Float32Array
  /** Spectral flux 0..1, normalizovaný k maximu v celém tracku. */
  spectralFlux: Float32Array
  /** Energy per frame (lineární). */
  energy: Float32Array
  /** Beat probability 0..1 — non-zero kde adaptivní threshold překročen. */
  beat: Float32Array
  /** FPS, pro který jsou features vypočítány. */
  fps: number
  /** Délka pole `rms`/`spectralCentroid`/.../  */
  totalFrames: number
}

interface MeydaFrame {
  rms: number
  spectralCentroid: number
  energy: number
  amplitudeSpectrum: Float32Array | number[]
}

/**
 * Spočítá audio features pro celý AudioBuffer, předzpracované pro `fps` snímků/s.
 * Funkce je async + yieldne každých ~100 oken, aby neblokovala UI thread.
 */
export async function extractFeatures(
  audioBuffer: AudioBuffer,
  fps: number,
  onProgress?: (pct: number) => void,
): Promise<AudioFeatures> {
  const sampleRate = audioBuffer.sampleRate

  // Mono mix (kdyby bylo stereo — vážený průměr kanálů).
  const channel0 = audioBuffer.getChannelData(0)
  let signal: Float32Array
  if (audioBuffer.numberOfChannels >= 2) {
    const channel1 = audioBuffer.getChannelData(1)
    signal = new Float32Array(channel0.length)
    for (let i = 0; i < channel0.length; i++) {
      signal[i] = (channel0[i] + channel1[i]) * 0.5
    }
  } else {
    signal = channel0
  }

  const totalWindows = Math.floor(signal.length / WINDOW_SIZE)

  // Per-window arrays
  const winRms = new Float32Array(totalWindows)
  const winLow = new Float32Array(totalWindows)
  const winMid = new Float32Array(totalWindows)
  const winHigh = new Float32Array(totalWindows)
  const winCentroid = new Float32Array(totalWindows)
  const winEnergy = new Float32Array(totalWindows)
  const winFlux = new Float32Array(totalWindows)

  Meyda.bufferSize = WINDOW_SIZE

  let prevSpectrum: Float32Array | number[] | null = null

  for (let w = 0; w < totalWindows; w++) {
    const start = w * WINDOW_SIZE
    const windowBuffer = signal.subarray(start, start + WINDOW_SIZE)

    const features = Meyda.extract(
      ['rms', 'spectralCentroid', 'energy', 'amplitudeSpectrum'],
      windowBuffer,
    ) as unknown as MeydaFrame | null

    if (features) {
      winRms[w] = features.rms
      winCentroid[w] = features.spectralCentroid
      winEnergy[w] = features.energy

      // Band RMS: spočítáme RMS amplitud pro tři frekvenční pásma.
      if (features.amplitudeSpectrum) {
        const spec = features.amplitudeSpectrum
        const lowEnd = Math.min(LOW_BIN_END, spec.length)
        const midEnd = Math.min(MID_BIN_END, spec.length)
        const highEnd = Math.min(HIGH_BIN_END, spec.length)

        let lowSum = 0
        for (let i = 0; i < lowEnd; i++) {
          lowSum += spec[i] * spec[i]
        }
        winLow[w] = Math.sqrt(lowSum / Math.max(1, lowEnd))

        let midSum = 0
        for (let i = lowEnd; i < midEnd; i++) {
          midSum += spec[i] * spec[i]
        }
        midSum /= Math.max(1, midEnd - lowEnd)
        winMid[w] = Math.sqrt(midSum)

        let highSum = 0
        for (let i = midEnd; i < highEnd; i++) {
          highSum += spec[i] * spec[i]
        }
        highSum /= Math.max(1, highEnd - midEnd)
        winHigh[w] = Math.sqrt(highSum)
      }

      // Spectral flux: suma pozitivních diferencí spektra mezi snímky.
      if (prevSpectrum && features.amplitudeSpectrum) {
        let flux = 0
        const cur = features.amplitudeSpectrum
        const len = Math.min(cur.length, prevSpectrum.length)
        for (let i = 0; i < len; i++) {
          const diff = cur[i] - prevSpectrum[i]
          if (diff > 0) flux += diff
        }
        winFlux[w] = flux
      }
      prevSpectrum = features.amplitudeSpectrum
    }

    // Yield + progress každých 100 oken.
    if (w % 100 === 0) {
      onProgress?.(w / totalWindows)
      await new Promise<void>((r) => setTimeout(r, 0))
    }
  }

  // Normalizace spectralCentroid: Meyda vrací bin index 0..bufferSize/2 → 0..1.
  const maxCentroid = WINDOW_SIZE / 2
  for (let w = 0; w < totalWindows; w++) {
    winCentroid[w] = Math.min(1, winCentroid[w] / maxCentroid)
  }

  // Normalizace flux: relativně k maximu v celém tracku.
  let maxFlux = 0
  for (let w = 0; w < totalWindows; w++) {
    if (winFlux[w] > maxFlux) maxFlux = winFlux[w]
  }
  if (maxFlux > 0) {
    for (let w = 0; w < totalWindows; w++) {
      winFlux[w] /= maxFlux
    }
  }

  // Normalizace band RMS: relativně k maximu v tracku (každý band zvlášť).
  const normalizeBand = (arr: Float32Array) => {
    let max = 0
    for (let w = 0; w < totalWindows; w++) {
      if (arr[w] > max) max = arr[w]
    }
    if (max > 0) {
      for (let w = 0; w < totalWindows; w++) {
        arr[w] /= max
      }
    }
  }
  normalizeBand(winLow)
  normalizeBand(winMid)
  normalizeBand(winHigh)

  // Resample na fps snímků za sekundu (lineární interpolace).
  const totalFrames = Math.floor(audioBuffer.duration * fps)
  const windowsPerSecond = sampleRate / WINDOW_SIZE

  const rms = new Float32Array(totalFrames)
  const low = new Float32Array(totalFrames)
  const mid = new Float32Array(totalFrames)
  const high = new Float32Array(totalFrames)
  const centroid = new Float32Array(totalFrames)
  const energy = new Float32Array(totalFrames)
  const flux = new Float32Array(totalFrames)

  const lerp = (a: number, b: number, t: number) => a * (1 - t) + b * t

  for (let f = 0; f < totalFrames; f++) {
    const t = f / fps
    const wPos = t * windowsPerSecond
    const wIdx = Math.floor(wPos)
    const wFrac = wPos - wIdx
    const wNext = Math.min(wIdx + 1, totalWindows - 1)

    rms[f] = lerp(winRms[wIdx], winRms[wNext], wFrac)
    low[f] = lerp(winLow[wIdx], winLow[wNext], wFrac)
    mid[f] = lerp(winMid[wIdx], winMid[wNext], wFrac)
    high[f] = lerp(winHigh[wIdx], winHigh[wNext], wFrac)
    centroid[f] = lerp(winCentroid[wIdx], winCentroid[wNext], wFrac)
    energy[f] = lerp(winEnergy[wIdx], winEnergy[wNext], wFrac)
    flux[f] = lerp(winFlux[wIdx], winFlux[wNext], wFrac)
  }

  // Adaptivní beat detection: porovnáme aktuální flux s rolling mean+std.
  const beat = new Float32Array(totalFrames)
  const historyFrames = Math.floor((fps * HISTORY_WINDOWS) / windowsPerSecond)
  for (let f = historyFrames; f < totalFrames; f++) {
    let sum = 0
    let sumSq = 0
    for (let h = 1; h <= historyFrames; h++) {
      const v = flux[f - h]
      sum += v
      sumSq += v * v
    }
    const mean = sum / historyFrames
    const variance = sumSq / historyFrames - mean * mean
    const std = Math.sqrt(Math.max(0, variance))
    const threshold = mean + 1.5 * std

    if (flux[f] > threshold && flux[f] > 0.1) {
      const intensity = Math.min(1, (flux[f] - threshold) / 0.3)
      beat[f] = intensity
    }
  }

  onProgress?.(1)

  return {
    rms,
    low,
    mid,
    high,
    spectralCentroid: centroid,
    spectralFlux: flux,
    energy,
    beat,
    fps,
    totalFrames,
  }
}
