import { useEffect, useRef, useState } from 'react'
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
  type ExportRange,
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
const MIN_TRIM_LENGTH_SECONDS = 1

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

  // Trim state — start a end v sekundách. Default = celá skladba.
  const fullDuration = audioBuffer.duration
  const [trimStart, setTrimStart] = useState<number>(0)
  const [trimEnd, setTrimEnd] = useState<number>(fullDuration)

  const abortRef = useRef<AbortController | null>(null)

  // Reset trim, když se změní audioBuffer (jiný soubor).
  useEffect(() => {
    setTrimStart(0)
    setTrimEnd(audioBuffer.duration)
  }, [audioBuffer])

  // Effektivní rozsah exportu — vždy alespoň MIN_TRIM_LENGTH_SECONDS.
  const safeEnd = Math.max(trimEnd, trimStart + MIN_TRIM_LENGTH_SECONDS)
  const safeStart = Math.min(trimStart, safeEnd - MIN_TRIM_LENGTH_SECONDS)
  const effectiveDuration = Math.max(MIN_TRIM_LENGTH_SECONDS, safeEnd - safeStart)
  const isTrimmed =
    safeStart > 0.01 || fullDuration - safeEnd > 0.01

  const range: ExportRange | undefined = isTrimmed
    ? { startSec: safeStart, endSec: safeEnd }
    : undefined

  const estimatedBytes = estimateOutputSize(effectiveDuration, qualityId)
  const filename = buildExportFilename(audioFilename)
  const modeLabel =
    mode === 'classic' ? 'Classic' : mode === 'modern' ? 'Modern' : 'AI Hybrid'
  const quality = getExportQualityById(qualityId) ?? EXPORT_QUALITIES[1]

  const handleExportClick = () => {
    setErrorMsg(null)
    if (effectiveDuration > CONFIRM_THRESHOLD_SECONDS) {
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
          range,
          signal: controller.signal,
          onProgress: setProgress,
        })
      } else if (mode === 'modern') {
        blob = await exportVideoModern({
          audioBuffer,
          presetId: presetKey,
          qualityId,
          range,
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
          range,
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

  const resetTrim = () => {
    setTrimStart(0)
    setTrimEnd(fullDuration)
  }

  /** Když uživatel zvedne start nad end - safeguard rozšíření. */
  const handleStartChange = (v: number) => {
    const next = Math.max(0, Math.min(v, fullDuration - MIN_TRIM_LENGTH_SECONDS))
    setTrimStart(next)
    if (trimEnd < next + MIN_TRIM_LENGTH_SECONDS) {
      setTrimEnd(Math.min(fullDuration, next + MIN_TRIM_LENGTH_SECONDS))
    }
  }

  const handleEndChange = (v: number) => {
    const next = Math.max(MIN_TRIM_LENGTH_SECONDS, Math.min(v, fullDuration))
    setTrimEnd(next)
    if (trimStart > next - MIN_TRIM_LENGTH_SECONDS) {
      setTrimStart(Math.max(0, next - MIN_TRIM_LENGTH_SECONDS))
    }
  }

  // === Render ===

  if (status === 'confirming') {
    const etaEstimateMin =
      mode === 'classic'
        ? Math.ceil(effectiveDuration / 60)
        : Math.ceil(effectiveDuration / 60 / 2.5) // Modern + AI jsou ~2.5× rychlejší
    return (
      <div className="px-6 py-5 rounded-2xl bg-amber-950/30 border border-amber-800/50">
        <div className="text-xs uppercase tracking-wider text-amber-400 mb-2">
          Potvrzení dlouhého exportu · {modeLabel} · {quality.name}
        </div>
        <p className="text-sm text-neutral-200">
          Exportovaná část má {formatEta(effectiveDuration)}
          {isTrimmed && (
            <>
              {' '}(oříznuto z {formatEta(fullDuration)})
            </>
          )}
          . Export bude trvat zhruba{' '}
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

      {/* Trim sekce — start a end slidery v sekundách (krok 1s). */}
      <div className="px-6 py-4 rounded-2xl bg-neutral-900 border border-neutral-800">
        <div className="flex items-center justify-between mb-3">
          <label className="text-xs uppercase tracking-wider text-neutral-500">
            Oříznutí audia
          </label>
          {isTrimmed && (
            <button
              type="button"
              onClick={resetTrim}
              className="text-xs text-purple-400 hover:text-purple-300 transition-colors"
            >
              Reset (celá skladba)
            </button>
          )}
        </div>

        <div className="space-y-3">
          <div>
            <div className="flex justify-between text-xs text-neutral-400 mb-1">
              <span>Začátek</span>
              <span className="font-mono">{formatEta(safeStart)}</span>
            </div>
            <input
              type="range"
              min={0}
              max={Math.floor(fullDuration)}
              step={1}
              value={Math.floor(safeStart)}
              onChange={(e) => handleStartChange(parseInt(e.target.value, 10))}
              className="w-full accent-purple-500"
              aria-label="Začátek exportu"
            />
          </div>

          <div>
            <div className="flex justify-between text-xs text-neutral-400 mb-1">
              <span>Konec</span>
              <span className="font-mono">{formatEta(safeEnd)}</span>
            </div>
            <input
              type="range"
              min={0}
              max={Math.floor(fullDuration)}
              step={1}
              value={Math.ceil(safeEnd)}
              onChange={(e) => handleEndChange(parseInt(e.target.value, 10))}
              className="w-full accent-purple-500"
              aria-label="Konec exportu"
            />
          </div>
        </div>

        <div className="mt-3 text-xs text-neutral-500">
          Exportovaná část:{' '}
          <strong className="text-neutral-300">
            {formatEta(effectiveDuration)}
          </strong>
          {isTrimmed && (
            <span className="text-neutral-500">
              {' '}z {formatEta(fullDuration)}
            </span>
          )}
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
