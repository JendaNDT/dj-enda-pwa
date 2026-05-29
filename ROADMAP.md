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
| — | **Strategie změna:** Fal.ai (placená) → HuggingFace + Three.js shader transitions (FREE) | ✅ |
| 3.1 | UI: AI Hybrid mode, optional HF token, storyboard scaffold | ✅ done |
| 3.2 | HF generování AI keyframes (FLUX.1-schnell), style dropdown, batch + retry | ✅ done |
| 3.3 | Three.js shader transitions mezi keyframes + audio reactivity (free, místo placené AI video) | ✅ done |
| 3.4 | Overlay efekty v AiVisualizer (vignette, film grain) | ✅ done |
| 3.5 | IndexedDB cache pro AI keyframes (audio hash + style key) | ✅ done |
| 3.6 | ~~Cenový kalkulátor~~ → AI export přes Mediabunny (free) | ✅ done |

**Akceptační kritérium Fáze 3:** Uživatel s 5 USD na Fal.ai účtě dostane
hybridní 3min videoklip, kde AI keyframy navazují na rytmus a algoritmický
overlay přidává polish.

---

---

## Fáze 4 — Polish & UX vylepšení (plánovaná, příští session)

Cíl: Dotáhnout uživatelskou zkušenost. Žádné nové fundamentální features,
spíš dotahování existujících. Implementace v dalším Cowork chatu.

Pořadí je doporučené, ale flexibilní podle reálných potřeb. Pro každý bod:
S = malá změna (~1 h), M = středně velká (~2–3 h), L = velká (~5+ h).

### Quick wins (priorita)

| # | Bod | Velikost |
|---|---|---|
| 4.1 | Vyhledávání v Classic preset dropdown (filter podle názvu, fuzzy match) ✅ done | S |
| 4.2 | Oblíbené presety (Classic + Modern) — hvězdička ikonka, localStorage, sekce „Oblíbené" v dropdownu ✅ done | S |
| 4.3 | Audio trim/range pro export — dva slidery (start/end) v ExportButton confirm dialogu ✅ done | M |

### Střední priorita

| # | Bod | Velikost |
|---|---|---|
| 4.4 | Custom prompt per AI keyframe — modal s textovým inputem v každém slotu ✅ done | M |
| 4.5 | **Desktop wide layout + plná responzivita** — refactor App.tsx na grid (sidebar + main canvas), využití celé šířky monitoru, breakpointy pro mobil ✅ done | L |
| 4.6 | Keyboard shortcuts — Space = play/pause, N/P = next/prev preset, R = random, F = fullscreen, / = focus search ✅ done | S |
| 4.7 | Reset AI cache tlačítko + indikátor využití (kolik položek je cachováno) ✅ done | S |

### Větší upgrade

| # | Bod | Velikost |
|---|---|---|
| 4.8 | Preview thumbnail po exportu — první/middle/last snímek inline + tlačítka „Otevřít" / „Sdílet" ✅ done | M |
| 4.9 | Více Modern presetů — wave field, plasma, tunnel ✅ done (terrain mesh + fractal noise → backlog) | L |
| 4.10 | HF model dropdown — Flux Dev (default) / Flux Schnell / SDXL Turbo / Custom model ID input ✅ done | S |

### Nice to have (low priority)

| # | Bod | Velikost |
|---|---|---|
| 4.11 | PWA install prompt UI — vlastní tlačítko „Nainstaluj na plochu" místo browser default ✅ done | S |
| 4.12 | Titulek/credits screen volitelně — 3 s intro „Track: X by Y" + outro „Made with DJ Enda" před exportem ✅ done | M |
| 4.13 | Watermark volitelný — polopropustné logo v rohu pro brandování ✅ done | S |
| 4.14 | Modern preset Terrain Mesh (vertex displacement na ploché ploše, audio-driven height map) ✅ done | M |
| 4.15 | Modern preset Fractal Noise (mandelbrot/julia-like iterace, beat zoom) ✅ done | M |

---

## Fáze 5 — UX polish (plánovaná)

Cíl: Dotáhnout uživatelskou zkušenost na profi level. Žádné nové core features,
ale aplikace má **působit srozumitelně od první vteřiny**, mít čisté defaulty
a delight detaily. Rozdělené do 4 roundů podle dopadu a velikosti.

### Round 1 — Quick wins (S body)

| # | Bod | Velikost |
|---|---|---|
| 5.1 | Mode toggle subtitles (Classic/Modern/AI s popiskem co to je) ✅ done | S |
| 5.2 | Volume slider vždy viditelný (nepřekvapovat až po spuštění) ✅ done | S |
| 5.3 | Mobile breakpoint lg → md (iPad portrait dostane wide layout) ✅ done | S |
| 5.4 | Audio data collapsable v sidebaru (tech-spec dump schovat) ✅ done | S |
| 5.5 | AI mode skrýt token warning po nastavení (úspěšný stav stačí) ✅ done | S |
| 5.6 | Empty visualizer state polish (ambient gradient + DJE pulse) ✅ done | S |

### Round 2 — Defaults & onboarding

| # | Bod | Velikost |
|---|---|---|
| 5.7 | Export sekce „Pokročilé nastavení" collapse (trim/credits/watermark) ✅ done | M |
| 5.8 | Toast notifikace systém + použít pro favorites/cache/token ✅ done | M |
| 5.9 | Onboarding tooltip „Stiskni ? pro shortcuts" (one-time, localStorage) ✅ done | S |

### Round 3 — Hero & live preview

| # | Bod | Velikost |
|---|---|---|
| 5.10 | Pre-upload hero showcase (3 looping ukázky Classic/Modern/AI) ✅ done (Classic + Modern reálná videa; AI zatím placeholder) | L |
| 5.11 | Live preview hned po uploadu (idle vizualizér bez audio) ✅ done | M |

### Round 4 — Ambiciózní features (každý samostatná session)

| # | Bod | Velikost |
|---|---|---|
| 5.12 | Comparison mode — Classic + Modern side-by-side, sdílený audio source ✅ done (AI vynecháno: vyžaduje keyframes + duplikaci atlas shaderu) | L |
| 5.13 | Preset thumbnails v Classic dropdown (background gen + IndexedDB cache) ✅ done | L |

### Doporučené pořadí implementace

1. **Round 1 — Quick wins**: 4.1 + 4.2 + 4.3 (cca 4 h)
2. **Round 2 — Desktop layout refactor**: 4.5 (velký bod, samostatná session)
3. **Round 3 — UX dotahy**: 4.4 + 4.6 + 4.7
4. **Round 4 — Power features**: 4.8 + 4.9 + 4.10
5. **Round 5 — Nice to have**: 4.11 + 4.12 + 4.13

Pro každý round samostatná session s vibe-coding workflow (discuss-before-code,
testovat po každém kroku, commit + push, ověřit deploy).

---

## Fáze 6 — Ladicí parametry vizualizéru (post-MVP)

Cíl: dát uživateli kontrolu nad chováním vizualizéru.

### Classic (Butterchurn)

Presety samotné ladit nejdou (Milkdrop rovnice zapečené), ale globální chování
renderu ano. Vše perzistováno v localStorage (`dj-enda:classic-controls`).

| # | Bod | Status |
|---|---|---|
| 6.1 | Auto-cyklení presetů (časovač, náhodný preset, interval) | ✅ done |
| 6.2 | Doba přechodu mezi presety (blend slider) | ✅ done |
| 6.3 | Detail warp mřížky (setInternalMeshSize, živě) | ✅ done |
| 6.4 | Ostrost / textureRatio (přes rebuild vizualizéru) | ✅ done |
| 6.5 | Anti-aliasing toggle (setOutputAA, živě) | ✅ done |

### Modern / AI (odloženo)

Modern uniformy by šlo vystavit jako per-preset posuvníky, AI má parametry už
ve stylu/promptu. Zatím neimplementováno — kandidát na další fázi.

---

## Fáze 7 — Export pipeline upgrade (rozjeté)

Cíl: zvládnout dlouhé (8+ min) a vysoké rozlišení exporty bez pádů na paměť +
flexibilní samostatná volba rozlišení a snímkové frekvence.

| # | Bod | Status |
|---|---|---|
| 7.1 | Streamování exportu na disk (showSaveFilePicker + StreamTarget, fastStart:false) | ✅ done |
| 7.2a | Dva selecty: rozlišení (720p–2160p) × fps (30/60/120), počítaný bitrate | ✅ done |
| 7.2b | Capability gating (VideoEncoder.isConfigSupported) — zašednout nepodporované (2160p120), 120fps experimentální | ✅ done |
| 7.2c | Dotažení: odhad velikosti, default 1080p/60, poznámka u AI o 4K upscalu, docs | ✅ done |

Bitrate = base@30fps podle rozlišení (720p:5 / 1080p:8 / 1440p:16 / 2160p:40 Mbps)
× faktor fps (30→1, 60→1.5, 120→2.25). Staví na 7.1 (velké soubory nepadnou na
paměť). Classic export je real-time → 4K120 nemusí GPU stíhat (Modern offline OK).

---

## Co je *mimo* roadmap (vědomé volby)

- ➖ Real-time diffusion video v prohlížeči (Stable Diffusion Turbo) — v 2026
  ještě moc pomalé a paměťově náročné.
- ➖ Vlastní backend pro renderování — celá pointa je client-side PWA.
- ➖ Mobilní export — testovat jen desktop; na mobilu jen preview.
- ➖ Více jazykových mutací UI — pro MVP jen čeština.
- ➖ Účty, přihlašování, sdílení — bez backendu nemá smysl.
