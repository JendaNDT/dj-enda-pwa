# DJ Enda

PWA pro tvorbu audio-reaktivních hudebních videoklipů přímo v prohlížeči.

**Live:** <https://dj-enda-pwa.vercel.app>

## Co to umí

Nahraj audio (Suno AI export, libovolné MP3 / WAV / M4A / OGG / FLAC, do 200 MB)
a aplikace ti vygeneruje hudební videoklip s vizualizérem reagujícím na hudbu.
Na výběr jsou tři vizuální módy plus srovnávací režim:

- **Classic** — Milkdrop vizualizér (Butterchurn), ~150 presetů s vyhledáváním,
  oblíbenými, náhledy v rozbalovátku a ladicími parametry (auto-cyklení presetů,
  doba přechodu, detail mřížky, anti-aliasing, ostrost).
- **Modern** — vlastní WebGPU/Three.js (TSL) shadery, 8 presetů (Sphere,
  Particles, Kaleidoscope, Wave Field, Plasma, Tunnel, Terrain Mesh, Fractal
  Noise) reagujících na frekvenční pásma (kick / snare / hi-hat).
- **AI Hybrid** — AI keyframy z HuggingFace (FLUX) + shader crossfade mezi nimi
  (vyžaduje vlastní HF token, BYO-key).
- **Srovnání** — Classic a Modern vedle sebe na jeden sdílený zvuk.

Výstup je **MP4** (H.264 + AAC, volitelně 720p–1440p, default 1080p60 12 Mbps),
volitelně s oříznutím, intro/outro titulky a watermarkem, připravený na YouTube.
Všechno běží lokálně v prohlížeči — žádný backend, žádný upload do cloudu, žádná
registrace. Instalovatelné jako PWA, klávesové zkratky, plně responzivní desktop
layout.

## Technologický stack

- **React 19 + Vite + TypeScript + Tailwind 4** — frontend
- **vite-plugin-pwa** — PWA manifest, service worker, instalovatelnost
- **Web Audio API + Meyda** — dekódování a offline analýza audia (RMS, pásma, beat)
- **@webamp/butterchurn + butterchurn-presets** — Classic (Milkdrop) vizualizér
- **Three.js + WebGPURenderer (TSL)** — Modern vlastní shadery
- **HuggingFace Inference (FLUX)** — AI keyframy (volitelné, BYO-key)
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
