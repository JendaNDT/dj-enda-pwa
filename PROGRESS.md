# PROGRESS.md — DJ Enda PWA

Snapshot stavu projektu pro hand-off mezi sessions. Aktualizovat po každém
dokončeném bodě z `ROADMAP.md`.

**Poslední aktualizace:** 2026-05-28
**Aktuální fáze:** Fáze 4 — Round 1 + Round 2 hotové
**Aktuální bod:** 4.1 + 4.2 + 4.3 + 4.5 hotové. Desktop wide layout refactor
App.tsx hotov, využívá plnou šířku monitoru se sidebarem (controls +
soubor + export), na mobilu stack.
**Příští krok:** **Round 3 — UX dotahy** (4.4 custom prompt per AI keyframe,
4.6 keyboard shortcuts, 4.7 reset AI cache). Před tím commit + push 4.5.
**Strategie:** Fal.ai → HuggingFace (free) + Three.js shader transitions místo
image-to-video API. Aplikace zůstává plně zdarma.
**Strategie:** **Permanentní coexistence.** Butterchurn (Classic) zůstává
natrvalo jako default — uživatel ho esteticky preferuje nad Three.js. Modern
(Three.js) je paralelní alternativa, kterou postupně dotahujeme. Žádné
„vyhození Butterchurnu" se nekoná. Export musí podporovat oba režimy.

---

## Co je hotové

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

- Nic. Čekáme na ověření 2.3a v Modern módu a souhlas s **2.3b** (Particle Flow).

## Co je další — Fáze 4 (plán pro nový Cowork chat)

**Fáze 4 = polish & UX vylepšení**, ne fundamentální nové features.
Detail viz `ROADMAP.md` sekce „Fáze 4".

**13 plánovaných bodů**, doporučené pořadí:

1. **Round 1 — Quick wins (doporučený start):**
   - 4.1 Vyhledávání v Classic preset dropdown
   - 4.2 Oblíbené presety (Classic + Modern, localStorage)
   - 4.3 Audio trim/range pro export

2. **Round 2 — Desktop layout refactor:**
   - 4.5 **Desktop wide layout + plná responzivita** (velký redesign,
     priorita podle uživatele — viz feedback memory `feedback-desktop-wide-layout.md`)

3. **Round 3 — UX dotahy:** 4.4, 4.6, 4.7
4. **Round 4 — Power features:** 4.8, 4.9, 4.10
5. **Round 5 — Nice to have:** 4.11, 4.12, 4.13

### Klíčový hint pro budoucí session

Uživatel explicitně rozhodl, že **prioritou je desktop wide layout**
(MacBook M4 primary device), ne mobilní. Aplikace má využít celou šířku
monitoru — žádný úzký centrovaný column `max-w-xl`. Plný responzivní
design s breakpointy. Viz memory file + AGENTS.md sekce „Design / Layout".

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
