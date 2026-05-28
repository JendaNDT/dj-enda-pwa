import { useRef, useState } from 'react'
import {
  exportVideo,
  exportVideoModern,
  exportVideoAi,
  estimateOutputSize,
  downloadBlob,
  buildExportFilename,
  formatEta,
  formatBytes,
  EXPORT_QUALITIES,
  DEFAULT_EXPORT_QUALITY_ID,
  getExportQualityById,
  type ExportProgress,
} from '../lib/export'

export type ExportMode = 'classic' | 'modern' | 'ai'

interface ExportButtonProps {
  audioBuffer: AudioBuffer
  audioFilename: string
  /** Pro Classic = Butterchurn preset; pro Modern = Modern preset id; pro AI = nevyužito. */
  presetKey: string
  mode: ExportMode
  /** Pro AI mode — URL všech 8 keyframes. */
  aiImageUrls?: ReadonlyArray<string>
}

type Status = 'idle' | 'confirming' | 'exporting' | 'done' | 'error'

const CONFIRM_THRESHOLD_SECONDS = 600 // 10 minut

function describeStage(stage?: ExportProgress['stage']): string {
  switch (stage) {
    case 'extract':
      return 'Analyzuji audio'
    case 'finalize':
      return 'Finalizuji soubor'
    case 'render':
    default:
      return 'Renderuji'
  }
}

export function ExportButton({
  audioBuffer,
  audioFilename,
  presetKey,
  mode,
  aiImageUrls,
}: ExportButtonProps) {
  const [status, setStatus] = useState<Status>('idle')
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [qualityId, setQualityId] = useState<string>(
    DEFAULT_EXPORT_QUALITY_ID,
  )
  const abortRef = useRef<AbortController | null>(null)

  const duration = audioBuffer.duration
  const estimatedBytes = estimateOutputSize(duration, qualityId)
  const filename = buildExportFilename(audioFilename)
  const modeLabel =
    mode === 'classic' ? 'Classic' : mode === 'modern' ? 'Modern' : 'AI Hybrid'
  const quality = getExportQualityById(qualityId) ?? EXPORT_QUALITIES[1]

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
      let blob: Blob
      if (mode === 'classic') {
        blob = await exportVideo({
          audioBuffer,
          presetKey,
          qualityId,
          signal: controller.signal,
          onProgress: setProgress,
        })
      } else if (mode === 'modern') {
        blob = await exportVideoModern({
          audioBuffer,
          presetId: presetKey,
          qualityId,
          signal: controller.signal,
          onProgress: setProgress,
        })
      } else {
        if (!aiImageUrls || aiImageUrls.length < 2) {
          throw new Error('AI export potřebuje hotové keyframes (alespoň 2).')
        }
        blob = await exportVideoAi({
          audioBuffer,
          imageUrls: aiImageUrls,
          qualityId,
          signal: controller.signal,
          onProgress: setProgress,
        })
      }
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
    const etaEstimateMin =
      mode === 'classic'
        ? Math.ceil(duration / 60)
        : Math.ceil(duration / 60 / 2.5) // Modern + AI jsou ~2.5× rychlejší
    return (
      <div className="px-6 py-5 rounded-2xl bg-amber-950/30 border border-amber-800/50">
        <div className="text-xs uppercase tracking-wider text-amber-400 mb-2">
          Potvrzení dlouhého exportu · {modeLabel} · {quality.name}
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
          Export · {modeLabel} · {describeStage(progress.stage)}
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
          Hotovo · {modeLabel}
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
          Export selhal · {modeLabel}
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
    <div className="space-y-3">
      <div className="px-6 py-4 rounded-2xl bg-neutral-900 border border-neutral-800">
        <label className="text-xs uppercase tracking-wider text-neutral-500 mb-2 block">
          Kvalita exportu
        </label>
        <select
          value={qualityId}
          onChange={(e) => setQualityId(e.target.value)}
          className="w-full h-10 px-3 rounded-lg bg-neutral-800 border border-neutral-700 text-sm text-neutral-100 focus:outline-none focus:border-purple-500"
        >
          {EXPORT_QUALITIES.map((q) => (
            <option key={q.id} value={q.id}>
              {q.name} — {q.description}
            </option>
          ))}
        </select>
        <div className="mt-2 text-xs text-neutral-500">
          Odhad velikosti: <strong>{formatBytes(estimatedBytes)}</strong>
          {' · '}
          {quality.width}×{quality.height} @ {quality.fps} FPS
        </div>
      </div>
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
        Exportovat do MP4 · {modeLabel}
      </button>
    </div>
  )
}
