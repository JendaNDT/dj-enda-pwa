import { useRef, useState } from 'react'
import {
  exportVideo,
  estimateOutputSize,
  downloadBlob,
  buildExportFilename,
  formatEta,
  formatBytes,
  type ExportProgress,
} from '../lib/export'

interface ExportButtonProps {
  audioBuffer: AudioBuffer
  audioFilename: string
  presetKey: string
}

type Status = 'idle' | 'confirming' | 'exporting' | 'done' | 'error'

const CONFIRM_THRESHOLD_SECONDS = 600 // 10 minut

export function ExportButton({
  audioBuffer,
  audioFilename,
  presetKey,
}: ExportButtonProps) {
  const [status, setStatus] = useState<Status>('idle')
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const duration = audioBuffer.duration
  const estimatedBytes = estimateOutputSize(duration)
  const filename = buildExportFilename(audioFilename)

  const handleExportClick = () => {
    setErrorMsg(null)
    if (duration > CONFIRM_THRESHOLD_SECONDS) {
      setStatus('confirming')
    } else {
      runExport()
    }
  }

  const runExport = async () => {
    setStatus('exporting')
    setProgress({ frame: 0, totalFrames: 1, etaSec: 0, fps: 0 })
    const controller = new AbortController()
    abortRef.current = controller

    try {
      const blob = await exportVideo({
        audioBuffer,
        presetKey,
        signal: controller.signal,
        onProgress: setProgress,
      })
      downloadBlob(blob, filename)
      setStatus('done')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Neznámá chyba'
      setErrorMsg(msg)
      setStatus('error')
    } finally {
      abortRef.current = null
    }
  }

  const cancelExport = () => {
    abortRef.current?.abort()
  }

  const resetToIdle = () => {
    setStatus('idle')
    setProgress(null)
    setErrorMsg(null)
  }

  // === Render ===

  if (status === 'confirming') {
    const etaEstimateMin = Math.ceil(duration / 60)
    return (
      <div className="px-6 py-5 rounded-2xl bg-amber-950/30 border border-amber-800/50">
        <div className="text-xs uppercase tracking-wider text-amber-400 mb-2">
          Potvrzení dlouhého exportu
        </div>
        <p className="text-sm text-neutral-200">
          Tvůj track má {formatEta(duration)}. Export bude trvat zhruba{' '}
          <strong>{etaEstimateMin}+ minut</strong> a výsledný MP4 bude přibližně{' '}
          <strong>{formatBytes(estimatedBytes)}</strong>.
        </p>
        <p className="mt-2 text-xs text-neutral-400">
          Během exportu nech kartu otevřenou — pokud ji minimalizuješ nebo
          přepneš jinam na dlouhou dobu, Chrome by mohl render zpomalit.
        </p>
        <div className="mt-4 flex gap-3">
          <button
            type="button"
            onClick={runExport}
            className="px-5 py-2 rounded-full bg-purple-600 hover:bg-purple-500 text-white font-medium transition-colors"
          >
            Pokračovat v exportu
          </button>
          <button
            type="button"
            onClick={resetToIdle}
            className="px-5 py-2 rounded-full bg-neutral-800 hover:bg-neutral-700 text-neutral-200 transition-colors"
          >
            Zrušit
          </button>
        </div>
      </div>
    )
  }

  if (status === 'exporting' && progress) {
    const pct = (progress.frame / progress.totalFrames) * 100
    return (
      <div className="px-6 py-5 rounded-2xl bg-neutral-900 border border-neutral-800">
        <div className="text-xs uppercase tracking-wider text-neutral-500 mb-3">
          Probíhá export
        </div>
        <div className="text-sm text-neutral-200">
          Snímek {progress.frame.toLocaleString('cs-CZ')} /{' '}
          {progress.totalFrames.toLocaleString('cs-CZ')}
          <span className="ml-2 text-neutral-500">
            ({pct.toFixed(1)} %)
          </span>
        </div>
        <div className="mt-3 h-2 w-full rounded-full bg-neutral-800 overflow-hidden">
          <div
            className="h-full bg-purple-600 transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="mt-3 flex justify-between text-xs text-neutral-500">
          <span>
            Tempo: {progress.fps.toFixed(1)} snímků/s
          </span>
          <span>Zbývá: {formatEta(progress.etaSec)}</span>
        </div>
        <button
          type="button"
          onClick={cancelExport}
          className="mt-4 text-sm text-neutral-400 hover:text-neutral-200 transition-colors"
        >
          Zrušit export
        </button>
      </div>
    )
  }

  if (status === 'done') {
    return (
      <div className="px-6 py-5 rounded-2xl bg-emerald-950/30 border border-emerald-800/50">
        <div className="text-xs uppercase tracking-wider text-emerald-400 mb-2">
          Hotovo
        </div>
        <p className="text-sm text-neutral-200">
          Video <strong>{filename}</strong> bylo staženo do tvé složky Stažené.
        </p>
        <button
          type="button"
          onClick={resetToIdle}
          className="mt-4 text-sm text-purple-400 hover:text-purple-300 transition-colors"
        >
          Exportovat znovu
        </button>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="px-6 py-5 rounded-2xl bg-red-950/40 border border-red-800/60">
        <div className="text-xs uppercase tracking-wider text-red-400 mb-2">
          Export selhal
        </div>
        <p className="text-sm text-red-200">{errorMsg ?? 'Neznámá chyba'}</p>
        <button
          type="button"
          onClick={resetToIdle}
          className="mt-4 text-sm text-purple-400 hover:text-purple-300 transition-colors"
        >
          Zkusit znovu
        </button>
      </div>
    )
  }

  // status === 'idle'
  return (
    <button
      type="button"
      onClick={handleExportClick}
      className="w-full px-6 py-4 rounded-2xl bg-purple-600 hover:bg-purple-500 text-white font-medium transition-colors flex items-center justify-center gap-3"
    >
      <svg
        viewBox="0 0 24 24"
        className="h-5 w-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
      Exportovat do MP4 (1080p60)
    </button>
  )
}
