# DJ Enda

PWA pro tvorbu audio-reaktivních hudebních videoklipů přímo v prohlížeči.

**Live:** <https://dj-enda-pwa.vercel.app>

## Co to umí

Nahraj audio (Suno AI export, libovolné MP3 / WAV / M4A / OGG / FLAC, do 200 MB)
a aplikace ti vygeneruje hudební videoklip s vizualizérem ve stylu Milkdrop —
částice, vlny, geometrické tvary měnící se podle hudby. Můžeš si vybrat z ~150
presetů a měnit je za běhu plynulým blendem.

Výstup je **MP4 1080p60** (H.264 + AAC, 12 Mbps), připravený k nahrání na YouTube.
Všechno běží lokálně v prohlížeči — žádný backend, žádný upload do cloudu, žádná
registrace.

## Technologický stack

- **React 19 + Vite + TypeScript + Tailwind 4** — frontend
- **vite-plugin-pwa** — PWA manifest, service worker, instalovatelnost
- **Web Audio API** — dekódování a analýza audia
- **@webamp/butterchurn + butterchurn-presets** — Milkdrop vizualizér
- **Mediabunny** — export do MP4 přes WebCodecs API (H.264 + AAC)

## Lokální vývoj

```bash
npm install
npm run dev
```

Otevři <http://localhost:5173>.

## Build

```bash
npm run build
npm run preview
```

## Status

Aktivně se vyvíjí. Aktuální stav projektu viz [`PROGRESS.md`](./PROGRESS.md),
plán dalších fází [`ROADMAP.md`](./ROADMAP.md), pravidla spolupráce s AI agenty
[`AGENTS.md`](./AGENTS.md).

## Licence knihoven

Projekt používá knihovny pod různými licencemi:

- @webamp/butterchurn — MIT
- butterchurn-presets — MIT
- Mediabunny — MPL-2.0
- React, Vite, Tailwind, TypeScript — MIT
