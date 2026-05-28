/**
 * Extrahuje thumbnaily z výsledného MP4 blob přes HTMLVideoElement + canvas
 * (Fáze 4.8 — post-export preview).
 *
 * Funguje cross-browser, ale **vyžaduje** že MP4 lze dekódovat v prohlížeči
 * (= H.264 v MP4 kontejneru, což je přesně náš export pipeline).
 *
 * Použití:
 *   const urls = await extractThumbnails(mp4Blob, [0, duration/2, duration-1])
 *
 * Každý vrácený URL je `URL.createObjectURL` z PNG blobu — uživatel musí
 * volat `URL.revokeObjectURL` až je s nimi hotov, aby zabránil memory leakům.
 *
 * @param mp4Blob   Hotový MP4 výstup z exportu.
 * @param timesSec  Časy v sekundách, kde chceme thumbnaily.
 * @param maxWidth  Maximální šířka thumbnailu (zachová aspect ratio).
 *                  Default 320 px = malý preview, rychlé.
 */
export async function extractThumbnails(
  mp4Blob: Blob,
  timesSec: number[],
  maxWidth = 320,
): Promise<string[]> {
  const videoUrl = URL.createObjectURL(mp4Blob)
  try {
    const video = document.createElement('video')
    video.src = videoUrl
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'

    // Počkat na loadedmetadata aby byly dostupné rozměry + duration.
    await new Promise<void>((resolve, reject) => {
      const onLoaded = () => {
        video.removeEventListener('loadedmetadata', onLoaded)
        video.removeEventListener('error', onError)
        resolve()
      }
      const onError = () => {
        video.removeEventListener('loadedmetadata', onLoaded)
        video.removeEventListener('error', onError)
        reject(new Error('Video metadata se nepodařilo načíst'))
      }
      video.addEventListener('loadedmetadata', onLoaded)
      video.addEventListener('error', onError)
    })

    const aspect = video.videoWidth / video.videoHeight
    const thumbW = Math.min(maxWidth, video.videoWidth)
    const thumbH = Math.round(thumbW / aspect)

    const canvas = document.createElement('canvas')
    canvas.width = thumbW
    canvas.height = thumbH
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context nedostupný')

    const urls: string[] = []
    for (const t of timesSec) {
      const safeT = Math.max(0, Math.min(t, video.duration - 0.05))
      // Seek + počkat na seeked event.
      await new Promise<void>((resolve) => {
        const onSeeked = () => {
          video.removeEventListener('seeked', onSeeked)
          resolve()
        }
        video.addEventListener('seeked', onSeeked)
        video.currentTime = safeT
      })
      ctx.drawImage(video, 0, 0, thumbW, thumbH)
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), 'image/png'),
      )
      if (blob) {
        urls.push(URL.createObjectURL(blob))
      }
    }

    return urls
  } finally {
    URL.revokeObjectURL(videoUrl)
  }
}
