// Ruční deklarace typů pro @webamp/butterchurn a butterchurn-presets.
// Tyto balíčky nemají oficiální TypeScript definice.

declare module '@webamp/butterchurn' {
  export interface VisualizerOptions {
    width: number
    height: number
    pixelRatio?: number
    textureRatio?: number
    meshWidth?: number
    meshHeight?: number
  }

  export interface Visualizer {
    connectAudio(node: AudioNode): void
    disconnectAudio(node: AudioNode): void
    loadPreset(preset: unknown, blendTime?: number): void
    setRendererSize(width: number, height: number): void
    render(): void
  }

  interface ButterchurnAPI {
    createVisualizer(
      context: AudioContext,
      canvas: HTMLCanvasElement,
      options: VisualizerOptions,
    ): Visualizer
  }

  const butterchurn: ButterchurnAPI
  export default butterchurn
}

declare module 'butterchurn-presets' {
  interface PresetsAPI {
    getPresets(): Record<string, unknown>
  }
  const butterchurnPresets: PresetsAPI
  export default butterchurnPresets
}
