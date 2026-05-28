import { useState } from 'react'
import { AudioUpload } from './components/AudioUpload'
import { Visualizer, pickInitialPreset } from './components/Visualizer'
import { ThreeVisualizer } from './components/ThreeVisualizer'
import { ExportButton } from './components/ExportButton'
import {
  useAudioDecoder,
  formatDuration,
  formatCount,
  describeChannels,
} from './lib/audio'
import { DEFAULT_PRESET_ID } from './lib/modernPresets'

type VisualizerMode = 'classic' | 'modern'

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
    <div className="min-h-screen bg-gradient-to-b from-neutral-950 via-neutral-950 to-purple-950/30 text-neutral-100 flex flex-col items-center justify-center p-6">
      <header className="mb-8 text-center">
        <div className="flex items-center justify-center gap-3">
          {/* Inline logo SVG — fialový čtverec s DJE iniciálami */}
          <svg
            viewBox="0 0 48 48"
            className="h-10 w-10"
            aria-hidden="true"
          >
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
          <h1 className="text-4xl font-bold tracking-tight">DJ Enda</h1>
        </div>
        <p className="mt-2 text-neutral-400">
          Hudební videoklipy přímo v prohlížeči.
        </p>
      </header>

      {/* Disclaimer banner — uklidňující ohledně privacy */}
      <div className="mb-8 px-4 py-2.5 rounded-full bg-emerald-950/30 border border-emerald-900/50 flex items-center gap-2 text-xs text-emerald-300/90 max-w-xl">
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
          Všechno běží jen v tvém prohlížeči — audio, vizualizér, export. Žádný
          server, žádný upload.
        </span>
      </div>

      {!audioFile && <AudioUpload onFileSelected={setAudioFile} />}

      {audioFile && (
        <div className="w-full max-w-xl space-y-4">
          {/* Karta s informacemi o souboru */}
          <div className="px-6 py-5 rounded-2xl bg-neutral-900 border border-neutral-800 transition-colors hover:border-neutral-700">
            <div className="text-xs uppercase tracking-wider text-neutral-500">
              Vybraný soubor
            </div>
            <div className="mt-2 text-lg font-medium text-neutral-100 break-all">
              {audioFile.name}
            </div>
            <div className="mt-1 text-sm text-neutral-400">
              {formatFileSize(audioFile.size)} · {audioFile.type || 'audio'}
            </div>
            <button
              type="button"
              onClick={reset}
              className="mt-4 text-sm text-purple-400 hover:text-purple-300 transition-colors"
            >
              Vybrat jiný soubor
            </button>
          </div>

          {/* Loading state */}
          {isLoading && (
            <div className="px-6 py-5 rounded-2xl bg-neutral-900 border border-neutral-800 transition-colors hover:border-neutral-700 flex items-center gap-3">
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

          {/* Audio data karta */}
          {buffer && (
            <div className="px-6 py-5 rounded-2xl bg-neutral-900 border border-neutral-800 transition-colors hover:border-neutral-700">
              <div className="text-xs uppercase tracking-wider text-neutral-500">
                Audio data
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-y-3 text-sm">
                <dt className="text-neutral-500">Délka</dt>
                <dd className="text-neutral-100 font-medium">
                  {formatDuration(buffer.duration)}
                  <span className="ml-2 text-neutral-500">
                    ({buffer.duration.toFixed(2)} s)
                  </span>
                </dd>

                <dt className="text-neutral-500">Sample rate</dt>
                <dd className="text-neutral-100 font-medium">
                  {formatCount(buffer.sampleRate)} Hz
                </dd>

                <dt className="text-neutral-500">Kanály</dt>
                <dd className="text-neutral-100 font-medium">
                  {describeChannels(buffer.numberOfChannels)}
                </dd>

                <dt className="text-neutral-500">Vzorky</dt>
                <dd className="text-neutral-100 font-medium">
                  {formatCount(buffer.length)}
                </dd>
              </dl>
            </div>
          )}

          {/* Toggle mezi Classic a Modern vizualizérem */}
          {buffer && (
            <div className="flex justify-center">
              <div className="flex gap-1 p-1 rounded-full bg-neutral-900 border border-neutral-800">
                <button
                  type="button"
                  onClick={() => setVisualizerMode('classic')}
                  className={`px-4 py-1.5 rounded-full text-sm transition-colors ${
                    visualizerMode === 'classic'
                      ? 'bg-purple-600 text-white'
                      : 'text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  Classic (Butterchurn)
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
                  Modern (WebGPU)
                </button>
              </div>
            </div>
          )}

          {/* Classic vizualizér */}
          {buffer && visualizerMode === 'classic' && (
            <Visualizer
              audioBuffer={buffer}
              currentPreset={currentPreset}
              onPresetChange={setCurrentPreset}
            />
          )}

          {/* Modern vizualizér (Three.js + WebGPU) */}
          {buffer && visualizerMode === 'modern' && (
            <ThreeVisualizer
              audioBuffer={buffer}
              currentPresetId={modernPresetId}
              onPresetChange={setModernPresetId}
            />
          )}

          {/* Export — Classic používá Butterchurn pipeline (real-time sync),
              Modern používá Three.js pipeline s pre-computed features (rychlejší). */}
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
        </div>
      )}

      <footer className="mt-16 flex items-center gap-3 text-xs text-neutral-600">
        <span>Verze 0.2.0 · Fáze 2 dokončena</span>
        <span className="h-1 w-1 rounded-full bg-neutral-700" />
        <a
          href="https://github.com/JendaNDT/dj-enda-pwa"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-neutral-400 transition-colors"
        >
          Zdroják na GitHubu
        </a>
      </footer>
    </div>
  )
}

export default App
