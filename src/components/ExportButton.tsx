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
  EXPORT_RESOLUTIONS,
  EXPORT_FPS_OPTIONS,
  DEFAULT_RESOLUTION_ID,
  DEFAULT_FPS,
  getExportResolutionById,
  computeVideoBitrate,
  isExportConfigSupported,
  type ExportProgress,
  type ExportRange,
  type ExportCredits,
  type ExportDestination,
} from '../lib/export'
import { extractThumbnails } from '../lib/thumbnails'
import { showToast } from '../lib/toast'

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
  const [resolutionId, setResolutionId] = useState<string>(DEFAULT_RESOLUTION_ID)
  const [fps, setFps] = useState<number>(DEFAULT_FPS)
  /** Podporované kombinace (klíč `${resId}-${fps}`); null = ještě se zjišťuje. */
  const [supportedCombos, setSupportedCombos] = useState<Set<string> | null>(
    null,
  )
  /** Thumbnail URLs po dokončeném exportu (3 obrázky: start/middle/end). */
  const [thumbnailUrls, setThumbnailUrls] = useState<string[]>([])
  /** Blob URL na výsledné MP4 pro „Otevřít v novém tabu" a Web Share API. */
  const [resultUrl, setResultUrl] = useState<string | null>(null)
  /** Hotový MP4 blob, pamatovaný pro Web Share API (potřebuje File objekt). */
  const resultBlobRef = useRef<Blob | null>(null)

  // Watermark + credits state (Fáze 4.12 + 4.13).
  const [watermark, setWatermark] = useState<boolean>(false)
  const [creditsEnabled, setCreditsEnabled] = useState<boolean>(false)
  /** Default = filename bez extenze (audioFilename → stem). */
  const defaultTitle = audioFilename.replace(/\.[^/.]+$/, '')
  const [creditsTitle, setCreditsTitle] = useState<string>(defaultTitle)
  const [creditsArtist, setCreditsArtist] = useState<string>('')
  /** „Pokročilé nastavení" expand/collapse — perzistované v localStorage (Fáze 5.7).
   *  Default zavřené pro nové uživatele. Power user si rozklikne a my si pamatujeme. */
  const [advancedOpen, setAdvancedOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem('dj-enda:export-advanced-open') === '1'
    } catch {
      return false
    }
  })

  // Probe podporovaných kombinací rozlišení × fps (WebCodecs isConfigSupported).
  // Jednou po mountu; nepodporované (typicky 2160p120) pak v UI zašedneme.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const ok = new Set<string>()
      for (const r of EXPORT_RESOLUTIONS) {
        for (const f of EXPORT_FPS_OPTIONS) {
          if (await isExportConfigSupported(r.id, f)) ok.add(`${r.id}-${f}`)
        }
      }
      if (!cancelled) setSupportedCombos(ok)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  /** Je kombinace podporovaná? Dokud probe neproběhl (null), bereme vše za OK. */
  const comboSupported = (rid: string, f: number) =>
    supportedCombos === null || supportedCombos.has(`${rid}-${f}`)

  // Feature-detect Web Share API s File support.
  const canShare =
    typeof navigator !== 'undefined' &&
    typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function'

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

  // Reset credits title z nového filename.
  useEffect(() => {
    setCreditsTitle(audioFilename.replace(/\.[^/.]+$/, ''))
    setCreditsArtist('')
    setCreditsEnabled(false)
    setWatermark(false)
  }, [audioFilename])

  const toggleAdvanced = () => {
    setAdvancedOpen((prev) => {
      const next = !prev
      try {
        localStorage.setItem('dj-enda:export-advanced-open', next ? '1' : '0')
      } catch {
        // ignore (private mode)
      }
      return next
    })
  }

  // Cleanup thumbnail / result URL při unmountu.
  useEffect(() => {
    return () => {
      thumbnailUrls.forEach((u) => URL.revokeObjectURL(u))
      if (resultUrl) URL.revokeObjectURL(resultUrl)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Effektivní rozsah exportu — vždy alespoň MIN_TRIM_LENGTH_SECONDS.
  const safeEnd = Math.max(trimEnd, trimStart + MIN_TRIM_LENGTH_SECONDS)
  const safeStart = Math.min(trimStart, safeEnd - MIN_TRIM_LENGTH_SECONDS)
  const effectiveDuration = Math.max(MIN_TRIM_LENGTH_SECONDS, safeEnd - safeStart)
  const isTrimmed =
    safeStart > 0.01 || fullDuration - safeEnd > 0.01

  const range: ExportRange | undefined = isTrimmed
    ? { startSec: safeStart, endSec: safeEnd }
    : undefined

  /** Credits předané do export funkcí (pokud zapnuté a title je zadaný). */
  const credits: ExportCredits | undefined =
    creditsEnabled && creditsTitle.trim().length > 0
      ? {
          title: creditsTitle.trim(),
          artist: creditsArtist.trim() || undefined,
        }
      : undefined

  /** Počet aktivních pokročilých nastavení — pro badge u toggleru (Fáze 5.7). */
  const advancedActiveCount =
    (isTrimmed ? 1 : 0) + (creditsEnabled ? 1 : 0) + (watermark ? 1 : 0)

  const estimatedBytes = estimateOutputSize(effectiveDuration, resolutionId, fps)
  const filename = buildExportFilename(audioFilename)
  const modeLabel =
    mode === 'classic' ? 'Classic' : mode === 'modern' ? 'Modern' : 'AI Hybrid'
  const resolution = getExportResolutionById(resolutionId)
  const videoBitrate = computeVideoBitrate(resolutionId, fps)

  const handleExportClick = () => {
    setErrorMsg(null)
    if (effectiveDuration > CONFIRM_THRESHOLD_SECONDS) {
      setStatus('confirming')
    } else {
      runExport()
    }
  }

  const runExport = async () => {
    // Pojistka: nepodporovaná kombinace (např. 2160p120) se nepustí do exportu.
    if (!comboSupported(resolutionId, fps)) {
      setErrorMsg(
        `${resolution.label} @ ${fps} fps není tímto prohlížečem/HW podporováno. Zvol nižší rozlišení nebo fps.`,
      )
      setStatus('error')
      return
    }
    setStatus('exporting')
    setProgress({ frame: 0, totalFrames: 1, etaSec: 0, fps: 0 })
    const controller = new AbortController()
    abortRef.current = controller

    // Pokud prohlížeč umí File System Access API (Chromium), streamujeme MP4
    // rovnou do souboru na disku — paměť zůstane plochá i u dlouhých / 4K stop.
    // Jinak fallback: in-memory Blob + klasické stažení.
    let fileHandle: FileSystemFileHandle | null = null
    if (typeof window.showSaveFilePicker === 'function') {
      try {
        fileHandle = await window.showSaveFilePicker({
          suggestedName: filename,
          types: [
            { description: 'MP4 video', accept: { 'video/mp4': ['.mp4'] } },
          ],
        })
      } catch (e) {
        // Uživatel zavřel dialog výběru souboru → tichý návrat, žádná chyba.
        if (e instanceof DOMException && e.name === 'AbortError') {
          setStatus('idle')
          abortRef.current = null
          return
        }
        throw e
      }
    }

    try {
      const destination: ExportDestination = fileHandle
        ? { kind: 'stream', writable: await fileHandle.createWritable() }
        : { kind: 'buffer' }

      let blob: Blob | null
      if (mode === 'classic') {
        blob = await exportVideo({
          audioBuffer,
          presetKey,
          resolutionId,
          fps,
          destination,
          range,
          watermark,
          credits,
          signal: controller.signal,
          onProgress: setProgress,
        })
      } else if (mode === 'modern') {
        blob = await exportVideoModern({
          audioBuffer,
          presetId: presetKey,
          resolutionId,
          fps,
          destination,
          range,
          watermark,
          credits,
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
          resolutionId,
          fps,
          destination,
          range,
          watermark,
          credits,
          signal: controller.signal,
          onProgress: setProgress,
        })
      }

      // Stream: soubor je už na disku (Mediabunny ho zavřel ve finalize) —
      // získáme ho zpět jako disk-backed File pro náhledy/sdílení bez držení
      // celého souboru v RAM. Buffer: klasické stažení Blobu.
      let resultBlob: Blob
      if (blob) {
        downloadBlob(blob, filename)
        resultBlob = blob
      } else if (fileHandle) {
        resultBlob = await fileHandle.getFile()
      } else {
        throw new Error('Export nevrátil žádný výstup.')
      }

      // Pamatovat blob pro Web Share + vyrobit URL pro „Otevřít v novém tabu".
      resultBlobRef.current = resultBlob
      const url = URL.createObjectURL(resultBlob)
      setResultUrl(url)

      // Extract 3 thumbnaily (start, middle, end). Fail-safe: pokud se nepodaří,
      // ukážeme jen prázdný done state — nezdržujeme uživatele chybou.
      try {
        const thumbs = await extractThumbnails(resultBlob, [
          0,
          effectiveDuration / 2,
          Math.max(0, effectiveDuration - 0.5),
        ])
        setThumbnailUrls(thumbs)
      } catch {
        setThumbnailUrls([])
      }

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
    // Cleanup thumbnail URLs a result URL.
    thumbnailUrls.forEach((u) => URL.revokeObjectURL(u))
    setThumbnailUrls([])
    if (resultUrl) URL.revokeObjectURL(resultUrl)
    setResultUrl(null)
    resultBlobRef.current = null
  }

  const openResultInNewTab = () => {
    if (resultUrl) window.open(resultUrl, '_blank', 'noopener,noreferrer')
  }

  const shareResult = async () => {
    const blob = resultBlobRef.current
    if (!blob) {
      showToast('Video není připravené ke sdílení.', 'error')
      return
    }
    const file = new File([blob], filename, { type: 'video/mp4' })
    const shareData: ShareData = {
      files: [file],
      title: filename,
      text: `${modeLabel} videoklip · ${formatEta(effectiveDuration)}`,
    }
    // Některé prohlížeče (hlavně desktop) hlásí share API, ale sdílení souboru
    // neumí — pak nabídneme stažený soubor / „Otevřít video".
    if (typeof navigator.canShare !== 'function' || !navigator.canShare(shareData)) {
      showToast(
        'Tento prohlížeč neumí sdílet video soubor. Použij stažený soubor nebo „Otevřít video".',
        'info',
        6000,
      )
      return
    }
    try {
      await navigator.share(shareData)
    } catch (e) {
      // AbortError = uživatel sdílení zrušil → nic nehlásíme.
      if (e instanceof DOMException && e.name === 'AbortError') return
      showToast(
        'Sdílení se nezdařilo: ' +
          (e instanceof Error ? e.message : 'neznámá chyba'),
        'error',
        6000,
      )
    }
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
          Potvrzení dlouhého exportu · {modeLabel} · {resolution.label} · {fps} fps
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
          Video <strong className="break-all">{filename}</strong> bylo staženo
          do tvé složky Stažené.
        </p>

        {/* Thumbnail preview — 3 snímky (start / middle / end). */}
        {thumbnailUrls.length > 0 && (
          <div className="mt-4 grid grid-cols-3 gap-2">
            {thumbnailUrls.map((url, i) => (
              <div
                key={i}
                className="aspect-video rounded-lg bg-neutral-950 border border-neutral-800 overflow-hidden"
              >
                <img
                  src={url}
                  alt={`Náhled ${i + 1} ze 3`}
                  className="w-full h-full object-cover"
                />
              </div>
            ))}
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          {resultUrl && (
            <button
              type="button"
              onClick={openResultInNewTab}
              className="px-4 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-100 text-sm transition-colors flex items-center gap-2"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
              Otevřít video
            </button>
          )}
          {canShare && (
            <button
              type="button"
              onClick={shareResult}
              className="px-4 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-100 text-sm transition-colors flex items-center gap-2"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="18" cy="5" r="3" />
                <circle cx="6" cy="12" r="3" />
                <circle cx="18" cy="19" r="3" />
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
              </svg>
              Sdílet
            </button>
          )}
        </div>

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
        <div className="grid grid-cols-2 gap-3">
          <div>
            <span className="text-xs text-neutral-400 mb-1 block">Rozlišení</span>
            <select
              value={resolutionId}
              onChange={(e) => {
                const rid = e.target.value
                setResolutionId(rid)
                // Když nové rozlišení nepodporuje aktuální fps, spadni na podporované.
                if (!comboSupported(rid, fps)) {
                  const ok = EXPORT_FPS_OPTIONS.filter((f) =>
                    comboSupported(rid, f),
                  )
                  setFps(
                    comboSupported(rid, DEFAULT_FPS)
                      ? DEFAULT_FPS
                      : (ok[ok.length - 1] ?? DEFAULT_FPS),
                  )
                }
              }}
              className="w-full h-10 px-3 rounded-lg bg-neutral-800 border border-neutral-700 text-sm text-neutral-100 focus:outline-none focus:border-purple-500"
            >
              {EXPORT_RESOLUTIONS.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <span className="text-xs text-neutral-400 mb-1 block">Snímky / s</span>
            <select
              value={fps}
              onChange={(e) => setFps(Number(e.target.value))}
              className="w-full h-10 px-3 rounded-lg bg-neutral-800 border border-neutral-700 text-sm text-neutral-100 focus:outline-none focus:border-purple-500"
            >
              {EXPORT_FPS_OPTIONS.map((f) => {
                const ok = comboSupported(resolutionId, f)
                return (
                  <option key={f} value={f} disabled={!ok}>
                    {f} fps{f === 120 ? ' (experiment.)' : ''}
                    {ok ? '' : ' — nepodporováno'}
                  </option>
                )
              })}
            </select>
          </div>
        </div>
        <div className="mt-2 text-xs text-neutral-500">
          Odhad velikosti: <strong>{formatBytes(estimatedBytes)}</strong>
          {' · '}
          {resolution.width}×{resolution.height} @ {fps} fps ·{' '}
          {Math.round(videoBitrate / 1_000_000)} Mbps
        </div>
        {fps === 120 && (
          <p className="mt-1 text-xs text-amber-500/80">
            120 fps je experimentální — YouTube většinou přehrává v 60, soubor je
            větší a render pomalejší.
          </p>
        )}
        {mode === 'ai' && (resolutionId === '1440p' || resolutionId === '2160p') && (
          <p className="mt-1 text-xs text-amber-500/80">
            AI keyframes mají ~1 MP — ve {resolution.label} se upscalují, obraz
            bude měkčí. Pro AI mód je 1080p obvykle ostřejší volba.
          </p>
        )}
      </div>

      {/* Pokročilé nastavení toggle (Fáze 5.7) — sbaluje trim, credits, watermark. */}
      <button
        type="button"
        onClick={toggleAdvanced}
        aria-expanded={advancedOpen}
        className="w-full px-6 py-3 rounded-2xl bg-neutral-900 border border-neutral-800 hover:border-neutral-700 transition-colors flex items-center justify-between"
      >
        <span className="flex items-center gap-2 text-sm text-neutral-300">
          <svg
            viewBox="0 0 24 24"
            className={`h-4 w-4 text-neutral-500 transition-transform ${
              advancedOpen ? 'rotate-90' : ''
            }`}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
          Pokročilé nastavení
          {advancedActiveCount > 0 && (
            <span className="ml-1 px-1.5 py-0.5 rounded-full bg-purple-600/30 text-purple-200 text-[10px] font-medium">
              {advancedActiveCount} aktivní
            </span>
          )}
        </span>
        <span className="text-xs text-neutral-500">
          Oříznutí · titulky · watermark
        </span>
      </button>

      {advancedOpen && (
        <div className="space-y-3">

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

      {/* Credits karta (intro / outro titulky, Fáze 4.12). */}
      <div className="px-6 py-4 rounded-2xl bg-neutral-900 border border-neutral-800">
        <label className="flex items-center justify-between cursor-pointer">
          <span className="text-xs uppercase tracking-wider text-neutral-500">
            Intro & outro titulky
          </span>
          <input
            type="checkbox"
            checked={creditsEnabled}
            onChange={(e) => setCreditsEnabled(e.target.checked)}
            className="h-4 w-4 accent-purple-500"
          />
        </label>
        {creditsEnabled && (
          <div className="mt-3 space-y-2">
            <div>
              <label className="text-xs text-neutral-400 block mb-1">
                Název skladby
              </label>
              <input
                type="text"
                value={creditsTitle}
                onChange={(e) => setCreditsTitle(e.target.value)}
                placeholder="Track title"
                className="w-full h-10 px-3 rounded-lg bg-neutral-800 border border-neutral-700 text-sm text-neutral-100 focus:outline-none focus:border-purple-500"
              />
            </div>
            <div>
              <label className="text-xs text-neutral-400 block mb-1">
                Autor (volitelný)
              </label>
              <input
                type="text"
                value={creditsArtist}
                onChange={(e) => setCreditsArtist(e.target.value)}
                placeholder="Artist"
                className="w-full h-10 px-3 rounded-lg bg-neutral-800 border border-neutral-700 text-sm text-neutral-100 focus:outline-none focus:border-purple-500"
              />
            </div>
            <p className="text-xs text-neutral-500">
              3 s intro „Track: X by Y" + 3 s outro „Made with DJ Enda".
              Audio v intro a outro je tiché.
            </p>
          </div>
        )}
      </div>

      {/* Watermark toggle (Fáze 4.13). */}
      <div className="px-6 py-4 rounded-2xl bg-neutral-900 border border-neutral-800">
        <label className="flex items-center justify-between cursor-pointer">
          <span className="text-xs uppercase tracking-wider text-neutral-500">
            Watermark (DJE logo v rohu)
          </span>
          <input
            type="checkbox"
            checked={watermark}
            onChange={(e) => setWatermark(e.target.checked)}
            className="h-4 w-4 accent-purple-500"
          />
        </label>
      </div>

        </div>
      )}

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
