# PROGRESS.md — DJ Enda PWA

Snapshot stavu projektu pro hand-off mezi sessions. Aktualizovat po každém
dokončeném bodě z `ROADMAP.md`.

**Poslední aktualizace:** 2026-05-29
**Aktuální fáze:** Fáze 6 — Classic ovládání ✅ done (Fáze 1–5 + presety 4.14/4.15 hotové)
**Aktuální bod:** Žádný otevřený. Vše na produkci.

**HAND-OFF pro nový chat:**
- Fáze 1–5 + backlog presety 4.14/4.15 + Fáze 6 (Classic ladicí parametry) hotové,
  vše na produkci. Modern má 8 presetů.
- Zbývající volitelný backlog: **2.5d** Classic export do Web Workeru (doporučeno
  vynechat — Butterchurn potřebuje real-time AudioContext, ve workeru není),
  **showcase MP4** — Classic + Modern hotové (`public/showcase/{classic,modern}.mp4`,
  640x360 tiché web loopy), zbývá jen AI; případně **per-preset parametry pro Modern**
  (uniformy → posuvníky) — zatím neimplementováno.
- Workflow: před push `npx tsc -b`; commit/push dělá Jenda lokálně (Cowork
  sandbox neumí psát do `.git` — index.lock „Operation not permitted").
**Strategie:** Fal.ai → HuggingFace (free) + Three.js shader transitions místo
image-to-video API. Aplikace zůstává plně zdarma.
**Strategie:** **Permanentní coexistence.** Butterchurn (Classic) zůstává
natrvalo jako default — uživatel ho esteticky preferuje nad Three.js. Modern
(Three.js) je paralelní alternativa, kterou postupně dotahujeme. Žádné
„vyhození Butterchurnu" se nekoná. Export musí podporovat oba režimy.

---

## Co je hotové

- **Fáze 6 — Classic ladicí parametry (Butterchurn):**
  - **`src/lib/classicControls.ts`** — `useClassicControls()` hook se stavem
    (blendSeconds, meshLevel, sharpness, antialias, autoCycle, cycleSeconds) +
    localStorage perzistence (`dj-enda:classic-controls`), konstanty MESH_SIZES /
    MESH_LABELS / TEXTURE_RATIOS / SHARPNESS_LABELS, `countActive()` pro badge.
  - **`src/types/butterchurn.d.ts`** — přidány `setInternalMeshSize(w,h)`,
    `setOutputAA(bool)` a `outputFXAA?` do options (ověřeno v source balíčku 3.0.0-beta.5).
  - **`Visualizer.tsx`** — sbalitelný panel „Nastavení vizualizéru":
    * **Auto-cyklení** presetů (časovač → náhodný preset, interval slider).
    * **Doba přechodu** (blend) — čte se z `controlsRef` v `changePreset`.
    * **Detail mřížky** — živě `setInternalMeshSize`.
    * **Anti-aliasing** — živě `setOutputAA`.
    * **Ostrost** (textureRatio) — nemá live setter → `rebuildVisualizer()`
      (nový Butterchurn na stejném canvasu+ctx, reconnect aktuální audio node,
      reload preset). **Render loop refactorován na `visualizerRef.current?.render()`**,
      aby swap při rebuildu nepřerušil rendering.
    * Badge „N aktivní" + reset na defaulty.
  - **Pozn.:** Butterchurn presety samotné ladit nejdou (Milkdrop rovnice
    zapečené) — tohle jsou globální render/behavior knoby, ne parametry efektu.
  - `npx tsc -b` exit 0, ESLint bez nových chyb. Ověřeno v prohlížeči.

- **Backlog 4.14 + 4.15 — dva nové Modern presety (Modern má teď 8 efektů):**
  - **4.14 Terrain Mesh** — vertex displacement na jemně dělené `PlaneGeometry`
    (180×120 segmentů), nakloněné (`rotation.x −0.55`, `position.z −2`; rozměry
    zvolené tak, aby ani špičky hřebenů neprošly za fixní kameru z=3 → žádný
    clipping). Sdílená `heightField()` (ridged sin vrstvy, scroll z
    `audioTime × mid`) pro positionNode i colorNode (barva podle elevace).
    low → výška, beat → pulse, rms/high → jas.
  - **4.15 Fractal Noise** — fragment preset (full-screen plane), animovaná
    Julia množina `z = z² + c`, `c` driftuje z audioTime, **10 unrolled iterací**
    (TSL nemá smyčky → JS `for` staví node graf), beat+low „zoom", barva podle
    úniku iterace + audio.
  - **TSL lesson (důležité):** `mix()` v těchhle three typings **nebere konkrétní
    `float` faktor** (z `clamp`/`fract`/`length`) — projde jen `any` z uniformů.
    Řešeno **ručním lerpem** `a.add(b.sub(a).mul(f))` + paleta přes `vec3()`
    (ne `color()`). Stejná rodina problému jako Tunnel TSL overload fix.
  - `npx tsc -b` exit 0, ESLint čistý. Ověřeno v prohlížeči.

- **Fáze 5 Round 4 — 5.12 Comparison mode (Classic vs Modern):**
  - **`src/components/ComparisonView.tsx`** (nový, samostatný — nesahá do
    funkčních Classic / Modern / AI módů, aby comparison nemohl způsobit regrese).
    Classic (Butterchurn) + Modern (Three TSL) vedle sebe nad **jedním sdíleným
    AudioContextem**:
    * Jeden `AudioBufferSourceNode` → gain → destination (jediný slyšitelný zvuk).
    * Classic: `butterchurn.connectAudio(source)` (Butterchurn si staví vlastní
      real-time analyser).
    * Modern: předpočítané Meyda features (`extractFeatures`) indexované přes
      `audioCtx.currentTime − startTime`.
    * **Jeden `requestAnimationFrame` loop** renderuje oba enginy → dokonalý sync.
    * Idle preview: Classic přes tichý oscilátor (princip 5.11), Modern decay —
      obě dlaždice žijí ještě před spuštěním.
    * Společné controls (Spustit / Pauza / Pokračovat, hlasitost), tlačítko
      „Náhodný" preset per dlaždice (mění sdílený App stav → promítne se i do
      single módů Classic/Modern).
    * Restart po `ended`: `start()` nejdřív `stopAudioNodes()` (idle osc +
      případný předchozí source), pak vytvoří nový source.
  - **`App.tsx`** — 4. mód `'comparison'` ve `VisualizerMode`, toggle tlačítko
    „Srovnání" + subtitle, render `<ComparisonView>` (sdílí `currentPreset` +
    `modernPresetId` se single módy). Export v sidebaru pro comparison skrytý
    (jako AI) — export se dělá ve zvoleném single módu.
  - `npx tsc -b` exit 0, ESLint 0 chyb i varování. Ověřeno v prohlížeči (sync,
    jediný zvuk, pauza/pokračovat, náhodné presety, žádný leak při přepnutí).
  - **Tím je Fáze 5 kompletní (13/13). Fáze 1–5 hotové.**

- **Fáze 5 Round 4 — 5.13 Preset náhledy (thumbnails):**
  - **`src/lib/presetThumbnails.ts`** — samostatná IndexedDB databáze
    `dj-enda-thumbs` (NEsdílí store s `aiCache.ts`, aby se nemusela koordinovat
    DB verze — to byl důvod proč 5.13 dřív než 5.12). Helpery `getAllThumbnails`
    / `putThumbnail` / `clearThumbnailCache`. Generátor
    `createThumbnailGenerator()`: skrytý 192×108 butterchurn canvas + vlastní
    AudioContext + tichý oscilátor (connectAudio + `resume()` pokus pro
    audio-reaktivní náhled). `capture(preset)` = `loadPreset(0)` → 14 warm framů
    (16 ms rozestup, ať se animace pohne) → finální `render()` + **synchronní
    `drawImage` do 2D canvasu** (WebGL drawing buffer se po composit fázi
    vyčistí, kopie musí být ve stejném synchronním turnu) → JPEG q0.72 blob.
  - **`src/lib/usePresetThumbnails.ts`** — hook: na mount načte cache →
    okamžité náhledy (`Map<key, blobURL>`), dopočítá chybějící a generuje je
    sekvenčně na pozadí (INITIAL_DELAY 800 ms, 40 ms mezi presety). Token-based
    cancel (cleanup / regenerate), **pauza když `paused`** (audio hraje, ať
    nebereme GPU živému vizualizéru). Revoke blob URL na unmount i při
    regenerate. Vrací `thumbnails`, `generated`/`total`, `generating`,
    `regenerate()`.
  - **`PresetCombobox.tsx`** — volitelné props `thumbnails` +
    `thumbnailsGenerating/Done/Total`. Každý řádek má miniaturu vlevo (img /
    pulse placeholder, než doběhne). Sticky progress řádek „Generuji náhledy
    N/150" v dropdownu. Props volitelné → ostatní použití comboboxu beze změny.
  - **`Visualizer.tsx`** — `usePresetThumbnails(presetOptions, ALL_PRESETS,
    { paused: status === 'playing' })`, props předané do comboboxu, decentní
    tlačítko „↻ Přegenerovat náhledy" (dual-purpose: za běhu ukazuje progress).
  - `npx tsc -b` exit 0, ESLint na nových souborech čistý. Ověřeno v prohlížeči
    (náhledy se plní postupně, po reloadu hned z cache, pauza za přehrávání).
  - **Známá limitace:** presety bez audio energie můžou být tmavší (mitigace:
    `resume()` na tichý oscilátor → mírná reaktivita). Vite build v Cowork
    sandboxu nejde (linux-arm64 rolldown binding chybí) — gate je `tsc -b`.

- **Fáze 5 Round 3** — Hero & live preview:
  - **5.11 Live preview hned po uploadu:**
    * **Modern (`ThreeVisualizer.tsx`)** — render loop už běžel z setup
      useEffectu, jen jsem zprůhlednil overlay (`bg-gradient` s `/70`
      alpha + `backdrop-blur-[2px]`) aby vizualizér byl vidět pod ním.
      Decay uniforms v existujícím render loopu zajistí, že preset se
      hýbe i bez audio — RMS/beat decay × 0.92/0.85, audioTime tikoval
      wall-clock tempem.
    * **Classic (`Visualizer.tsx`)** — větší refactor: nový useEffect
      `setupIdlePreview` po mountu vytvoří **AudioContext + silent
      oscillator (gain 0 → destination)** + Butterchurn vizualizér napojený
      na oscillator. Pokud Chrome autoplay policy blokuje resume, čekáme
      na první `pointerdown` event a context resume.
    * `start()` v Classic refactored: **reused existing AudioContext + Butterchurn
      visualizér** z idle preview (žádný teardown), zastavíme oscillator,
      vytvoříme `AudioBufferSourceNode` → connectAudio na nový source.
      Fallback path pokud idle preview selhal — fresh setup jako dřív.
    * Cleanup rozšířen o `idleOscillatorRef` + `idleGainRef` disconnect.
  - **5.10 Hero showcase pre-upload:**
    * Nová `src/components/Hero.tsx` — slogan + 3 showcase karty Classic /
      Modern / AI v gridu `sm:grid-cols-3`.
    * **Smart video/placeholder fallback:** každá karta zkusí načíst
      `/showcase/{kind}.mp4`. Při `onerror` (404, decode fail) `setVideoFailed`
      → ukáže gradient placeholder s decentním ikonem (◉ / ◈ / ✦) a pulse
      animací.
    * **Adresář `public/showcase/`** vytvořen s `.gitkeep`. Jenda může
      kdykoliv hodit reálná MP4 (`classic.mp4`, `modern.mp4`, `ai.mp4`)
      a Hero je automaticky použije bez code změn.
    * **2026-05-29:** přidány reálné `classic.mp4` (905 kB) a `modern.mp4`
      (216 kB) — export z appky (720p) → ffmpeg na 640x360 tiché loopy
      (`-an`, H.264, crf 33/30, `+faststart`). AI zatím zůstává na
      placeholderu. Popis Modern karty opraven na „8 vlastních efektů".
    * **Label overlay** — gradient bottom-to-top s názvem režimu + popisem
      pod ním. Vždy viditelný, na hover karta zezelená border.
    * Mount v `App.tsx` pre-upload větvi nad AudioUpload zónou.
  - `npx tsc -b` exit 0.

- **Fáze 5 Round 2** — Defaults & onboarding:
  - **5.8 Toast systém** — nový `src/lib/toast.ts` se subscribe pattern
    (global array + listeners), žádný Context — `showToast(msg, kind)` lze
    volat odkudkoliv. `useToasts()` hook v `ToastContainer.tsx` komponentě.
    Auto-dismiss po 3 s, manual dismiss tlačítkem X.
    * `src/components/ToastContainer.tsx` — UI, fixed pozice (mobile bottom-center,
      desktop bottom-right), slide-in animace přes custom `@keyframes` v `index.css`.
    * Wirování: `useFavorites.toggle()` toast „Přidáno/Odebráno z oblíbených",
      `AiHybrid.handleClearCache` „AI cache vyčištěna",
      `AiHybrid.handleSaveToken/ClearToken` „HF token uložen/odstraněn",
      `AiHybrid.savePromptEditor` „Custom prompt uložen/smazán".
    * Mountnutí `<ToastContainer />` v App.tsx root vedle footeru.
  - **5.7 Export sekce „Pokročilé nastavení" collapse** — `ExportButton.tsx`:
    * Default zavřené (čistý UX pro casual usera).
    * Trim + credits + watermark přesunuté pod toggle.
    * State perzistovaný v localStorage (`dj-enda:export-advanced-open`),
      power user si pamatuje preferenci napříč sessions.
    * **Badge „N aktivní"** ukazuje počet zapnutých pokročilých nastavení
      i v zavřeném stavu — uživatel vidí, že tam něco je nastavené.
  - **5.9 Onboarding tooltip** — `App.tsx`:
    * Bubble u help tlačítka „Stiskni `?` pro klávesové zkratky".
    * Viditelný jen prvně + po prvním uploadu (`audioFile != null`).
    * Dismiss = uloží localStorage flag `dj-enda:onboarding-seen`, klik na
      help tlačítko taky dismissuje (uživatel objevil sám).
    * Slide-in animací, decentní purple barva s arrow indikátorem nahoře.
  - `npx tsc -b` exit 0.

- **Fáze 5 Round 1** — UX quick wins:
  - **5.1 Mode toggle subtitles** v `App.tsx`: pod pillem Classic/Modern/AI
    krátký popisek vysvětlující co aktuální režim dělá (např. „Klasické
    Milkdrop presety — ~150 efektů, real-time export"). Plus `title` atribut
    na každém tlačítku pro tooltip.
  - **5.2 Volume slider + play button vždy viditelné** v `Visualizer.tsx`
    a `ThreeVisualizer.tsx`. Control panel vyňatý z `isRunning` podmínky.
    V idle stavu play button = `start()`, slider mění volume state hned
    (gain se aplikuje při startu). Lepší affordance — uživatel vidí controls
    od první vteřiny.
  - **5.3 Mobile breakpoint lg → md** v `App.tsx`. Grid wide layout aktivní
    od 768 px (md), ne od 1024 px (lg) — iPad portrait/landscape teď
    dostane sidebar. Sidebar mírně užší (380 → 340 px) pro tablet fit.
  - **5.4 Audio data collapsable** v sidebar kartě (`App.tsx`). Délka skladby
    vždy viditelná (důležitý údaj), tech-spec (sample rate / kanály / vzorky)
    schovaný pod toggle „Detaily" (default zavřené). Šipka rotuje 90° při
    expanded stavu.
  - **5.5 AI token karta collapsed když má token** (`AiHybrid.tsx`).
    Místo plné karty se success blokem ukáže kompaktní jednořádkový status
    `HF token: hf_••••1234` se šipkou — klik = expand pro „Odstranit token".
    Bez tokenu zůstává plná karta s warning + návod + input. Label změněn
    z „(volitelný)" na „(povinný)" — anonymous přístup HF zrušil.
  - **5.6 Empty visualizer state polish** v `Visualizer.tsx` + `ThreeVisualizer.tsx`.
    Místo čistě černého canvasu s tlačítkem ambient gradient
    (`neutral-950 → purple-950/30`) + pulsující DJE logo (animate-pulse,
    h-16 w-16) + tlačítko s purple glow shadow. Aplikace působí živě
    i v idle stavu.
  - `npx tsc -b` exit 0.

- **Fáze 4.11 + 4.12 + 4.13** PWA install + intro/outro credits + watermark:
  - **4.11 PWA install prompt** v `App.tsx`:
    * Window event listenery `beforeinstallprompt` (zachycen, `preventDefault`)
      a `appinstalled` (čistí prompt po install).
    * State `installPrompt: BeforeInstallPromptEvent | null`. Custom typ
      definovaný inline — lib.dom.d.ts ho nemá (Chrome-specific PWA API).
    * **„Nainstalovat" tlačítko v top baru** vlevo od help tlačítka. Viditelné
      jen když máme prompt event (Chrome/Edge desktop + mobile, ne Safari).
      Klik → `prompt.prompt()` → `userChoice` → na accepted skryje tlačítko.
  - **`src/lib/exportCompositor.ts`** — sdílená vrstva pro 4.12 + 4.13:
    * `resolveCreditsTiming(credits, mainFrames, fps)` — počítá intro/outro
      framy a offset hlavního obsahu. Bez credits = passthrough (0 framů).
    * `padAudioBufferWithSilence(buffer, introSec, outroSec)` — vytvoří
      nový AudioBuffer s tichem na začátku/konci pomocí `copyToChannel`
      a `Float32Array.set`. Když intro+outro=0, vrací buffer beze změny.
    * `drawIntroFrame(ctx, w, h, t, dur, title, artist?)` — gradient pozadí,
      fade-in „TRACK" label + title + „by artist", fade-out na konci.
    * `drawOutroFrame(ctx, w, h, t, dur)` — gradient pozadí + DJE logo
      (manuálně kreslený rounded rect s quadratic curves, OffscreenCanvas
      `roundRect` cross-browser support je nestabilní) + „Made with DJ Enda".
    * `drawWatermark(ctx, w, h)` — polopropustný (0.55 alpha) DJE logo
      v pravém dolním rohu, ~4.5% výšky.
    * `compositeMainFrame(ctx, source, w, h, withWatermark)` — drawImage
      ze zdrojového visualizér canvasu + volitelný watermark overlay.
  - **`src/lib/export.ts` kompletní refactor pipeline:**
    * Všechny tři exporty (`exportVideo`, `exportVideoModern`, `exportVideoAi`)
      přijímají optional `watermark?: boolean` a `credits?: ExportCredits`.
    * Vizualizér renderuje do **vlastního `vizCanvas`** (WebGL pro Butterchurn,
      WebGPU pro Three.js a AI). Compositor `canvas` je 2D OffscreenCanvas.
      Mediabunny `CanvasSource` dostává compositor canvas — všechny overlay
      operace tam.
    * Render loop iteruje **přes `totalFrames = intro + main + outro`**:
      pro intro/outro framy se kreslí intro/outro overlay přímo do compositoru,
      pro main framy se renderuje vizualizér do vizCanvas + composite + optional
      watermark. Audio buffer je padded silence tak, aby hlavní audio začínalo
      v čase `introDurationSec`.
    * Pro Modern + AI: Meyda features se extractují **jen z hlavního audia**
      (trimmedBuffer), main render loop indexuje features přes `mainIdx =
      i - mainStartFrame`. Beat decay i audioTime také relative k mainIdx.
    * Pro Classic: Butterchurn audio routing musí běžet v real-time, takže
      sync `while (audioCtx.currentTime < targetCtxTime)` zůstává — analyser
      uvidí silence v intro/outro fázi (irrelevantní, tehdy se nerenderuje
      vizualizér).
  - **`ExportButton.tsx` rozšíření idle UI** o:
    * **Credits karta** s checkbox toggle. Při zapnutí ukáže input pro title
      (předvyplněný z filename bez extenze) a artist (volitelný). Reset přes
      `useEffect([audioFilename])` při změně souboru.
    * **Watermark toggle** karta — jednoduchý checkbox.
    * `credits: ExportCredits | undefined` resolved jen když `creditsEnabled &&
      title.trim().length > 0` — chrání před prázdnými titly.

- **Fáze 4.10** HF model dropdown:
  - `src/lib/hfClient.ts` — nový `HF_MODELS` array s 3 modely:
    * **Flux Dev** (default, nejvyšší kvalita, ~10 s)
    * **Flux Schnell** (rychlý, ~5 s)
    * **SDXL Turbo** (alternativa, ~3 s)
  - `DEFAULT_HF_MODEL` ukazuje na první (Flux Dev). Existující
    `generateImage(prompt, { modelId })` už modelId parametr měl, jen byl
    fix na Schnell.
  - **Sentinel `__custom__`** pro UI dropdown signalizuje, že uživatel chce
    custom model ID. Když je vybraný, ukáže se text input pod selectem.
  - **AiHybrid.tsx** — nová karta „AI model" nad styl kartou. `<select>`
    s předdefinovanými modely + „Custom model ID…" volba.
    `effectiveModelId` v `generateOne()` resolveuje sentinel na trim z
    `customModelId` (fallback na DEFAULT pokud prázdné).

- **Fáze 4.8** Post-export thumbnail + share:
  - `src/lib/thumbnails.ts` — nový `extractThumbnails(blob, times, maxWidth)`.
    Vytvoří `HTMLVideoElement`, seekne na požadované časy a přes canvas
    drawImage vyrobí PNG blob URLs. Async, robust: pokud video metadata
    selžou, throws. Cleanup videoUrl ve `finally`.
  - **ExportButton.tsx** — po `downloadBlob()` extrahuje 3 thumbnaily
    (0, duration/2, duration-0.5). Fail-safe try/catch — pokud extract
    selže, ukáže done state bez thumbů místo crashe.
  - **Done state UI** rozšířený o:
    * **Grid 3× thumbnail** (aspect-video, object-cover).
    * **„Otevřít video"** tlačítko — `window.open(blobUrl)` v nové záložce.
    * **„Sdílet"** tlačítko — Web Share API přes `navigator.share({ files: [file] })`.
      **Feature-detect** přes `navigator.share && navigator.canShare` — tlačítko
      se neukáže na Chrome desktop, ukáže se na Mac Safari + mobilu kde
      Web Share s files funguje.
  - **Cleanup**: `resetToIdle` revokuje thumbnail URLs i resultUrl;
    useEffect cleanup při unmountu komponenty.

- **Fáze 4.9** Tři nové Modern presety (Wave Field / Plasma / Tunnel):
  - **`src/lib/modernPresets.ts`** rozšířen o 3 plane-based fragment shadery
    (stejný pattern jako existující Kaleidoscope). Modern má teď celkem 6 presetů.
  - **Wave Field** — interferující sinusoidní vlny v X, Y a diagonálním směru.
    `high` band řídí frekvenci (víc vln při hi-hat), `low` amplitudu,
    `centroid` color shift cold→warm, beat magenta accent pulse.
  - **Plasma** — klasický plasma efekt: suma 4 sinusoid (X, Y, diagonal, radial).
    `mid` band moduluje rychlost color cyclingu, `low` baseline brightness,
    `high` pow(1.5) sparkle curve. RGB se cycluje přes 3 sin posuny po 120°.
  - **Tunnel** — radial UV transformace (1/r) vyrobí iluzi letu skrz tunel.
    `low` band řídí rychlost vrtání, prstence (sin(depth)) + spirálovité žebra
    (sin(angle + depth)) mixované 55:45. Color cool→warm podle `mid`, beat
    accent flash, `high` jiskry přes `fract(pattern × 23.7)` threshold.
  - **Backlog**: Terrain Mesh a Fractal Noise přesunuty do nových bodů 4.14
    a 4.15 v ROADMAPu — 3 dobré presety jsou víc než 5 průměrných.
  - Imports rozšířeny o `cos`, `vec3`, `fract`, `pow` z `three/tsl`.

- **Fáze 4.6** Keyboard shortcuts + help overlay:
  - `src/types/visualizerHandle.ts` — nový interface `VisualizerHandle`
    pro imperative API: `togglePlayPause`, `nextPreset`, `prevPreset`,
    `randomPreset`, optional `focusSearch` (jen Classic).
  - **`Visualizer.tsx` (Classic)** — refactored na `forwardRef` +
    `useImperativeHandle`. Implementuje všechny metody včetně `focusSearch`,
    který deleguje na PresetCombobox přes nový ref.
  - **`ThreeVisualizer.tsx` (Modern)** — také forwardRef. `focusSearch`
    je undefined (Modern používá nativní `<select>`, ne combobox).
  - **`PresetCombobox.tsx`** — forwardRef + `useImperativeHandle` exposes
    `focus()`, který fokusuje input a otevře dropdown.
  - **`App.tsx`** — globální `window keydown` handler s tabulkou shortcutů
    `SHORTCUTS`. Implementuje: Mezerník (play/pause), N/P (next/prev preset),
    R (random), F (fullscreen vizualizér container přes `requestFullscreen`),
    `/` (focus search, jen Classic), `?` (toggle help), Esc (zavřít help).
    Skipped když je focus v inputu/textarea/select — výjimka Esc vždy projde.
  - **Fullscreen container** — nový `visualizerContainerRef` div obalí
    vizualizér; F volá `requestFullscreen()` na něm.
  - **Help overlay** — modal s `<kbd>` značkami pro každou zkratku, otevírá
    se přes `?` klávesu nebo přes „?" tlačítko v top baru. Click mimo modal /
    Esc zavírá.

- **Fáze 4.4** Custom prompt per AI keyframe:
  - `AiHybrid.tsx` — `Keyframe` interface rozšířený o optional `customPrompt`.
    Při generování se použije `kf.customPrompt?.trim() || kf.prompt` (custom
    má přednost; prázdný/whitespace fallne zpět na defaultní).
  - **Edit button** v každém slotu (top-left), `pencil` ikona. Fialově
    obarvený když slot už má custom prompt (viditelný i bez hoveru, aby uživatel
    poznal, že je tam override). Bez customu je hidden until hover.
  - **„Custom" badge** v pravém dolním rohu slotu, když je custom prompt
    aktivní.
  - **Modal** s `<textarea rows={6}>`, předvyplněný defaultním promptem nebo
    existujícím customem. Save / Cancel / „Reset na defaultní" tlačítka.
    Click mimo modal zavírá bez uložení. Modal pokrývá viewport s `bg-black/80`.
  - Změna stylu (style dropdown) přepíše jen `prompt` (default), `customPrompt`
    se zachová — uživatelův ruční override je silnější než globální styl.

- **Fáze 4.7** Reset AI cache + indikátor:
  - `src/lib/aiCache.ts` — nový `getAiCacheStats()` vrací `{ entries, keyframes,
    totalBytes }`. Implementace přes `IDBObjectStore.openCursor()` (musí projít
    všechny entries, ale jen pro AI mode UI, takže OK).
  - `AiHybrid.tsx` — nová karta „AI cache" dole se statusem:
    * Prázdný cache → vysvětlující text „Cache je prázdná. Vygenerované
      keyframes se sem ukládají automaticky a při dalším otevření stejného
      souboru + stylu se načtou okamžitě."
    * Plný cache → „N záznam(y/ů) · M keyframes · X.X MB" (česká pluralizace
      pro 1 / 2-4 / 5+).
    * „Vyčistit cache" tlačítko (červené) — viditelné jen když máme entries.
      `window.confirm()` před smazáním. Po clearu refresh stats + reset
      `cacheStatus` na 'miss'.
  - Stats refresh přes `useEffect([cacheStatus])` — když přibyde / ubude
    cache entry (hit po batch generate, miss po clear), stats se přepočítají.

- **Fáze 4.5** Desktop wide layout + plná responzivita:
  - **`src/App.tsx` kompletně přepsaný** — z původního centrovaného `max-w-xl`
    column na wide grid layout. Žádné jiné komponenty se nedotkly.
  - **Struktura:**
    * **Top bar** (`<header>`) — full width, logo + DJ Enda title vlevo,
      privacy disclaimer pill vpravo. Na `< md` stack vertikálně, na `>= md`
      side-by-side přes `flex-col md:flex-row md:justify-between`.
    * **Main** (`<main>`) — `flex-1 max-w-[1600px] mx-auto` wrapper. Padding
      `px-4 md:px-8 lg:px-12` pro generous breathing room na desktopu.
    * **Layout grid:** na `< lg` stack vertikálně (`grid-cols-1`), na `>= lg`
      `grid-cols-[1fr_380px] gap-6 items-start`. Sidebar je sticky
      (`lg:sticky lg:top-6`) — při scrollu pod vizualizér zůstává viditelný.
    * **Footer** (`<footer>`) — full width, border-top, `max-w-[1600px]` content.
  - **Sidebar:**
    * Sloučená karta „Vybraný soubor" + audio data — kompaktnější, hierarchie
      přes border-top separator místo dvou karet.
    * Export controls (`<ExportButton>`) — kvalita, trim slidery, tlačítko.
    * AI mode má vlastní export uvnitř `AiHybrid`, sidebar pro AI tedy obsahuje
      jen soubor + audio data (export tlačítko se neukáže).
  - **Main column:**
    * Mode toggle (Classic / Modern / AI) nad vizualizérem — pill design zachován,
      na `>= lg` zarovnaný vlevo, na mobilu centrovaný.
    * Vizualizér (Classic / Modern / AI) zabere plnou main column width. Canvas
      má `aspect-video` v komponentě, takže se přirozeně roztáhne na vystavenou
      šířku (~720-900 px na typickém M4 displeji = velký film-quality preview).
  - **Bez audio:** centrovaný velký upload box `min-h-[60vh] flex items-center`,
    drží původní emocionální feel „pojď, hoď sem track".
  - **Verze v footeru** povýšena na 0.5.0 (major UI milestone).
  - `npx tsc --noEmit` exit 0.

- **Fáze 4.3** Audio trim/range pro export:
  - `src/lib/export.ts` — nový `ExportRange` typ + `trimAudioBuffer()` helper.
    Trim používá `copyToChannel(srcData.subarray(start, end))` přes dočasný
    `AudioContext.createBuffer`. Pokud rozsah pokrývá celou skladbu (tol < 1 ms
    na obou koncích), vrátí původní buffer beze změny — žádné zbytečné kopie.
  - **Tři export funkce** (`exportVideo`, `exportVideoModern`, `exportVideoAi`)
    přijímají volitelný `range?: ExportRange`. Při exportu se buffer trimne
    na začátku a dál pipeline pokračuje na zkráceném bufferu (totalFrames,
    features extract, Mediabunny audio source — všechno běží na trimmed bufferu).
  - **ExportButton.tsx** — nová „Oříznutí audia" karta nad export tlačítkem:
    * Dva range slidery (start a end) s krokem 1 sekunda, labely mm:ss.
    * Když start převýší end (přes safeguard MIN_TRIM_LENGTH_SECONDS = 1s),
      druhý slider se automaticky posune. Žádné neplatné rozsahy.
    * „Reset (celá skladba)" tlačítko viditelné jen když je rozsah trimnutý.
    * Pod slidery: „Exportovaná část: M:SS z M:SS" + odhad velikosti
      přepočítaný podle `effectiveDuration`.
    * Reset trim při změně `audioBuffer` (jiný soubor) přes useEffect.
    * Confirm dialog pro tracky > 10 min počítá s trimmed délkou, ne celou.
  - `npx tsc --noEmit` exit 0.

- **Fáze 4.2** Oblíbené presety (Classic + Modern):
  - `src/lib/favorites.ts` — `useFavorites(kind: 'classic' | 'modern')` hook
    s localStorage perzistencí. Storage key `dj-enda:favorites:{kind}`,
    JSON array of preset keys. Robustní vůči korupci (invalid JSON → cleanup).
    Sync mezi taby přes `storage` event. Vrací `{ favorites: Set, isFavorite,
    toggle, clear }`.
  - **PresetCombobox** rozšířený o `favorites` + `onToggleFavorite` props.
    Když query je prázdný a máme aspoň jeden favorite, zobrazí 2 sticky sekce:
    „Oblíbené" nahoře, „Všechny" dole. Při query > 0 ploché filtrované zobrazení.
    Hvězdička ikonka v každém row (žlutá = oblíbený, šedá hover = neoblíbený).
    `onMouseDown` na hvězdičce volá `stopPropagation`, aby klik nevybral řádek.
    Keyboard navigace funguje napříč sekcemi přes flat list pro indexy.
  - **Visualizer.tsx (Classic)** — `useFavorites('classic')`, props předány do
    PresetCombobox. Žádná změna v App.tsx interface.
  - **ThreeVisualizer.tsx (Modern)** — `useFavorites('modern')`, MODERN_PRESETS
    rozdělen na `favs` + `rest` přes useMemo. Select používá `<optgroup>`
    „Oblíbené" / „Ostatní". Samostatné kulaté hvězdička tlačítko vedle selectu
    pro toggle aktuálního presetu. Combobox je u 3 položek overkill, optgroup
    + standalone star button je čistší řešení.
  - `npx tsc --noEmit` exit 0.

- **Fáze 4.1** Vyhledávání v Classic preset dropdown:
  - `src/components/PresetCombobox.tsx` — nový reusable combobox (~150 řádků).
    Text input + floating dropdown s filtrovaným seznamem matched presetů.
  - **Filter logika:** case-insensitive word-match. Query se splitne na slova,
    každé musí být substring v názvu presetu. Prázdný query = všechny presety.
    Žádná externí knihovna (Fuse.js by byl overkill pro ~150 položek).
  - **Klávesy:** šipky nahoru/dolů navigace, Enter vybere highlighted, Esc zavře
    a vyčistí query. ArrowDown z prázdného stavu otevře dropdown.
  - **A11y:** `role="combobox"` + `role="listbox"` + `role="option"`,
    `aria-selected`, `aria-expanded`, `aria-autocomplete="list"`.
  - **UX detail:** click mimo komponentu zavře dropdown. Při focusu se ukáže
    celý seznam (query empty). Highlighted scrolluje do view (`scrollIntoView`).
    Použit `onMouseDown` (ne click) na list item, aby selectování fired před
    blur input. Selected preset má lehce fialový text, když není highlighted.
  - `Visualizer.tsx` — `<select>` nahrazený `<PresetCombobox>`, interface
    (`currentPreset` / `onPresetChange`) zůstává. App.tsx nemění.
  - `npx tsc --noEmit` exit 0.

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
- **Post-3.6 AI shader filmový upgrade** (varianta A pro AI hybrid):
  - **Ken Burns continuous zoom** — `clamp(audioTime × 0.005, 0, 0.2)` přidává
    plynulý zoom přes celou skladbu × audio RMS × beat punch zoom.
  - **Slow drift pan** — `sin/cos(audioTime × 0.13/0.11) × 0.04/0.03`.
  - **Per-keyframe parallax** — A a B mají pseudo-random pan offset
    (přes `sin(idx × 2.3 + 0.7)`), při crossfade vzniká pocit hloubky.
  - **Light leaks na beat** — radiální warm gradient `vec3(1.0, 0.7, 0.45)`
    z pohyblivého středu, intenzita modulovaná beat.
  - **Sparse procedural particles** — pseudo-noise dots (top 4 %), modulace RMS.
  - **Identicky aktualizováno v `exportVideoAi()`** v `lib/export.ts`.
  - Komentář v obou souborech upozorňuje: „Při změně shader logiky MUSÍ být
    identicky aktualizován i druhý soubor".
- **Fáze 3.4 + 3.5 + 3.6** Polish blok (overlay + cache + AI export):
  - **3.4 Overlay efekty** v `AiVisualizer.tsx` TSL shaderu:
    * **Vignette** — `smoothstep(0.35, 0.9, distFromCenter)` × vigStrength.
      Beat ji rozsvítí (vigStrength klesá s beat). Klidové ztmavnutí ke krajům.
    * **Film grain** — pseudo-noise `fract(sin(seed × 43758.5453)) × 0.06`.
      Drobný 3% efekt pro filmový pocit.
  - **3.5 IndexedDB cache** v `src/lib/aiCache.ts`:
    * `hashAudioBuffer()` — SHA-256 prvních 64 KB sample dat → 16hex.
    * `getCachedKeyframes(hash, styleId)` / `setCachedKeyframes(...)`.
    * `AiHybrid.tsx` při mountu / change audio nebo style spustí cache check.
      Při hit obnoví keyframes z blobů, status badge „Keyframes načteny z cache".
    * Po dokončení batch generate uloží 8 blobs do cache.
  - **3.6 AI export** v `exportVideoAi()`:
    * Stejná pipeline jako exportVideoModern (rychlejší-než-real-time).
    * Atlas canvas (cell 1280×720 na 1080p exportu) s 8 obrazy.
    * Identický TSL shader jako AiVisualizer (vignette, grain, crossfade).
    * `ExportButton` přijímá `mode='ai'` a `aiImageUrls`. AiHybrid ho zobrazí
      pod AiVisualizerem, jakmile máš ready keyframes.
- **Fáze 3.3** AiVisualizer — shader transitions mezi keyframes:
  - `src/components/AiVisualizer.tsx` — nový komponent (~400 řádků).
  - **Atlas approach:** všech 8 keyframes nakresleno na jediný 2560×720 canvas
    (4×2 grid, každá cell 640×360 = 16:9). `THREE.CanvasTexture` z atlasu.
  - **TSL crossfade shader v Fn() wrapperu:**
    * `keyframeIdx = audioTime × (N-1) / duration` jako float 0..7.
    * `idxA = floor`, `idxB = idxA+1`, `t = fract`.
    * Pro každý slot spočítá UV v atlasu (col/row math z modulo a div).
    * `mix(textureA, textureB, t)` = plynulý crossfade.
  - **Audio reactivity:**
    * RMS modeluje zoom-in efekt (basy nafouknou obrazu).
    * `audioTime` driveuje malý wobble (sin × sin).
    * Beat brightness boost (× 1.35 na peak).
  - **Standardní pipeline:** AudioContext + features pre-compute (Meyda),
    Start/Pause/Volume controls jako u ostatních vizualizérů.
  - `AiHybrid.tsx` zobrazuje `<AiVisualizer>` jakmile všech 8 keyframes ready.
    Pokud částečně, ukáže info card „N/8 hotovo".
- **Fáze 3.2** Skutečné generování AI obrazů přes HF:
  - `hfClient.ts` rozšířen o `generateImage(prompt, { modelId?, token?, signal? })`:
    * Default model **FLUX.1-schnell** (rychlý, dobrá kvalita).
    * `fetchWithRetry()` s exponential backoff pro 503 (model loading) a 429
      (rate limit). Max 3 pokusy.
    * Error handling pro 401 (invalid token), content-type check (HF občas
      vrátí 200 s JSON errorem).
  - `AiHybrid.tsx` rozšířen:
    * **Style dropdown** (Kosmický / Cyberpunk / Příroda / Abstraktní) —
      4 base prompty. Změna stylu přemapuje prompty pro všechny keyframes.
    * **Batch generation:** „Generovat 8 AI keyframes" tlačítko iteruje
      keyframes sekvenčně, ukazuje status per slot (generuji spinner,
      ready image, error). Progress counter „N / 8 hotovo".
    * **Cancel button** během generování (AbortController).
    * **Per-keyframe Regenerate** hover button v slotu — pro jednotlivý retry.
    * **Object URL cleanup** v useEffect (žádný memory leak při unmountu).
    * **Image v slotu** přes `<img src={blobUrl}>`.
- **Fáze 3.1** AI Hybrid mode + HF token UI + storyboard scaffold:
  - `src/lib/hfClient.ts` — utility pro HF token (localStorage storage,
    `getHfToken`, `setHfToken`, `clearHfToken`, `describeRateLimit`,
    `maskToken`). Token zůstává jen v prohlížeči.
  - `src/components/AiHybrid.tsx` — nová obrazovka:
    * **HF Token karta** — input pro hf_... token; bez tokenu ~100 req/den,
      s tokenem ~1000 req/den. Hezky maskovaný display (`hf_•••• 1234`).
    * **Storyboard karta** — grid 4×2 (8 keyframe slotů). Pro každý slot:
      thumb placeholder, časový interval (mm:ss–mm:ss), status badge.
    * **Generate tlačítko** disabled s textem „brzy (Fáze 3.2)".
  - `App.tsx` — třetí mode `'ai'` v `VisualizerMode`, toggle button přidán,
    conditional render `<AiHybrid>`. Export tlačítko zatím jen pro Classic/Modern.
- **Fáze 2.7 + 2.8** Disclaimer banner + UI polish (sloučené):
  - **Disclaimer banner** — pill-shaped, zelený, vždy viditelný pod headerem:
    „Všechno běží jen v tvém prohlížeči — audio, vizualizér, export. Žádný
    server, žádný upload." Lock ikona vlevo.
  - **Header logo** — inline SVG, fialový čtverec s „DJE" iniciálami + akcent
    tečka. Vedle title. Stejný visual jazyk jako PWA ikona.
  - **Gradient background** — tmavá k purple v dolní části (subtle).
  - **Card hover effect** — border ztmavne při hover (transition-colors).
  - **AudioUpload polish** — upload icon (download arrow), scale-up effekt
    při drag-over, smooth transition.
  - **Footer redesign** — verze + link na GitHub repo.
- **Fáze 2.6** Export kvality (rozlišení/FPS/bitrate):
  - `EXPORT_QUALITIES` array s 4 možnostmi (Rychlý, Standard, Filmový, Vysoká).
  - `exportVideo()` + `exportVideoModern()` přijímají `qualityId` parametr,
    který vrátí `width`, `height`, `fps`, `videoBitrate`. Audio bitrate konstantní.
  - `estimateOutputSize()` přijímá `qualityId`, počítá podle aktuální bitrate.
  - `ExportButton` má v idle stavu **dropdown výběru kvality** + odhad velikosti
    + rozlišení/FPS pod ním. Default = Standard (1080p60 12 Mbps).
- **Fáze 2.5** Modern export pipeline (rozděleno na a/b/c):
  - **2.5a** Refactor: nahradit TSL builtin `time` za vlastní `uniforms.audioTime`.
    V live preview se nastavuje na `audioCtx.currentTime - startTime` (playing)
    nebo `+= deltaTime` (idle). V exportu na `i / fps`. Bez tohoto by byl rychlejší-
    než-real-time export desynchronizovaný (vizuál by běžel rychleji než audio).
  - **2.5b** `exportVideoModern()` v `lib/export.ts`:
    * Pre-compute Meyda features (z 2.2/2.4).
    * `OffscreenCanvas(1920, 1080)` + samostatný `WebGPURenderer` + Scene + Camera.
    * `createUniforms()` + `preset.setup(scene, uniforms)`.
    * Mediabunny `Output` + `CanvasSource` (H.264 12 Mbps) + `AudioBufferSource` (AAC).
    * Render loop **bez čekání na real-time audio** — pro každý frame nastavíme
      uniforms z `features[i]`, voláme `preset.update()`, `await renderer.renderAsync()`,
      `await videoSource.add(...)`. Rychlost je čistě GPU-bound.
    * Očekávané zrychlení 2-5× oproti real-time (závisí na GPU + presetu).
  - **2.5c** `ExportButton` přijímá `mode: 'classic' | 'modern'` prop, volá
    příslušnou export funkci. Progress badge ukazuje fázi
    (Analyzuji audio / Renderuji / Finalizuji). Confirm dialog upravený
    odhad ETA podle módu.
  - **App.tsx** vždy zobrazuje ExportButton (s aktuálním módem) — placeholder
    "Export přijde ve 2.5" odstraněn.
  - **Odloženo na 2.5d:** přesun Classic exportu do Web Workeru
    (nevyžaduje urgenci; Classic je sync na real-time audio, takže Worker by
    sice neblokoval UI, ale celkový čas exportu by zůstal stejný).
- **Fáze 2.4** Audio uniforms — band separation:
  - `audioFeatures.ts` rozšířen o **3 frekvenční pásma** (bins do FFT 1024):
    * **Low** (0..8 bins, ~0-180 Hz) — kick, sub-bass
    * **Mid** (8..128 bins, ~180-2900 Hz) — snare, vokál, melody
    * **High** (128..512 bins, ~2900-11600 Hz) — hi-hat, brightness
  - Per-band RMS spočítaný a normalizovaný k max v tracku (každý band zvlášť).
  - `VisualizerUniforms` rozšířen o `low`, `mid`, `high`. `createUniforms`
    je vytváří, `ThreeVisualizer` je updatuje v render loopu.
  - **Tři presety přemapované** na band-specific reactivity:
    * **Sphere Distortion:** low → displacement amplitude + scale; mid → noise
      speed + rotation; high → color shift k oranžové + glow + brightness.
    * **Particle Flow:** low → radiální expanze + rotation rychlost; mid → swirl
      speed + brightness baseline; high → particle size + vertikální jitter.
    * **Kaleidoscope:** low → základní počet segmentů (4); high → jemné segmenty
      (až 14); mid → rychlost ring waves; high → jiskřivost.
- **Fáze 2.3c** Třetí preset — Kaleidoscope:
  - `THREE.PlaneGeometry(20, 12)` před kamerou — full-screen quad přes
    `screenUV` nezávisle na FOV.
  - `MeshBasicNodeMaterial` s pure fragment shaderem v `colorNode`.
  - **TSL kaleidoscope algoritmus:**
    * Center UV s aspect-ratio korekcí (16:9).
    * Polární souřadnice: `r = length(uv)`, `a = atan2(y, x)`.
    * Kaleidoscope fold: `abs(mod(a, π·2/N) - π/N)` → symetrický N-segmentový pattern.
    * N (počet segmentů) modulován `centroid`: 4..12.
    * Pattern: kombinace ring wave a arm wave (sin × sin).
    * 3-way color mix (cool / warm / accent) podle patternu + beat boost.
    * Soft vignette (radiální fade ke krajům).
- **Fáze 2.3b** Druhý preset — Particle Flow:
  - `THREE.Points` se 2000 částicemi (sferická distribuce, radius 0.6-1.8).
  - Per-particle `phase` Float32Array (0..2π) — každá částice má vlastní rytmus.
  - `PointsNodeMaterial` s `transparent: true` + `AdditiveBlending` (svíticí).
  - **TSL `colorNode`** — uniform color (stejná pro všechny částice) mix
    modrá/oranžová podle centroidu × brightness(rms, beat).
  - **JS-driven position update** v `update()`:
    * Per-particle swirl rotace kolem Y (rychlost podle phase × time).
    * Radiální expanze podle `1 + rms × 0.5 + beat × 0.4`.
    * Vertikální jitter `sin(phase + t) × 0.08 × rms`.
    * Point size dynamicky 6..22 px podle rms+beat.
    * Celý systém pomalu rotuje kolem Y (rychlost úměrná rms).
  - Důvod JS update místo TSL position: `SpriteNodeMaterial.positionNode` je
    typovaný jako `vec2` (sprite offset), ne `vec3` pro 3D pozici. JS update
    je pro 2000 částic × 60 FPS performance-trivial (~360k float writes/s).
- **Fáze 2.3a** TSL preset framework + první preset:
  - `src/lib/modernPresets.ts` — typy + registry:
    * `VisualizerUniforms { rms, beat, centroid }` (UniformNode ze `three/tsl`).
    * `ModernPreset.setup(scene, uniforms) → PresetInstance { dispose, update? }`.
    * `MODERN_PRESETS` array, `getPresetById`, `DEFAULT_PRESET_ID`.
  - **Sphere Distortion** preset:
    * `IcosahedronGeometry(1, 6)` + `MeshBasicNodeMaterial`.
    * TSL vertex node: `positionLocal + normalLocal × (base + rms × noise + beat)`.
      Noise = trojnásobné sin v různých frekvencích a fázích.
    * TSL color node: `mix(cool, warm, centroid) × brightness(rms, beat)`.
    * `update` callback dělá rotaci v JS (rms zvyšuje rychlost, beat scale spike).
  - `ThreeVisualizer.tsx` přepsán na preset systém:
    * `applyPreset()` dispose + setup při změně.
    * Render loop aktualizuje `uniforms.rms.value` atd. z Meyda features.
    * Idle režim plynule decay-uje uniformy k neutrálu (žádný snap zpět).
    * Preset dropdown v UI (zatím 1 položka).
  - `App.tsx` drží `modernPresetId` state, sdílí s ThreeVisualizerem.
- **Fáze 2.2** Meyda + offline audio features:
  - `npm install meyda` (v5.6.3) u uživatele.
  - `src/lib/audioFeatures.ts` — `extractFeatures(audioBuffer, fps, onProgress)`
    běží offline, vrací typovaný `AudioFeatures` s `Float32Array` per feature
    indexované per video frame:
    * `rms` (0..1) — amplitudou-jako-energii pro pulzování.
    * `spectralCentroid` (0..1, normalizovaný) — pro hue mapping.
    * `spectralFlux` (0..1, normalizovaný k max v tracku) — surová beat data.
    * `energy` (lineární) — alternativní metrika.
    * `beat` (0..1) — post-processed flux s adaptivním threshold (mean + 1.5×std
      rolling window ~0.5 s).
    * `fps`, `totalFrames` — metadata.
  - Yieldne `setTimeout(0)` každých 100 oken, neblokuje UI thread.
  - `ThreeVisualizer.tsx` — nový stav `analyzing` s progress overlay.
    Při startu nejdřív Meyda extract (~5-15 s pro 33min track), pak audio + render.
  - Render loop místo `analyserNode.getByteFrequencyData()` čte pre-computed
    `features[frameIdx]` podle `audioCtx.currentTime`. Beat event přidává
    krátký scale spike + brightness boost s exponential decay.
- **Fáze 2.1b** Audio reaktivita pro Modern vizualizér:
  - State machine `idle | playing | paused | ended` (stejný pattern jako Classic).
  - „Spustit náhled" tlačítko overlay (kvůli AudioContext autoplay policy).
  - Audio routing: `source → AnalyserNode (FFT 2048) → GainNode → destination`.
  - Render loop čte `getByteFrequencyData()` každý snímek:
    * RMS basů z dolních 32 binů (0..1) → `mesh.scale` + zvýšená rotation.
    * Spectral centroid (vážený průměr indexů) → `material.color.setHSL(hue, ...)`.
  - Play/Pause přes `audioCtx.suspend/resume`, hlasitost přes `gainNode`.
  - Render loop přepíná mezi idle a reaktivním režimem podle existence analyseru.
- **Fáze 2.1a** Three.js + WebGPURenderer setup hotov:
  - `npm install three` u uživatele (v r180+, oficiální TS typings included).
  - `src/components/ThreeVisualizer.tsx` — kostra s `WebGPURenderer` (import
    z `three/webgpu`), automatický fallback na WebGL2 přes `renderer.init()`.
    Rotující drátový icosahedron jako PoC. UI ukazuje, který backend se používá.
  - `src/App.tsx` — přidán toggle Classic / Modern (pill design), conditional
    render `<Visualizer>` nebo `<ThreeVisualizer>`. Export tlačítko viditelné
    jen v Classic módu (export Three.js scény přijde v 2.5).
  - Ověřeno: na Apple Silicon MacBook Air backend = **WebGPU** (ne fallback).
- **Fáze 1.10** Deploy hotov:
  - GitHub repo: <https://github.com/JendaNDT/dj-enda-pwa> (public).
  - Vercel produkce: <https://dj-enda-pwa.vercel.app>.
  - Auto-deploy: každý push do `main` triggeruje rebuild + redeploy.
  - Vercel auto-detected Vite, žádná custom konfigurace zatím není potřeba.
  - Ověřeno: WAV upload (44.8 MB) funguje, dekódování, Butterchurn vizualizér,
    controls — vše funguje na produkční URL.
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

- Nic. Fáze 1–6 hotové, vše na produkci.

## Co je další (backlog)

Žádný otevřený plánovaný bod. Volitelný backlog (detail v `ROADMAP.md`):

- **Per-preset parametry pro Modern** (TSL uniformy → posuvníky v UI) — nejlepší
  kandidát na další fázi. AI má parametry už ve stylu/promptu; Classic má ladění
  z Fáze 6.
- **showcase MP4** — Classic + Modern hotové (640x360 tiché loopy v
  `public/showcase/`); zbývá jen `ai.mp4` (AI karta zatím placeholder) — vyrábí
  Jenda exportem z appky.
- **2.5d** Classic export do Web Workeru — doporučeno vynechat (Butterchurn
  vyžaduje real-time AudioContext, ve workeru není; export to nezrychlí).

## Známé bugy / problémy

- **Cowork sandbox neumí psát do `.git`** (`index.lock` „Operation not permitted")
  → commit/push dělá Jenda lokálně. **Vite build v sandboxu nejde** (chybí
  linux-arm64 rolldown binding) → automatická brána je `npx tsc -b`, runtime
  testuje Jenda v prohlížeči.
- ESLint má pár **pre-existing** chyb/varování (`react-refresh/only-export-components`
  u `pickInitialPreset` ve Visualizer.tsx, nepoužitý eslint-disable). NENÍ v build
  pipeline (`build = tsc -b && vite build`), neblokuje deploy — jen nepřidávat nové.
- `npm install` musí běžet u uživatele na Macu (Darwin arm64), ne ve sandboxu
  (Linux) — jinak se v lockfile zafixuje špatná nativní binárka rolldownu.

## Klíčová rozhodnutí

- **Stack:** Mediabunny místo deprecated mp4-muxer; `@webamp/butterchurn` místo
  originálního jberg/butterchurn; Fáze 3 AI přes **HuggingFace FLUX** (ne Fal.ai).
- **Butterchurn (Classic) zůstává natrvalo** jako default; Modern (Three.js) je
  paralelní alternativa, ne náhrada. Export podporuje oba.
- **Žádný backend.** Vše v prohlížeči, AI přes BYO HF token.
- **Workflow:** vibe-coding; AGENTS.md = kontrakt, ROADMAP.md = úkoly,
  PROGRESS.md = tento snapshot. Před push vždy `tsc -b`.

## Struktura souborů (aktuální stav)

```
src/
├── main.tsx
├── App.tsx                     # layout, mode toggle (Classic/Modern/AI/Srovnání), shortcuts
├── index.css                   # @import "tailwindcss" + custom keyframes
├── components/
│   ├── AudioUpload.tsx         # drag-drop upload
│   ├── Visualizer.tsx          # Classic (Butterchurn) + ladicí parametry (Fáze 6)
│   ├── ThreeVisualizer.tsx     # Modern (Three.js WebGPU / TSL)
│   ├── AiHybrid.tsx            # AI mód — HF token, storyboard, generování
│   ├── AiVisualizer.tsx        # AI atlas + crossfade shader
│   ├── ComparisonView.tsx      # Srovnání Classic + Modern (sdílené audio)
│   ├── PresetCombobox.tsx      # Classic preset search + favorites + náhledy
│   ├── ExportButton.tsx        # export UI (kvalita, trim, credits, watermark)
│   ├── Hero.tsx                # pre-upload showcase
│   └── ToastContainer.tsx      # toast notifikace
├── lib/
│   ├── audio.ts                # decode + hook
│   ├── audioFeatures.ts        # Meyda offline features (RMS, pásma, beat)
│   ├── modernPresets.ts        # 8 TSL presetů + uniformy
│   ├── export.ts               # export pipeline (Classic/Modern/AI)
│   ├── exportCompositor.ts     # 2D overlay (credits, watermark)
│   ├── thumbnails.ts           # post-export thumbnaily
│   ├── presetThumbnails.ts     # Classic preset náhledy (IndexedDB dj-enda-thumbs)
│   ├── usePresetThumbnails.ts  # hook pro náhledy
│   ├── classicControls.ts      # Classic ladicí parametry (Fáze 6) + localStorage
│   ├── favorites.ts            # oblíbené presety (localStorage)
│   ├── hfClient.ts             # HuggingFace client + token
│   ├── aiCache.ts              # IndexedDB cache AI keyframes (dj-enda)
│   └── toast.ts                # toast subscribe systém
└── types/
    ├── butterchurn.d.ts        # ruční typy (+ setInternalMeshSize, setOutputAA)
    └── visualizerHandle.ts     # imperative API pro keyboard shortcuts
```

## Otázky a otevřené body

Vyřešeno: package `dj-enda-pwa`, deploy = Vercel subdoména, balíčkovač `npm`.
Žádné otevřené otázky — další na řadě je (až bude chuť) per-preset ladění Modern.
