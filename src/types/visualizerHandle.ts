/**
 * Imperative API, které vizualizér (Classic / Modern) vystavuje rodičovskému
 * App.tsx přes ref. App.tsx ho používá z globálního keyboard handleru
 * (Fáze 4.6 — keyboard shortcuts).
 *
 * Konkrétní implementace v Visualizer.tsx a ThreeVisualizer.tsx přes
 * `forwardRef` + `useImperativeHandle`. Když vizualizér nemá nějakou
 * schopnost (např. Modern nemá search), odpovídající metoda je `undefined`.
 */
export interface VisualizerHandle {
  /** Toggle play/pause aktuálního přehrávání. No-op když je vizualizér v idle. */
  togglePlayPause: () => void
  /** Přepnout na další preset (cyklus). */
  nextPreset: () => void
  /** Přepnout na předchozí preset. */
  prevPreset: () => void
  /** Náhodný preset z dostupných. */
  randomPreset: () => void
  /** Focus search input (jen Classic má combobox; Modern má select). */
  focusSearch?: () => void
}
