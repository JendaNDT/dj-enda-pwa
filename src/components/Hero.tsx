import { useEffect, useRef, useState } from 'react'

/**
 * Pre-upload hero sekce s 3 showcase kartami pro Classic / Modern / AI módy
 * (Fáze 5.10). Cíl: uživatel hned vidí, co aplikace umí, ještě před uploadem.
 *
 * Každá karta může mít buď:
 * - **Reálné video** v `public/showcase/{kind}.mp4` (~10s loop, ~1 MB).
 *   Když existuje, použije se `<video muted autoplay loop playsInline>`.
 * - **Animovaný placeholder** — gradient + emoji/icon + DJE logo s pulse.
 *   Fallback když video není dostupné.
 *
 * Komponenta zkusí načíst video; pokud `onerror` fired (404, decode fail),
 * spadne na placeholder. Žádná konfigurace neumírá build.
 */

interface ShowcaseItem {
  kind: 'classic' | 'modern' | 'ai'
  label: string
  description: string
  /** Cesta k videu v `public/`. */
  videoSrc: string
  /** Tailwind gradient classes pro placeholder fallback. */
  placeholderGradient: string
  /** Emoji nebo malý SVG pro placeholder. */
  icon: string
}

const SHOWCASE_ITEMS: ShowcaseItem[] = [
  {
    kind: 'classic',
    label: 'Classic',
    description: 'Milkdrop presety, ~150 efektů, retro estetika',
    videoSrc: '/showcase/classic.mp4',
    placeholderGradient: 'from-pink-900 via-purple-900 to-indigo-900',
    icon: '◉',
  },
  {
    kind: 'modern',
    label: 'Modern',
    description: 'WebGPU shadery, 8 vlastních efektů, filmové vzezření',
    videoSrc: '/showcase/modern.mp4',
    placeholderGradient: 'from-cyan-900 via-blue-900 to-purple-900',
    icon: '◈',
  },
  {
    kind: 'ai',
    label: 'AI Hybrid',
    description: 'AI obrazy (Flux) + shader crossfade, hudebně synchronizované',
    videoSrc: '/showcase/ai.mp4',
    placeholderGradient: 'from-amber-900 via-rose-900 to-purple-900',
    icon: '✦',
  },
]

export function Hero() {
  return (
    <div className="space-y-6 mb-10">
      <div className="text-center max-w-2xl mx-auto">
        <h2 className="text-2xl md:text-3xl font-bold text-neutral-100 mb-2">
          Z tvojí skladby hotový videoklip
        </h2>
        <p className="text-sm md:text-base text-neutral-400">
          Vyber vizuální styl, nahraj MP3 nebo WAV, klikni „Exportovat".
          Hotové MP4 do minuty, vše v prohlížeči — žádný server, žádný upload.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-4xl mx-auto">
        {SHOWCASE_ITEMS.map((item) => (
          <ShowcaseCard key={item.kind} item={item} />
        ))}
      </div>
    </div>
  )
}

function ShowcaseCard({ item }: { item: ShowcaseItem }) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [videoFailed, setVideoFailed] = useState(false)

  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const handleError = () => setVideoFailed(true)
    v.addEventListener('error', handleError)
    return () => v.removeEventListener('error', handleError)
  }, [])

  return (
    <div className="group relative aspect-video rounded-2xl overflow-hidden bg-neutral-900 border border-neutral-800 hover:border-purple-500/50 transition-colors">
      {/* Video — pokud existuje. Fallback na placeholder gradient při error. */}
      {!videoFailed && (
        <video
          ref={videoRef}
          src={item.videoSrc}
          muted
          autoPlay
          loop
          playsInline
          preload="metadata"
          className="w-full h-full object-cover"
          aria-label={`Ukázka ${item.label}`}
        />
      )}

      {/* Placeholder — vždy vykreslený, ale překrytý videem (pokud běží). */}
      {videoFailed && (
        <div
          className={`absolute inset-0 bg-gradient-to-br ${item.placeholderGradient} flex items-center justify-center`}
        >
          <div className="text-6xl text-white/30 animate-pulse">{item.icon}</div>
        </div>
      )}

      {/* Label overlay — vždy viditelný, na hover více čitelný. */}
      <div className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/90 via-black/60 to-transparent">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-semibold text-white text-sm">{item.label}</span>
          <span className="text-[10px] uppercase tracking-wider text-purple-300/80">
            Mode
          </span>
        </div>
        <p className="mt-1 text-xs text-neutral-300 line-clamp-2">
          {item.description}
        </p>
      </div>
    </div>
  )
}
