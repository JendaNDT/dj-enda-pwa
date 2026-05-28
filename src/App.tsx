import { useState } from 'react'
import { AudioUpload } from './components/AudioUpload'
import { Visualizer, pickInitialPreset } from './components/Visualizer'
import { ThreeVisualizer } from './components/ThreeVisualizer'
import { AiHybrid } from './components/AiHybrid'
import { ExportButton } from './components/ExportButton'
import {
  useAudioDecoder,
  formatDuration,
  formatCount,
  describeChannels,
} from './lib/audio'
import { DEFAULT_PRESET_ID } from './lib/modernPresets'

type VisualizerMode = 'classic' | 'modern' | 'ai'

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
  const { buffer, isLoading, error } = useAudioDecoder(audioFile)

  const reset = () => setAudioFile(null)

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
      </header>

      {/* MAIN — wide grid: na lg sidebar napravo, jinak stack. */}
      <main className="flex-1 w-full px-4 md:px-8 lg:px-12 py-8">
        <div className="mx-auto max-w-[1600px]">
          {!audioFile ? (
            // Bez audio: centrovaný upload zóna, plně na střed.
            <div className="flex items-center justify-center min-h-[60vh]">
              <AudioUpload onFileSelected={setAudioFile} />
            </div>
          ) : (
            // S audio: grid (lg) / stack (< lg).
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6 items-start">
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

                {/* Mode toggle nad vizualizérem (kontextově patří k němu). */}
                {buffer && (
                  <div className="flex justify-center lg:justify-start">
                    <div className="flex gap-1 p-1 rounded-full bg-neutral-900 border border-neutral-800 flex-wrap">
                      <button
                        type="button"
                        onClick={() => setVisualizerMode('classic')}
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
                        className={`px-4 py-1.5 rounded-full text-sm transition-colors ${
                          visualizerMode === 'ai'
                            ? 'bg-purple-600 text-white'
                            : 'text-neutral-400 hover:text-neutral-200'
                        }`}
                      >
                        AI Hybrid
                      </button>
                    </div>
                  </div>
                )}

                {/* Vizualizér — full main column width (canvas má aspect-video). */}
                {buffer && visualizerMode === 'classic' && (
                  <Visualizer
                    audioBuffer={buffer}
                    currentPreset={currentPreset}
                    onPresetChange={setCurrentPreset}
                  />
                )}

                {buffer && visualizerMode === 'modern' && (
                  <ThreeVisualizer
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
              </div>

              {/* SIDEBAR — kompaktní karta soubor + audio data, pak export controls. */}
              <aside className="space-y-4 lg:sticky lg:top-6">
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
                    <dl className="mt-4 pt-4 border-t border-neutral-800 grid grid-cols-2 gap-y-2 text-xs">
                      <dt className="text-neutral-500">Délka</dt>
                      <dd className="text-neutral-100 font-medium text-right">
                        {formatDuration(buffer.duration)}
                      </dd>

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
