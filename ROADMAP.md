# ROADMAP.md — DJ Enda PWA

Numerovaný seznam bodů, které postupně realizujeme. Vždy se pracuje na **nejnižším
nehotovém bodě**, pokud uživatel explicitně nezvolí jiný.

Legenda:
- `⏳ pending` — ještě jsme se tam nedostali
- `✅ done` — hotovo
- `➖ skipped` — vědomě přeskočeno (důvod v PROGRESS.md)

---

## Fáze 0 — Setup kontraktu projektu

| # | Bod | Status |
|---|---|---|
| 0.1 | Ověřit aktuální stav knihoven (květen 2026) | ✅ done |
| 0.2 | Vytvořit AGENTS.md / ROADMAP.md / PROGRESS.md | ⏳ pending |

---

## Fáze 1 — MVP (víkendová verze, čistě algoritmické vizuály)

Cíl: PWA, do které nahraju MP3, vyberu vizuál preset, kliknu „Export" a dostanu
hotové MP4 s vizualizovanou hudbou připravené na YouTube.

| # | Bod | Status |
|---|---|---|
| 1.1a | Scaffold Vite + React 19 + TypeScript | ✅ done |
| 1.1b | Přidat Tailwind v4 | ✅ done |
| 1.2 | Přidat vite-plugin-pwa s manifestem a service workerem | ✅ done |
| 1.3 | UI obrazovka 1: upload audio souboru (`<input type="file">`) | ✅ done |
| 1.4 | Audio dekódování přes `AudioContext.decodeAudioData()` | ✅ done |
| 1.4.1 | Zvýšit upload limit na 200 MB (kvůli WAV ze Suno) | ✅ done |
| 1.5 | Integrace `@webamp/butterchurn` — live náhled s defaultními presety | ✅ done |
| 1.6 | UI: výběr presetu, play/pause, hlasitost | ✅ done |
| 1.7 | Tlačítko „Export" — vykreslit canvas → MP4 přes Mediabunny | ✅ done |
| 1.8 | Progress bar během exportu (snímek X / N, ETA) | ✅ done |
| 1.9 | Download výsledného MP4 souboru | ✅ done |
| 1.10 | Deploy na Vercel/Netlify s COOP/COEP hlavičkami | ✅ done (na https://dj-enda-pwa.vercel.app) |

**Akceptační kritérium Fáze 1:** Uživatel nahraje 3min MP3 ze Suno AI, vybere
preset, klikne „Export", po desítkách sekund dostane MP4 1080p s vizualizací
synchronizovanou se zvukem. Stáhne ho a nahraje na YouTube. Žádný backend.

---

## Fáze 2 — Polished (1–2 týdny, vlastní WebGPU shadery)

Cíl: **Přidat** vlastní Three.js + TSL vizualizér jako paralelní Modern mód
vedle Classic (Butterchurn). Butterchurn zůstává natrvalo — uživatel ho
esteticky preferuje. Po dokončení Fáze 2 bude aplikace umět oba režimy
včetně exportu.

| # | Bod | Status |
|---|---|---|
| 2.1a | Three.js + WebGPURenderer setup (kostra + rotující icosahedron) | ✅ done |
| 2.1b | Audio reaktivita — RMS pulzování + color shift | ✅ done |
| — | **User decision:** Butterchurn ZŮSTÁVÁ natrvalo jako Classic mód | ✅ |
| 2.2 | Přidat Meyda — spectral flux beat detection (offline analýza) | ✅ done |
| 2.3a | Preset framework + Sphere Distortion | ✅ done |
| 2.3b | Particle Flow preset | ✅ done |
| 2.3c | Kaleidoscope preset | ✅ done |
| 2.4 | Audio uniformy: kick (low band), snare (mid), brightness (high), RMS, beat pulse | ✅ done |
| 2.5a | audioTime uniform — refactor presetů (TSL `time` → `audioTime`) | ✅ done |
| 2.5b | `exportVideoModern()` — rychlejší-než-real-time Modern export | ✅ done |
| 2.5c | ExportButton mode-aware + App.tsx integration | ✅ done |
| 2.5d | (volitelné, odložené) Přesunout Classic export do Web Workeru | ⏳ pending |
| 2.6 | Export kvality: Rychlý (720p30) / Standard (1080p60) / Filmový (1080p30) / Vysoká (1440p30) | ✅ done |
| 2.7 | Disclaimer banner „vše se zpracovává v prohlížeči, nic se neposílá ven" | ✅ done |
| 2.8 | UI polish: dark mode, smooth transitions, ikonografie | ✅ done |

**Akceptační kritérium Fáze 2:** Export 3min videoklipu trvá pod 60 sekund na
běžném notebooku (M2 nebo ekvivalent). UI thread zůstává responzivní během
exportu díky workeru.

---

## Fáze 3 — AI hybrid (volitelná, ~budget-driven)

Cíl: Přidat možnost generovat AI keyframy přes Fal.ai a kompozitovat je s
algoritmickými vizuály. Drahé, ale vypadá to filmově.

| # | Bod | Status |
|---|---|---|
| 3.1 | UI: BYO-key obrazovka — uživatel vloží svůj Fal.ai API klíč (lokálně, IndexedDB) | ⏳ pending |
| 3.2 | Storyboard mód: rozdělit skladbu na sekce, generovat 1 keyframe Flux 2 / sekci | ⏳ pending |
| 3.3 | Mezi keyframy: Wan 2.5 image-to-video nebo Kling 2.5 Turbo Pro | ⏳ pending |
| 3.4 | Kompozice: AI klip + algoritmický overlay (particles, light leaks) přes blend modes | ⏳ pending |
| 3.5 | Cache AI klipů v IndexedDB — uživatel většinou iteruje, ne generuje nanovo | ⏳ pending |
| 3.6 | Cenový kalkulátor: před spuštěním ukázat odhad nákladu | ⏳ pending |

**Akceptační kritérium Fáze 3:** Uživatel s 5 USD na Fal.ai účtě dostane
hybridní 3min videoklip, kde AI keyframy navazují na rytmus a algoritmický
overlay přidává polish.

---

## Co je *mimo* roadmap (vědomé volby)

- ➖ Real-time diffusion video v prohlížeči (Stable Diffusion Turbo) — v 2026
  ještě moc pomalé a paměťově náročné.
- ➖ Vlastní backend pro renderování — celá pointa je client-side PWA.
- ➖ Mobilní export — testovat jen desktop; na mobilu jen preview.
- ➖ Více jazykových mutací UI — pro MVP jen čeština.
- ➖ Účty, přihlašování, sdílení — bez backendu nemá smysl.
