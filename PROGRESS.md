# PROGRESS.md — DJ Enda PWA

Snapshot stavu projektu pro hand-off mezi sessions. Aktualizovat po každém
dokončeném bodě z `ROADMAP.md`.

**Poslední aktualizace:** 2026-05-28
**Aktuální fáze:** Fáze 1 — MVP
**Aktuální bod:** 1.7–1.9 (právě dokončené, export pipeline) → další 1.10 (deploy)

---

## Co je hotové

- **Fáze 0.1** Ověřen aktuální stav klíčových knihoven (květen 2026):
  - `mp4-muxer` je deprecated → používáme **Mediabunny**.
  - Originální `butterchurn` stagnuje 7 let → používáme **@webamp/butterchurn**.
  - Three.js r171+ má `WebGPURenderer` production-ready zero-config.
  - Meyda 5.6.3, vite-plugin-pwa, Fal.ai pricing — všechno potvrzeno.
- **Fáze 0.2** Vytvořeny soubory `AGENTS.md`, `ROADMAP.md`, `PROGRESS.md`.
- **Fáze 1.1a** Scaffold Vite projektu hotov:
  - Vytvořeno přes `npm create vite@latest dj-enda-pwa --template react-ts` v temp,
    pak zkopírováno do projektu (markdown dokumentace přežila beze změny).
  - Verze: React 19.2.6, TypeScript 6.0.2, Vite 8.0.12, ESLint 10.
  - `npm install` prošel (152 balíčků, 0 vulnerabilities).
  - `npm run build` prošel (193 KB JS gzipnuto 60 KB, build 99 ms).
  - `npx tsc --noEmit` prošel (exit 0).
- **Fáze 1.1b** Tailwind v4 přidán:
  - `npm install -D tailwindcss @tailwindcss/vite` (v4.3.0).
  - `vite.config.ts` — přidán `tailwindcss()` plugin.
  - `src/index.css` přepsán na `@import "tailwindcss";`.
  - `src/App.css` vyprázdněn (sandbox nedovolil smazat, k odstranění ručně).
  - `src/App.tsx` přepsán na minimální homepage „DJ Enda — Hudební videoklipy"
    s Tailwind utility classes (`min-h-screen`, `bg-neutral-950`, atd.).
  - `index.html` — `<title>` na „DJ Enda".
  - Build prošel (190 KB JS gzipnuto 60 KB, 7.4 KB CSS, 83 ms).
  - `npx tsc --noEmit` exit 0.

- **Fáze 1.2** vite-plugin-pwa přidán a funguje:
  - 2 PNG ikony (192 a 512) vygenerovány v sandboxu, uloženy v `public/`.
  - `vite.config.ts` — VitePWA plugin s manifestem (cs jazyk, theme black).
  - `index.html` — theme-color meta, apple-touch-icon, lang="cs", description.
  - `src/main.tsx` — `registerSW` z `virtual:pwa-register`.
  - `tsconfig.app.json` — `vite-plugin-pwa/client` v types.
  - DevTools → Application → Manifest se načítá s ikonami a kompletními metadaty.
  - Otevřené warningy (nekritické):
    - Screenshots pro richer install UI — vyřešíme ve Fázi 2 (až bude reálný UI).
    - `purpose: "any maskable"` — odstranit, ikona není navržená s maskable safe-area.
- **Fáze 1.3** UI obrazovka 1 hotová:
  - `src/components/AudioUpload.tsx` — drag-and-drop zóna + skrytý file input.
    Validace: MIME musí začínat `audio/`, max 50 MB. Chybové stavy renderují
    červenou hlášku pod zónou. Klik na zónu otevře file dialog.
  - `src/App.tsx` přepsán — drží `audioFile: File | null` ve state. Pokud
    null, ukáže `<AudioUpload>`. Pokud vybrán soubor, ukáže název + velikost
    + tlačítko „Vybrat jiný soubor".
  - Ověřeno v Chrome: drag-drop, klik, validace, reset všechno funguje.
- **Fáze 1.7–1.9** Export do MP4 hotov (sloučené do jednoho stepu):
  - `npm install mediabunny` (v1.45.4) u uživatele.
  - `src/lib/export.ts` — funkce `exportVideo()` s pipeline:
    * OffscreenCanvas 1920×1080
    * Samostatný AudioContext (audio NENÍ napojen do destination — nezní)
    * Samostatný Butterchurn vizualizér se stejným presetem jako live preview
    * Mediabunny `Output` + `Mp4OutputFormat` + `BufferTarget`
    * `CanvasSource` (H.264, 12 Mbps, 60 FPS) + `AudioBufferSource` (AAC, 128 kbps)
    * Render loop sync na real-time audio playback (Butterchurn vyžaduje běžící
      AnalyserNode v real-time AudioContextu)
  - Helpers: `estimateOutputSize`, `downloadBlob`, `buildExportFilename`,
    `formatEta`, `formatBytes`.
  - `src/components/ExportButton.tsx` — UI s 5 stavy:
    `idle | confirming | exporting | done | error`. Confirmation dialog
    pro tracky > 10 min. Progress bar s odhadem snímek X / N, % a ETA.
    AbortController pro zrušení.
  - `Visualizer.tsx` — lifted preset state nahoru přes `currentPreset` prop
    a `onPresetChange` callback. Exportuje `pickInitialPreset()` pro App.
  - `App.tsx` — drží `currentPreset` state, sdílí ho mezi Visualizerem
    a ExportButtonem. Pod Visualizerem renderuje `<ExportButton>`.
  - `npx tsc --noEmit` exit 0.
  - **Pozn.:** export trvá ≥ délka audia (sync na real-time playback). Rychlejší
    offline render přijde ve Fázi 2 s vlastními Three.js + TSL shadery.
- **Fáze 1.6** Controls rozšířeny:
  - Audio routing přepsán: `source → gain → destination` + `source → visualizer`
    paralelně (vizualizér vidí plné spektrum nezávisle na nastavené hlasitosti).
  - Status state machine: `idle | playing | paused | ended`.
  - Pause/resume přes `audioCtx.suspend()` / `resume()` — zachovává pozici.
  - Po dohrání skladby (`source.onended`) overlay s tlačítkem „Spustit znovu";
    restart vytvoří nový source (AudioBufferSourceNode je jednorázový).
  - Preset dropdown se všemi ~150 presety (sorted). Změna přes
    `visualizer.loadPreset(preset, 2.0)` — 2 sekundy plynulý blend.
  - Hlasitost slider 0–1 (`<input type="range">`) řídí `gainNode.gain.value`.
  - Play/pause tlačítko jako kulaté s SVG ikonkou (play / pause), Tailwind styling.
- **Fáze 1.5** Butterchurn vizualizér integrován:
  - `npm install @webamp/butterchurn butterchurn-presets` u uživatele (9 balíčků,
    transient deprecation warning na core-js@2.6.12 — neovlivňuje runtime).
  - `src/types/butterchurn.d.ts` — ruční TS deklarace (knihovny nemají oficiální
    typings).
  - `src/components/Visualizer.tsx` — komponenta s canvas 640×360 (16:9), tlačítko
    „Spustit náhled" (kvůli autoplay restriction). Po kliku: vytvoří AudioContext,
    AudioBufferSourceNode, butterchurn visualizer s náhodným presetem, spustí
    `requestAnimationFrame` render loop a `source.start(0)` přehrávání.
  - Cleanup při unmountu i změně `audioBuffer`: zruší animationFrame, zastaví
    source, zavře AudioContext (důležité pro paměť při změně souboru).
  - `App.tsx` — po dostupnosti `buffer` ukáže `<Visualizer audioBuffer={buffer} />`.
  - `npx tsc --noEmit` exit 0.
- **Fáze 1.4.1** Upload limit zvýšen z 50 MB na 200 MB.
  Důvod: Suno AI nabízí WAV export; typický 3-4min WAV má 30-50 MB, delší
  skladby snadno překročí původní limit. 200 MB pokryje WAV do ~18 minut.
  Pro tracky 30+ minut zůstává doporučení používat MP3 (paměťová ekonomie).
- **Fáze 1.4** Dekódování audio hotové:
  - `src/lib/audio.ts` — `decodeAudioFile(file)` utility (Web Audio API přes
    dočasný AudioContext), `useAudioDecoder(file)` React hook s loading/error
    stavy a `cancelled` flagem proti stale výsledkům, formátovací helpers
    (`formatDuration`, `formatCount`, `describeChannels`).
  - `src/App.tsx` rozšířen o tři stavy: loading (spinner), error (červený box),
    success (karta „Audio data" s délkou, sample rate, počtem kanálů a vzorků).
  - `npx tsc --noEmit` exit 0.

## Co je rozjeté

- Nic. Čekáme na ověření 1.7–1.9 v prohlížeči (testovat krátkým trackem) a souhlas
  s **1.10** (deploy na Vercel/Netlify s COOP/COEP hlavičkami).

## Co je další

- **Fáze 1.10** — deploy na Vercel nebo Netlify s COOP/COEP hlavičkami pro
  SharedArrayBuffer (potřeba pro nějaké WebCodecs scénáře). Tímto se uzavře
  celá Fáze 1 (MVP). Až uživatel řekne „piš".

## Známé bugy / problémy

- `npm install` produkuje EPERM warningy na cleanup v sandbox prostředí, ale
  výsledek je správný. Při lokálním běhu na uživatelově Macu se nebudou objevovat.
- `npm run build` nepřepíše existující `dist/` v sandboxu (EPERM na unlink).
  Workaround během sessions: `npx vite build --outDir /tmp/dj-enda-build`.
  Lokálně u uživatele tento problém není.
- `src/App.css` zbyl ve formě dvou-řádkového komentáře (sandbox nepovolil delete).
  Soubor se neimportuje, na build nemá vliv. Lze smazat ručně z Finderu.

## Klíčová rozhodnutí (z této session)

- **Stack ověřen, dvě změny oproti původnímu PDF:**
  - Mediabunny místo deprecated mp4-muxer.
  - @webamp/butterchurn místo originálního jberg/butterchurn.
- **Workflow:** vibe-coding režim, AGENTS.md je primárním kontraktem,
  ROADMAP.md je seznam úkolů, PROGRESS.md je tento snapshot.
- **Zatím žádný backend.** Vše v prohlížeči. Fal.ai až ve Fázi 3 přes BYO-key.

## Struktura souborů (aktuální stav)

```
DJ Enda PWA/
├── AGENTS.md                # kontrakt projektu
├── ROADMAP.md               # seznam fází a bodů
├── PROGRESS.md              # tento snapshot
├── SKILL.md                 # plný vibecoder workflow
├── Claude.pdf               # opinionovaná rekomendace
├── PWA pro generování hudebních videoklipů.pdf
├── README.md                # default Vite README (přepíšeme později)
├── package.json             # React 19, TypeScript 6, Vite 8
├── package-lock.json
├── vite.config.ts
├── tsconfig.json / tsconfig.app.json / tsconfig.node.json
├── eslint.config.js
├── index.html
├── .gitignore
├── public/                  # vite.svg
├── src/
│   ├── main.tsx
│   ├── App.tsx              # default Vite homepage (přepíšeme v 1.1b)
│   ├── App.css              # smažeme v 1.1b
│   ├── index.css            # přepíšeme na @import "tailwindcss"
│   ├── vite-env.d.ts
│   └── assets/react.svg
├── dist/                    # výstup buildu (gitignored)
└── node_modules/            # cca 200 MB, gitignored
```

## Otázky a otevřené body

- Jméno projektu pro `package.json`? „dj-enda-pwa"? „dj-enda"? Jiné?
- Cílová doména pro nasazení (Vercel subdoména stačí pro start, nebo vlastní)?
- Preferuje uživatel `npm`, `pnpm` nebo `bun`? (pro MVP doporučujeme `npm` =
  default v `npm create vite`).
