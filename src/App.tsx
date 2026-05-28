import { useState } from 'react'
import { AudioUpload } from './components/AudioUpload'
import { Visualizer, pickInitialPreset } from './components/Visualizer'
import { ExportButton } from './components/ExportButton'
import {
  useAudioDecoder,
  formatDuration,
  formatCount,
  describeChannels,
} from './lib/audio'

function formatFileSize(bytes: number): string {
  const mb = bytes / 1024 / 1024
  return `${mb.toFixed(1)} MB`
}

function App() {
  const [audioFile, setAudioFile] = useState<File | null>(null)
  const [currentPreset, setCurrentPreset] = useState<string>(() =>
    pickInitialPreset(),
  )
  const { buffer, isLoading, error } = useAudioDecoder(audioFile)

  const reset = () => setAudioFile(null)

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col items-center justify-center p-6">
      <header className="mb-12 text-center">
        <h1 className="text-4xl font-bold tracking-tight">DJ Enda</h1>
        <p className="mt-2 text-neutral-400">
          Hudební videoklipy přímo v prohlížeči.
        </p>
      </header>

      {!audioFile && <AudioUpload onFileSelected={setAudioFile} />}

      {audioFile && (
        <div className="w-full max-w-xl space-y-4">
          {/* Karta s informacemi o souboru */}
          <div className="px-6 py-5 rounded-2xl bg-neutral-900 border border-neutral-800">
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

          {/* Audio data karta */}
          {buffer && (
            <div className="px-6 py-5 rounded-2xl bg-neutral-900 border border-neutral-800">
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

          {buffer && (
            <Visualizer
              audioBuffer={buffer}
              currentPreset={currentPreset}
              onPresetChange={setCurrentPreset}
            />
          )}

          {buffer && (
            <ExportButton
              audioBuffer={buffer}
              audioFilename={audioFile.name}
              presetKey={currentPreset}
            />
          )}
        </div>
      )}

      <footer className="mt-16 text-xs text-neutral-600">
        Verze 0.0.7 · Fáze 1.7
      </footer>
    </div>
  )
}

export default App
