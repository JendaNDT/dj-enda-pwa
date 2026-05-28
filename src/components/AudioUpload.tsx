import { useCallback, useRef, useState } from 'react'

const MAX_FILE_SIZE_BYTES = 200 * 1024 * 1024 // 200 MB (pokryje i WAV verze středně dlouhých tracků)

interface AudioUploadProps {
  onFileSelected: (file: File) => void
}

function validateFile(file: File): string | null {
  if (!file.type.startsWith('audio/')) {
    return `Soubor "${file.name}" není audio (detekován typ: ${file.type || 'neznámý'}).`
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1)
    return `Soubor je příliš velký (${mb} MB). Maximum je 200 MB.`
  }
  return null
}

export function AudioUpload({ onFileSelected }: AudioUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleFile = useCallback(
    (file: File) => {
      const validationError = validateFile(file)
      if (validationError) {
        setError(validationError)
        return
      }
      setError(null)
      onFileSelected(file)
    },
    [onFileSelected],
  )

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
    // Reset value, aby šel vybrat stejný soubor znovu.
    e.target.value = ''
  }

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) handleFile(file)
  }

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)
  }

  const openFileDialog = () => {
    inputRef.current?.click()
  }

  return (
    <div className="w-full max-w-xl">
      <div
        onClick={openFileDialog}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={`
          flex flex-col items-center justify-center
          px-8 py-16
          border-2 border-dashed rounded-2xl
          cursor-pointer
          transition-all duration-200
          ${
            isDragging
              ? 'border-purple-500 bg-purple-500/10 scale-[1.01]'
              : 'border-neutral-700 bg-neutral-900 hover:border-neutral-500 hover:bg-neutral-800'
          }
        `}
      >
        <div className="text-center">
          <svg
            viewBox="0 0 24 24"
            className="h-10 w-10 mx-auto mb-4 text-neutral-600"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <p className="text-lg font-medium text-neutral-200">
            Přetáhni sem audio soubor
          </p>
          <p className="mt-2 text-sm text-neutral-400">
            nebo klikni a vyber ze složky
          </p>
          <p className="mt-6 text-xs text-neutral-500">
            MP3, WAV, M4A, OGG, FLAC. Maximum 200 MB.
          </p>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="audio/*"
          onChange={handleInputChange}
          className="hidden"
        />
      </div>

      {error && (
        <div className="mt-4 px-4 py-3 rounded-lg bg-red-950/50 border border-red-800 text-sm text-red-200">
          {error}
        </div>
      )}
    </div>
  )
}
