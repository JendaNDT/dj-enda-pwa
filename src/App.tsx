import { useEffect, useRef, useState } from 'react'
import { AudioUpload } from './components/AudioUpload'
import { Visualizer, pickInitialPreset } from './components/Visualizer'
import { ThreeVisualizer } from './components/ThreeVisualizer'
import { AiHybrid } from './components/AiHybrid'
import { ComparisonView } from './components/ComparisonView'
import { ExportButton } from './components/ExportButton'
import { ToastContainer } from './components/ToastContainer'
import { Hero } from './components/Hero'
import {
  useAudioDecoder,
  formatDuration,
  formatCount,
  describeChannels,
} from './lib/audio'
import { DEFAULT_PRESET_ID } from './lib/modernPresets'
import type { VisualizerHandle } from './types/visualizerHandle'

type VisualizerMode = 'classic' | 'modern' | 'ai' | 'comparison'

/**
 * `beforeinstallprompt` event není v lib.dom.d.ts (Chrome-specific PWA API),
 * takže si definujeme minimální tvar pro typové bezpečí.
 */
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: ReadonlyArray<string>
  prompt(): Promise<void>
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/**
 * Tabulka klávesových zkratek — zobrazena v help overlay (Fáze 4.6).
 * Pořadí má smysl: nejčastější akce nahoře.
 */
const SHORTCUTS: { keys: string; description: string }[] = [
  { keys: 'Mezerník', description: 'Play / Pauza' },
  { keys: 'N', description: 'Další preset' },
  { keys: 'P', description: 'Předchozí preset' },
  { keys: 'R', description: 'Náhodný preset' },
  { keys: 'F', description: 'Fullscreen vizualizér' },
  { keys: '/', description: 'Hledat preset (jen Classic)' },
  { keys: '?', description: 'Zobrazit / skrýt tuto nápovědu' },
  { keys: 'Esc', description: 'Zavřít fullscreen / nápovědu' },
]

function formatFileSize(bytes: number): string {
  const mb = bytes / 1024 / 1024
  return `${mb.toFixed(1)} MB`
}

function App() {
  const [audioFile, setAudioFile] = useState<File | null>(null)
  const [currentPreset, setCurrentPreset] = useState<string>(() =>
    pickInitialPreset(),
  )
  const [modernPresetId, setModernPresetId] =
    useState<string>(DEFAULT_PRESET_ID)
  const [visualizerMode, setVisualizerMode] =
    useState<VisualizerMode>('classic')
  const [showHelp, setShowHelp] = useState(false)
  /** Onboarding bubble u help tlačítka — zobrazí se jen prvním návštěvníkům
   *  po prvním uploadu (Fáze 5.9). Dismiss = uloží flag do localStorage. */
  const [showOnboardingBubble, setShowOnboardingBubble] = useState<boolean>(() => {
    try {
      return localStorage.getItem('dj-enda:onboarding-seen') !== '1'
    } catch {
      return false
    }
  })
  /** Sidebar karta — collapse / expand tech-spec detailů (Fáze 5.4). */
  const [showAudioDetails, setShowAudioDetails] = useState<boolean>(false)
  /** Zachycený `beforeinstallprompt` event pro PWA install (Fáze 4.11).
   *  Pokud null, install není dostupný (už nainstalováno, nebo prohlížeč
   *  install nepodporuje). */
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null)
  const { buffer, isLoading, error } = useAudioDecoder(audioFile)

  // Ref na aktuální vizualizér — imperative API pro keyboard shortcuts.
  // Mode-specific ref se nastavuje při renderu, App.tsx z něj volá při keydown.
  const visualizerHandleRef = useRef<VisualizerHandle | null>(null)
  // Ref na kontejner vizualizéru pro fullscreen toggle.
  const visualizerContainerRef = useRef<HTMLDivElement | null>(null)

  const reset = () => setAudioFile(null)

  const dismissOnboarding = () => {
    setShowOnboardingBubble(false)
    try {
      localStorage.setItem('dj-enda:onboarding-seen', '1')
    } catch {
      // ignore
    }
  }

  // ─── PWA install prompt (Fáze 4.11) ──────────────────────────────────────
  useEffect(() => {
    const handleBeforeInstall = (e: Event) => {
      // Prohlížeč chce zobrazit svůj default install banner — my si ho
      // chceme řídit sami přes tlačítko v top baru.
      e.preventDefault()
      setInstallPrompt(e as BeforeInstallPromptEvent)
    }
    const handleInstalled = () => {
      setInstallPrompt(null)
    }
    window.addEventListener('beforeinstallprompt', handleBeforeInstall)
    window.addEventListener('appinstalled', handleInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall)
      window.removeEventListener('appinstalled', handleInstalled)
    }
  }, [])

  const handleInstallClick = async () => {
    if (!installPrompt) return
    await installPrompt.prompt()
    const choice = await installPrompt.userChoice
    if (choice.outcome === 'accepted') {
      // Po install se prompt už nedá použít znovu — Chrome ho recykluje.
      setInstallPrompt(null)
    }
  }

  const toggleFullscreen = () => {
    const el = visualizerContainerRef.current
    if (!el) return
    if (document.fullscreenElement) {
      void document.exitFullscreen()
    } else {
      void el.requestFullscreen().catch(() => {
        // Browser/permission denied — tiše ignorujeme.
      })
    }
  }

  // ─── Globální keyboard shortcuts (Fáze 4.6) ──────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Skip když uživatel píše v inputu / textareu / contenteditable.
      const target = e.target as HTMLElement | null
      if (target) {
        const tag = target.tagName
        if (
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          tag === 'SELECT' ||
          target.isContentEditable
        ) {
          // Výjimka: Esc vždy projde — zavře help i fullscreen ze vstupů.
          if (e.key !== 'Escape') return
        }
      }

      // Esc — zavřít help nebo fullscreen.
      if (e.key === 'Escape') {
        if (showHelp) {
          e.preventDefault()
          setShowHelp(false)
        }
        return
      }

      // ? — toggle help (shift+/ na americké klávesnici, jen / na české…).
      if (e.key === '?') {
        e.preventDefault()
        setShowHelp((s) => !s)
        return
      }

      const handle = visualizerHandleRef.current
      if (!handle) return

      switch (e.key) {
        case ' ':
          e.preventDefault()
          handle.togglePlayPause()
          break
        case 'n':
        case 'N':
          e.preventDefault()
          handle.nextPreset()
          break
        case 'p':
        case 'P':
          e.preventDefault()
          handle.prevPreset()
          break
        case 'r':
        case 'R':
          e.preventDefault()
          handle.randomPreset()
          break
        case 'f':
        case 'F':
          e.preventDefault()
          toggleFullscreen()
          break
        case '/':
          if (handle.focusSearch) {
            e.preventDefault()
            handle.focusSearch()
          }
          break
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [showHelp])

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-neutral-950 via-neutral-950 to-purple-950/30 text-neutral-100">
      {/* TOP BAR — přes celou šířku, sticky není potřeba, ale wide layout je. */}
      <header className="w-full px-4 md:px-8 lg:px-12 py-5 border-b border-neutral-900/80">
        <div className="mx-auto max-w-[1600px] flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-3">
            <svg viewBox="0 0 48 48" className="h-10 w-10" aria-hidden="true">
              <rect
                x="2"
                y="2"
                width="44"
                height="44"
                rx="10"
                fill="#0a0a0a"
                stroke="#9333ea"
                strokeWidth="2"
              />
              <circle cx="36" cy="12" r="2.5" fill="#9333ea" />
              <text
                x="24"
                y="32"
                textAnchor="middle"
                fontSize="16"
                fontFamily="system-ui, -apple-system, sans-serif"
                fontWeight="700"
                fill="#fafafa"
              >
                DJE
              </text>
            </svg>
            <div>
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight leading-none">
                DJ Enda
              </h1>
              <p className="text-xs md:text-sm text-neutral-400 mt-1">
                Hudební videoklipy přímo v prohlížeči.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Install tlačítko — viditelné jen když Chrome poskytl prompt event. */}
            {installPrompt && (
              <button
                type="button"
                onClick={handleInstallClick}
                className="h-9 px-4 flex items-center gap-2 rounded-full bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium transition-colors"
                aria-label="Nainstalovat aplikaci"
                title="Nainstalovat na plochu"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Nainstalovat
              </button>
            )}

            {/* Help tlačítko — otevře overlay s klávesovými zkratkami. */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setShowHelp(true)
                  if (showOnboardingBubble) dismissOnboarding()
                }}
                className="h-9 w-9 flex items-center justify-center rounded-full bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-neutral-400 hover:text-neutral-200 transition-colors"
                aria-label="Klávesové zkratky"
                title="Klávesové zkratky (?)"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              </button>
              {/* Onboarding bubble — viditelný jen prvně + po uploadu (Fáze 5.9). */}
              {showOnboardingBubble && audioFile && (
                <div className="absolute top-full right-0 mt-2 w-64 px-3 py-2 rounded-lg bg-purple-600 text-white text-xs shadow-xl animate-toast-in z-50">
                  <div className="absolute -top-1 right-3 w-2 h-2 bg-purple-600 rotate-45" />
                  <div className="flex items-start gap-2">
                    <span className="flex-1">
                      Stiskni <kbd className="px-1 py-0.5 rounded bg-purple-900/60 font-mono text-[10px]">?</kbd> pro klávesové zkratky (Space, N/P, F, …).
                    </span>
                    <button
                      type="button"
                      onClick={dismissOnboarding}
                      className="shrink-0 text-purple-200 hover:text-white"
                      aria-label="Zavřít nápovědu"
                    >
                      <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path strokeLinecap="round" d="M18 6L6 18M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Disclaimer pill — privacy uklidnění */}
            <div className="px-4 py-2 rounded-full bg-emerald-950/30 border border-emerald-900/50 flex items-center gap-2 text-xs text-emerald-300/90">
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4 shrink-0"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3" y="11" width="18" height="11" rx="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              <span>
                Vše běží jen v prohlížeči — žádný server, žádný upload.
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* MAIN — wide grid: na lg sidebar napravo, jinak stack. */}
      <main className="flex-1 w-full px-4 md:px-8 lg:px-12 py-8">
        <div className="mx-auto max-w-[1600px]">
          {!audioFile ? (
            // Bez audio: Hero showcase + upload zóna.
            <div className="space-y-2">
              <Hero />
              <div className="flex justify-center">
                <AudioUpload onFileSelected={setAudioFile} />
              </div>
            </div>
          ) : (
            // S audio: grid (md+) / stack (< md). Breakpoint snížen na md
            // (768 px) aby iPad portrait dostal wide layout — Fáze 5.3.
            <div className="grid grid-cols-1 md:grid-cols-[1fr_340px] gap-6 items-start">
              {/* MAIN COLUMN — mode toggle + vizualizér + (Classic/Modern: export under canvas not used; export is in sidebar) */}
              <div className="space-y-4 min-w-0">
                {/* Loading state */}
                {isLoading && (
                  <div className="px-6 py-5 rounded-2xl bg-neutral-900 border border-neutral-800 flex items-center gap-3">
                    <div className="h-4 w-4 rounded-full border-2 border-purple-500 border-t-transparent animate-spin" />
                    <span className="text-sm text-neutral-300">
                      Dekóduji audio data…
                    </span>
                  </div>
                )}

                {/* Error state */}
                {error && (
                  <div className="px-6 py-4 rounded-2xl bg-red-950/50 border border-red-800 text-sm text-red-200">
                    {error}
                  </div>
                )}

                {/* Mode toggle + popisek pod aktivním režimem (5.1).
                    Subtitle vysvětluje, co aktuální mode dělá — pro uživatele,
                    co nezná Butterchurn / Three.js / HF FLUX terminologii. */}
                {buffer && (
                  <div className="flex flex-col items-center md:items-start gap-2">
                    <div className="flex gap-1 p-1 rounded-full bg-neutral-900 border border-neutral-800 flex-wrap">
                      <button
                        type="button"
                        onClick={() => setVisualizerMode('classic')}
                        title="Klasické Milkdrop presety (Butterchurn), ~150 efektů"
                        className={`px-4 py-1.5 rounded-full text-sm transition-colors ${
                          visualizerMode === 'classic'
                            ? 'bg-purple-600 text-white'
                            : 'text-neutral-400 hover:text-neutral-200'
                        }`}
                      >
                        Classic
                      </button>
                      <button
                        type="button"
                        onClick={() => setVisualizerMode('modern')}
                        title="Vlastní WebGPU shadery (Three.js TSL), 8 efektů"
                        className={`px-4 py-1.5 rounded-full text-sm transition-colors ${
                          visualizerMode === 'modern'
                            ? 'bg-purple-600 text-white'
                            : 'text-neutral-400 hover:text-neutral-200'
                        }`}
                      >
                        Modern
                      </button>
                      <button
                        type="button"
                        onClick={() => setVisualizerMode('ai')}
                        title="AI generované obrazy přes HuggingFace + shader crossfade"
                        className={`px-4 py-1.5 rounded-full text-sm transition-colors ${
                          visualizerMode === 'ai'
                            ? 'bg-purple-600 text-white'
                            : 'text-neutral-400 hover:text-neutral-200'
                        }`}
                      >
                        AI Hybrid
                      </button>
                      <button
                        type="button"
                        onClick={() => setVisualizerMode('comparison')}
                        title="Classic a Modern vedle sebe na stejný zvuk"
                        className={`px-4 py-1.5 rounded-full text-sm transition-colors ${
                          visualizerMode === 'comparison'
                            ? 'bg-purple-600 text-white'
                            : 'text-neutral-400 hover:text-neutral-200'
                        }`}
                      >
                        Srovnání
                      </button>
                    </div>
                    <p className="text-xs text-neutral-500 max-w-md text-center md:text-left">
                      {visualizerMode === 'classic' &&
                        'Klasické Milkdrop presety — ~150 efektů, esteticky preferované, real-time export.'}
                      {visualizerMode === 'modern' &&
                        'Vlastní WebGPU shadery — 8 efektů (Sphere, Particles, Kaleidoscope, Wave, Plasma, Tunnel, Terrain Mesh, Fractal Noise), 3-5× rychlejší export.'}
                      {visualizerMode === 'ai' &&
                        'AI obrazy z HuggingFace (Flux) + shader crossfade. Vyžaduje HF token. Filmově vypadající výstup.'}
                      {visualizerMode === 'comparison' &&
                        'Classic a Modern vedle sebe na stejný zvuk — porovnej a vyber, který engine ti sedí.'}
                    </p>
                  </div>
                )}

                {/* Vizualizér — full main column width (canvas má aspect-video).
                    Container drží ref pro fullscreen toggle (F klávesa). */}
                <div ref={visualizerContainerRef} className="bg-black/0">
                  {buffer && visualizerMode === 'classic' && (
                    <Visualizer
                      ref={visualizerHandleRef}
                      audioBuffer={buffer}
                      currentPreset={currentPreset}
                      onPresetChange={setCurrentPreset}
                    />
                  )}

                  {buffer && visualizerMode === 'modern' && (
                    <ThreeVisualizer
                      ref={visualizerHandleRef}
                      audioBuffer={buffer}
                      currentPresetId={modernPresetId}
                      onPresetChange={setModernPresetId}
                    />
                  )}

                  {buffer && visualizerMode === 'ai' && (
                    <AiHybrid
                      audioBuffer={buffer}
                      audioFilename={audioFile.name}
                    />
                  )}

                  {buffer && visualizerMode === 'comparison' && (
                    <ComparisonView
                      audioBuffer={buffer}
                      classicPreset={currentPreset}
                      onClassicPresetChange={setCurrentPreset}
                      modernPresetId={modernPresetId}
                      onModernPresetChange={setModernPresetId}
                    />
                  )}
                </div>
              </div>

              {/* SIDEBAR — kompaktní karta soubor + audio data, pak export controls. */}
              <aside className="space-y-4 md:sticky md:top-6">
                {/* Sloučená karta: soubor + audio data */}
                <div className="px-6 py-5 rounded-2xl bg-neutral-900 border border-neutral-800 transition-colors hover:border-neutral-700">
                  <div className="text-xs uppercase tracking-wider text-neutral-500">
                    Vybraný soubor
                  </div>
                  <div className="mt-2 text-base font-medium text-neutral-100 break-all leading-snug">
                    {audioFile.name}
                  </div>
                  <div className="mt-1 text-xs text-neutral-400">
                    {formatFileSize(audioFile.size)} ·{' '}
                    {audioFile.type || 'audio'}
                  </div>

                  {buffer && (
                    <div className="mt-4 pt-4 border-t border-neutral-800">
                      {/* Délka je vždy viditelná (důležitý údaj pro uživatele). */}
                      <div className="flex justify-between text-xs">
                        <span className="text-neutral-500">Délka</span>
                        <span className="text-neutral-100 font-medium">
                          {formatDuration(buffer.duration)}
                        </span>
                      </div>

                      {/* Tech detaily (sample rate atd.) v collapsable sekci — Fáze 5.4. */}
                      <button
                        type="button"
                        onClick={() => setShowAudioDetails((s) => !s)}
                        className="mt-3 flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-300 transition-colors"
                        aria-expanded={showAudioDetails}
                      >
                        <svg
                          viewBox="0 0 24 24"
                          className={`h-3 w-3 transition-transform ${
                            showAudioDetails ? 'rotate-90' : ''
                          }`}
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polyline points="9 18 15 12 9 6" />
                        </svg>
                        {showAudioDetails ? 'Skrýt detaily' : 'Detaily'}
                      </button>
                      {showAudioDetails && (
                        <dl className="mt-2 grid grid-cols-2 gap-y-2 text-xs">
                          <dt className="text-neutral-500">Sample rate</dt>
                          <dd className="text-neutral-100 font-medium text-right">
                            {formatCount(buffer.sampleRate)} Hz
                          </dd>

                          <dt className="text-neutral-500">Kanály</dt>
                          <dd className="text-neutral-100 font-medium text-right">
                            {describeChannels(buffer.numberOfChannels)}
                          </dd>

                          <dt className="text-neutral-500">Vzorky</dt>
                          <dd className="text-neutral-100 font-medium text-right">
                            {formatCount(buffer.length)}
                          </dd>
                        </dl>
                      )}
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={reset}
                    className="mt-4 text-sm text-purple-400 hover:text-purple-300 transition-colors"
                  >
                    Vybrat jiný soubor
                  </button>
                </div>

                {/* Export — Classic + Modern. AI mode má vlastní export uvnitř AiHybrid. */}
                {buffer && visualizerMode === 'classic' && (
                  <ExportButton
                    audioBuffer={buffer}
                    audioFilename={audioFile.name}
                    presetKey={currentPreset}
                    mode="classic"
                  />
                )}

                {buffer && visualizerMode === 'modern' && (
                  <ExportButton
                    audioBuffer={buffer}
                    audioFilename={audioFile.name}
                    presetKey={modernPresetId}
                    mode="modern"
                  />
                )}
              </aside>
            </div>
          )}
        </div>
      </main>

      {/* Help overlay — klávesové zkratky (Fáze 4.6). */}
      {showHelp && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setShowHelp(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-neutral-900 border border-neutral-800 p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div className="text-xs uppercase tracking-wider text-neutral-500">
                Klávesové zkratky
              </div>
              <button
                type="button"
                onClick={() => setShowHelp(false)}
                className="h-8 w-8 flex items-center justify-center rounded-full bg-neutral-800 hover:bg-neutral-700 text-neutral-400 hover:text-neutral-200 transition-colors"
                aria-label="Zavřít"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            <dl className="space-y-2 text-sm">
              {SHORTCUTS.map((s) => (
                <div key={s.keys} className="flex items-center justify-between gap-4">
                  <dt className="text-neutral-300">{s.description}</dt>
                  <dd>
                    <kbd className="px-2 py-0.5 rounded bg-neutral-800 border border-neutral-700 text-neutral-100 text-xs font-mono">
                      {s.keys}
                    </kbd>
                  </dd>
                </div>
              ))}
            </dl>
            <p className="text-xs text-neutral-500 pt-2 border-t border-neutral-800">
              Zkratky fungují kdekoliv na stránce kromě textových polí.
              Mezerník v idle stavu spustí náhled.
            </p>
          </div>
        </div>
      )}

      {/* Toast notifikace container — fixed pozice, mountnut na root (Fáze 5.8). */}
      <ToastContainer />

      <footer className="w-full px-4 md:px-8 lg:px-12 py-6 border-t border-neutral-900/80">
        <div className="mx-auto max-w-[1600px] flex items-center gap-3 text-xs text-neutral-600">
          <span>Verze 0.5.0 · Desktop wide layout</span>
          <span className="h-1 w-1 rounded-full bg-neutral-700" />
          <a
            href="https://github.com/JendaNDT/dj-enda-pwa"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-neutral-400 transition-colors"
          >
            Zdroják na GitHubu
          </a>
        </div>
      </footer>
    </div>
  )
}

export default App
