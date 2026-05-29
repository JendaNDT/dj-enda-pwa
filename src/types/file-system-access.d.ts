// Minimální typy pro File System Access API — `showSaveFilePicker` zatím není
// v TS lib.dom.d.ts. FileSystemFileHandle a FileSystemWritableFileStream tam
// už jsou (lib.dom), takže stačí doplnit jen tuhle jednu funkci na Window.
// Stejný pattern jako src/types/butterchurn.d.ts (ruční shim chybějícího API).

interface SaveFilePickerOptions {
  suggestedName?: string
  types?: Array<{ description?: string; accept: Record<string, string[]> }>
  excludeAcceptAllOption?: boolean
}

interface Window {
  /** Chromium-only (Chrome/Edge). Vrací handle pro zápis přímo na disk. */
  showSaveFilePicker?: (
    options?: SaveFilePickerOptions,
  ) => Promise<FileSystemFileHandle>
}
