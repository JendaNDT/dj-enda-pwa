# AGENTS.md — kontrakt projektu DJ Enda PWA

Tento soubor je první věc, kterou Claude (nebo jakýkoliv AI agent) čte na začátku
session. Obsahuje pravidla spolupráce, technický stack a seznam věcí, kterým se
vyhýbáme. Pokud něco v tomto souboru kolibří s aktuálním požadavkem uživatele,
zastav se a zeptej se.

---

## 1. Cíl projektu

PWA aplikace, která vezme audio stopu (typicky export ze Suno AI) a vygeneruje
hotový hudební videoklip připravený k nahrání na YouTube — **vše v prohlížeči,
bez serveru**. Pro MVP stačí algoritmické vizuály (Milkdrop-style); cílem je
později přidat vlastní Three.js + TSL shadery a volitelně AI keyframy přes Fal.ai.

Plný plán a stav viz `ROADMAP.md` a `PROGRESS.md`.

---

## 2. Spolupráce s uživatelem (vibe-coding režim)

Uživatel (Jenda) **neprogramuje**. Má skvělé nápady a důvěřuje Claude víc, než by
měl programátor. Z toho plyne větší zodpovědnost na straně Claude. Pravidla jsou
destilátem `SKILL.md` v rootu projektu (přečti si ho celý před první session).

### Hlavní pravidla

1. **Diskutuj před psaním.** Žádný kód, žádné editace, žádný `npm install` bez
   předchozího plánu v lidské řeči a explicitního souhlasu uživatele.
2. **Explicitní souhlas, ne implicitní.** „Zní to dobře" není souhlas. Souhlas je
   „piš" / „ok" / „pokračuj" / „jdi na to". Pokud reakce není jednoznačná, zeptej se.
3. **Krok po kroku, ne v dávce.** Velký úkol rozsekej na malé kroky. Po každém
   kroku ohlas, co se stalo, spusť testy/lint, počkej na další „piš".
4. **Žádné halucinace ohledně faktů.** GPS souřadnice, URL, verze knihoven, ceny —
   všechno ověřit přes web search nebo přiznat nejistotu. Vibe-coder nepozná
   rozdíl mezi `50.5098` a `50.5108`.
5. **Aktualizuj `PROGRESS.md` po každém dokončeném kroku.** Snapshot, kde session
   skončila, je jediný způsob, jak příští Claude (nebo ty zítra) zachytí kontext.
6. **Aktualizuj `ROADMAP.md`** — značky `✅ done` / `⏳ pending` / `➖ skipped`.
7. **Lessons-learned patří do AGENTS.md** (tento soubor, sekce 7). Když narazíš
   na něco neobvyklého, co by příští session zase trefilo, zapiš to.
8. **Bez emoji** v kódu, commit zprávách, UI textu ani v souborech (kromě status
   značek v ROADMAP.md). Emoji v UI vypadá v české aplikaci neprofesionálně.
9. **Jazyk:** český v konverzaci a UI stringech; anglický v kódu, komentářích
   a názvech souborů.

### Co je read-only bez schválení

Tyhle akce nepotřebují „piš":
- `Read` a `Grep` v projektu
- `WebSearch`, `WebFetch`
- `TaskCreate` / `TaskUpdate` pro tracking
- Otázky a vysvětlování

Tyhle **potřebují** „piš":
- `Write`, `Edit`, `Bash` cokoliv, co modifikuje filesystem
- `npm install`, `npm create`, jakákoliv změna `package.json`
- Cokoliv, co volá placenou API (Fal.ai, OpenRouter, atd.)
- Git operace (commit, push, branch)

---

## 3. Technologický stack (ověřeno květen 2026)

| Vrstva | Knihovna | Verze / poznámka |
|---|---|---|
| Build | Vite + React 19 + TypeScript + Tailwind | scaffold `npm create vite@latest` |
| PWA | `vite-plugin-pwa` | aktivní, React hook `virtual:pwa-register/react` |
| Audio dekódování | Web Audio API (`AudioContext`, `OfflineAudioContext`) | nativní |
| Audio features | `meyda` 5.6.3 | stabilní; beat detection si stavíme nad spectral flux |
| Vizuál MVP | `@webamp/butterchurn` 3.0.0-beta.5 | beta, ale použitelná, drop-in Milkdrop |
| Vizuál cíl | `three` r171+, `WebGPURenderer`, TSL | zero-config od r171 (září 2025) |
| Export médií | **`mediabunny`** | nástupce mp4-muxer od stejného autora |
| AI (volitelné) | `@fal-ai/serverless-client` | $20 free credits; Wan 2.5 ~$0.05/s |
| Deploy | Vercel nebo Netlify | vyžaduje COOP/COEP hlavičky pro SharedArrayBuffer |

### Důležitá rozhodnutí (a proč)

- **Mediabunny místo mp4-muxer.** Autor (Vanilagy) označil mp4-muxer za
  deprecated. Mediabunny ho plně nahrazuje, je tree-shakable a sponzorovaná
  Remotion. Pro vše nové platí Mediabunny.
- **@webamp/butterchurn zůstává natrvalo jako Classic mód.** Původní plán byl
  vyhodit ho po Fázi 2.4 ve prospěch vlastních Three.js shaderů. Po reálném
  testování 2.1b uživatel rozhodl, že Butterchurn (~150 Milkdrop presetů)
  esteticky převažuje a chce ho ponechat jako default. Fáze 2 tedy přidává
  **Modern mód (Three.js / WebGPU)** jako paralelní alternativu, ne náhradu.
  V UI je trvalý přepínač Classic / Modern; export pipeline bude ve 2.5
  rozšířen tak, aby exportoval oba režimy.
- **Export defaultně 1080p60 @ 12 Mbps H.264 + AAC.** Volba uživatele (Jenda
  preferuje 60 FPS pro hladší vizuální feel). YouTube doporučuje pro 1080p60
  minimálně 12 Mbps; vyšší bitrate by zbytečně zvětšil výstup. Live náhled
  zůstává 640×360 pro rychlost, export běží samostatným pipelinem v plné
  velikosti přes offscreen canvas. Volitelnost rozlišení (720p / 1080p30 /
  1440p) přijde ve Fázi 2.6.
- **TypeScript strict mode.** Vibe-coder nepozná `null` od `undefined` v runtime
  chybě; typový systém je naše první obranná linie.
- **Žádný backend.** Všechno běží v prohlížeči. Volitelná Fal.ai integrace ve
  Fázi 3 jde přímo z klienta s uživatelovým API klíčem (BYO-key).

---

## 4. Co NEDĚLAT (pinned anti-patterns)

- **Negenerovat diffusion video (Stable Diffusion / Veo / Sora) v prohlížeči.**
  V roce 2026 to není praktické — výkon, paměť, kvalita. Místo toho:
  algoritmické vizuály nebo AI keyframy přes externí API.
- **Nepoužívat `MediaRecorder` na finální export, když je dostupný `WebCodecs`.**
  MediaRecorder má jitter, vynechané snímky a běží real-time. Pro export jdi
  přes Mediabunny.
- **Nezakešovat velké modely (>10 MB) přes service worker precache.** Stáhni je
  on-demand a kešuj v IndexedDB nebo OPFS.
- **Nepředpokládat mobilní GPU paritu.** Testuj export jen na desktopu; na mobilu
  nabídni `preview` mód.
- **Nezapomenout `.close()` na `VideoFrame` a `AudioData`.** Bez toho prohlížeč
  spadne za pár sekund na vyčerpané GPU paměti.
- **Negenerovat masivní `ArrayBuffer` v paměti pro výsledné video.** Zapisuj
  průběžně přes File System Access API nebo OPFS.

---

## 5. Workflow per session

1. **Načti tyto tři soubory:** `AGENTS.md` (tento), `ROADMAP.md`, `PROGRESS.md`.
2. **Najdi aktuální bod** v `ROADMAP.md` — nejnižší `⏳ pending`.
3. **Navrhni plán** pro daný bod v lidské řeči (co, kde, riziko, velikost).
4. **Počkej na „piš"** od uživatele.
5. **Proveď krok**, pak spusť lint/typecheck/tests, pokud existují.
6. **Aktualizuj `PROGRESS.md`** snapshot.
7. **Označ bod v `ROADMAP.md`** jako `✅ done`.
8. **Zeptej se uživatele**, jestli pokračovat na další bod.

---

## 6. Test discipline

Po každé netriviální změně:

1. `npx tsc --noEmit` (typecheck)
2. `npm run lint` (jakmile bude nastavený)
3. `npm test` nebo `vitest run` (jakmile budou testy)
4. Ohlas výsledek: „X / Y prošlo, 0 selhalo" nebo „selhalo na Z, chyba: …".

Pokud test musí selhat kvůli změně, **ukaž diff testu a vysvětli proč** předtím,
než ho upravíš. Nikdy tiše neuprav test, aby procházel.

---

## 7. Lessons learned (přidávej průběžně)

Sem patří **neobvyklá** zjištění, na která narazíme během vývoje a která by
příští session zase trefila. Formát: krátký bullet point + datum.

- **2026-05-28** — `vite-plugin-pwa` má **defaultní workbox limit 2 MiB**
  pro service worker pre-cache. Náš main bundle (Three.js + Butterchurn +
  Mediabunny) přesahuje, build na Vercel pak hodí `PLUGIN_ERROR`.
  Fix: `VitePWA({ workbox: { maximumFileSizeToCacheInBytes: 5 * 1024 * 1024 } })`.
- **2026-05-28** — **Three.js r180+ NEMÁ bundled TS types** (žádné `types` pole
  v package.json). Pro TypeScript je nutno `npm i -D @types/three`.
  Pozor: `tsc --noEmit` chybu **nezachytí** (přes `moduleResolution: bundler`
  treats missing types jako `any`), ale `tsc -b` (build mode, který používá
  Vercel) ano. Vždy po přidání nové dependency ověřit i `tsc -b`, ne jen `tsc --noEmit`.
- **2026-05-28** — **Modern export benchmark (M-series Mac, 4min Suno track,
  Sphere Distortion preset, 1080p60 H.264 12 Mbps):**
  Tempo cca **230 snímků/s** = **~3.8× rychlejší než real-time**. Pre-computed
  Meyda features + `audioTime` uniform sync + WebGPURenderer + Mediabunny
  s WebCodecs jsou efektivní kombinace. Particle Flow a Kaleidoscope budou
  pravděpodobně mírně pomalejší (víc per-frame work), ale stále nad real-time.
- **2026-05-28** — `atan2` NENÍ runtime export z `three/tsl` (i když je v dokumentaci
  uvedený). Místo toho použít `atan(y, x)` — dvouargumentová varianta atan v TSL
  funguje jako atan2 (GLSL/WGSL konvence).
- **2026-05-28** — TSL `positionNode`/`colorNode`/`emissiveNode` MUSÍ být zabaleno
  v `Fn(() => { ... })()` wrapper. Bez něj Three.js builder TSL graf tiše ignoruje
  (žádný shader compile error v konzoli, jen default material behavior).
  Důkaz: `node_modules/three/examples/jsm/modifiers/CurveModifierGPU.js`.
  Vzor: `material.positionNode = Fn(() => { return positionLocal.add(...) })()`.
- **2026-05-28** — `npm install` nikdy nespouštět v sandboxu (Linux x64), když
  uživatel pracuje na Macu (Darwin arm64). Vite 8 + Rolldown vyžaduje
  platformně-specifickou nativní binárku (`@rolldown/binding-darwin-arm64`).
  Sandbox install ji nainstaluje pro Linux, `package-lock.json` to zafixuje
  a `npm run dev` na Macu pak hodí *„Cannot find native binding"*.
  Workaround: smazat `node_modules` + `package-lock.json` a uživatel udělá
  fresh `npm install` lokálně. **Pravidlo do budoucna:** scaffold a edity
  souborů ve sandboxu OK; všechny `npm install` / `npm run build` /
  `npm run dev` musí běžet u uživatele na Macu, ne ve sandboxu.

---

## 8. Reference

- `SKILL.md` — plný vibecoder workflow (delší verze této sekce 2).
- `PWA pro generování hudebních videoklipů.pdf` — odborný report o architektuře.
- `Claude.pdf` — opinionovaná verze stejné rekomendace s fázováním.
- Mediabunny: <https://mediabunny.dev/>
- Three.js WebGPU migrační průvodce: <https://www.utsubo.com/blog/webgpu-threejs-migration-guide>
- vite-plugin-pwa: <https://vite-pwa-org.netlify.app/>
- Fal.ai pricing: <https://fal.ai/pricing>
