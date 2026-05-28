import * as THREE from 'three'
import {
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
  PointsNodeMaterial,
} from 'three/webgpu'
import {
  Fn,
  uniform,
  positionLocal,
  normalLocal,
  mix,
  sin,
  cos,
  color,
  screenUV,
  vec2,
  vec3,
  length,
  atan,
  mod,
  abs,
  oneMinus,
  clamp,
  float,
  fract,
  pow,
  PI2,
} from 'three/tsl'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type UniformNode = any

export interface VisualizerUniforms {
  rms: UniformNode
  beat: UniformNode
  centroid: UniformNode
  /** Dolní pásmo (kick / sub-bass) 0..1, normalizováno k max v tracku. */
  low: UniformNode
  /** Střední pásmo (snare / vokál / melody) 0..1. */
  mid: UniformNode
  /** Vysoké pásmo (hi-hat / brightness) 0..1. */
  high: UniformNode
  /**
   * Synchronizovaný „audio čas" v sekundách. V live preview = audioCtx.currentTime
   * od startu; v exportu = i/fps. Použít místo TSL builtin `time`, aby vizuál
   * v exportu nebyl desynchronizovaný (rychlejší-než-real-time render by jinak
   * vyrobil rychlejší pattern).
   */
  audioTime: UniformNode
}

export interface PresetInstance {
  dispose: () => void
  update?: (uniforms: VisualizerUniforms, deltaTime: number) => void
}

export interface ModernPreset {
  id: string
  name: string
  description: string
  setup(scene: THREE.Scene, uniforms: VisualizerUniforms): PresetInstance
}

export function createUniforms(): VisualizerUniforms {
  return {
    rms: uniform(0),
    beat: uniform(0),
    centroid: uniform(0),
    low: uniform(0),
    mid: uniform(0),
    high: uniform(0),
    audioTime: uniform(0),
  }
}

// ─── Preset: Sphere Distortion ───────────────────────────────────────────────

export const sphereDistortion: ModernPreset = {
  id: 'sphere-distortion',
  name: 'Sphere Distortion',
  description: 'Pulzující ikosahedrální sféra s noise-deformací',
  setup(scene, uniforms) {
    const geometry = new THREE.IcosahedronGeometry(1, 6)

    const material = new MeshStandardNodeMaterial({
      side: THREE.DoubleSide,
      roughness: 0.5,
      metalness: 0.3,
    })

    // Vertex displacement — TSL musí být zabalený v Fn() funkci.
    material.positionNode = Fn(() => {
      const np = positionLocal.mul(2.5)
      // Mid band moduluje rychlost noise oscilace (více "akce" v melody).
      const speedBoost = uniforms.mid.mul(0.6).add(1.0)
      const t = uniforms.audioTime
      const wave1 = sin(np.x.add(t.mul(0.7).mul(speedBoost)))
      const wave2 = sin(np.y.add(t.mul(0.5).mul(speedBoost)))
      const wave3 = sin(np.z.add(t.mul(0.3).mul(speedBoost)))
      const rawNoise = wave1.mul(wave2).mul(wave3)
      const noise01 = rawNoise.mul(0.5).add(0.5)

      // Low band (basy) řídí hlavní displacement intensitu.
      const baseDisp = noise01.mul(0.12)
      const lowDisp = noise01.mul(uniforms.low).mul(0.9)
      const beatDisp = uniforms.beat.mul(0.4)
      const totalDisp = baseDisp.add(lowDisp).add(beatDisp)

      return positionLocal.add(normalLocal.mul(totalDisp))
    })()

    material.colorNode = Fn(() => {
      const cool = color(0.3, 0.15, 0.95)
      const warm = color(1.0, 0.45, 0.1)
      // High band přidává do hue (zesvětluje směrem k oranžové na vysokých tónech).
      const blendT = uniforms.centroid.mul(0.6).add(uniforms.high.mul(0.4))
      const baseColor = mix(cool, warm, blendT)
      // Brightness: rms baseline + beat pulse + high band glow.
      const brightness = uniforms.rms
        .mul(0.4)
        .add(uniforms.beat.mul(0.5))
        .add(uniforms.high.mul(0.3))
        .add(0.45)
      return baseColor.mul(brightness)
    })()

    material.emissiveNode = Fn(() => {
      const baseColor = mix(
        color(0.3, 0.15, 0.95),
        color(1.0, 0.45, 0.1),
        uniforms.centroid,
      )
      // Emissive boost na beat + sustained glow z high band.
      const glow = uniforms.beat.mul(0.9).add(uniforms.high.mul(0.4))
      return baseColor.mul(glow)
    })()

    const mesh = new THREE.Mesh(geometry, material)
    scene.add(mesh)

    const ambient = new THREE.AmbientLight(0xffffff, 0.4)
    const directional = new THREE.DirectionalLight(0xffffff, 0.7)
    directional.position.set(2, 2, 2)
    scene.add(ambient)
    scene.add(directional)

    return {
      dispose: () => {
        scene.remove(mesh)
        scene.remove(ambient)
        scene.remove(directional)
        geometry.dispose()
        material.dispose()
      },
      update: (u) => {
        // Rotation: mid řídí rychlost (snare/melody akce).
        mesh.rotation.x += 0.003 + u.mid.value * 0.03
        mesh.rotation.y += 0.005 + u.mid.value * 0.03
        // Scale: low (basy) nafukuje sphere, beat dělá spike.
        const scale = 1 + u.low.value * 0.15 + u.beat.value * 0.15
        mesh.scale.setScalar(scale)
      },
    }
  },
}

// ─── Preset: Particle Flow ───────────────────────────────────────────────────

const PARTICLE_COUNT = 2000

interface ParticleData {
  basePositions: Float32Array
  phases: Float32Array
}

function generateParticles(): ParticleData {
  const positions = new Float32Array(PARTICLE_COUNT * 3)
  const phases = new Float32Array(PARTICLE_COUNT)

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    // Sferická distribuce, radius 0.6..1.8
    const radius = 0.6 + Math.random() * 1.2
    const theta = Math.random() * Math.PI * 2
    const phi = Math.acos(Math.random() * 2 - 1)

    positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta)
    positions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta)
    positions[i * 3 + 2] = radius * Math.cos(phi)

    phases[i] = Math.random() * Math.PI * 2
  }

  return { basePositions: positions, phases }
}

export const particleFlow: ModernPreset = {
  id: 'particle-flow',
  name: 'Particle Flow',
  description: 'Pulzující oblak částic kolem centra',
  setup(scene, uniforms) {
    const { basePositions, phases } = generateParticles()

    const geometry = new THREE.BufferGeometry()
    // Pozice se updatují každý snímek v JS (mutable Float32Array).
    const positions = new Float32Array(basePositions)
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(positions, 3),
    )

    const material = new PointsNodeMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    })
    material.size = 8 // base pixel size, modulujeme v update

    // Color je uniform (stejná pro všechny částice). Mix dvou barev podle
    // centroidu, jas modulován rms + beat.
    material.colorNode = Fn(() => {
      const cool = color(0.4, 0.2, 1.0) // sytá modrá
      const warm = color(1.0, 0.55, 0.15) // teplá oranžová
      // Centroid + high posouvají k teplé barvě (vysoké tóny = jas).
      const blendT = uniforms.centroid.mul(0.6).add(uniforms.high.mul(0.4))
      const baseColor = mix(cool, warm, blendT)
      // Brightness: mid (melody) drží baseline, beat dává pulse, high glow.
      const brightness = uniforms.mid
        .mul(0.4)
        .add(uniforms.beat.mul(0.6))
        .add(uniforms.high.mul(0.3))
        .add(0.5)
      return baseColor.mul(brightness)
    })()

    const points = new THREE.Points(geometry, material)
    scene.add(points)

    return {
      dispose: () => {
        scene.remove(points)
        geometry.dispose()
        material.dispose()
      },
      update: (u) => {
        // Použijeme audioTime místo performance.now() — pro export sync s audio.
        const t = u.audioTime.value
        const low = u.low.value
        const mid = u.mid.value
        const high = u.high.value
        const beat = u.beat.value

        // Low řídí radiální expanzi (basy nafukují oblak).
        const radialBoost = 1 + low * 0.6 + beat * 0.4
        // Mid řídí rychlost swirlu (melody = víc otáčení).
        const swirlSpeed = 0.4 + mid * 0.6

        for (let i = 0; i < PARTICLE_COUNT; i++) {
          const i3 = i * 3
          const baseX = basePositions[i3]
          const baseY = basePositions[i3 + 1]
          const baseZ = basePositions[i3 + 2]
          const phase = phases[i]

          const swirl = phase * 0.3 + t * swirlSpeed
          const cosS = Math.cos(swirl)
          const sinS = Math.sin(swirl)

          positions[i3] = (baseX * cosS - baseZ * sinS) * radialBoost
          // Vertikální jitter modulovaný high bandem (hi-hat dělá vertikální chaos).
          positions[i3 + 1] =
            baseY * radialBoost + Math.sin(phase + t * 1.7) * 0.1 * high
          positions[i3 + 2] = (baseX * sinS + baseZ * cosS) * radialBoost
        }

        geometry.attributes.position.needsUpdate = true

        // High band řídí velikost částic (hi-hat = jiskřivost).
        material.size = 4 + high * 14 + beat * 6

        // Pomalá globální rotace, rychlejší při basech.
        points.rotation.y += 0.002 + low * 0.01
      },
    }
  },
}

// ─── Preset: Kaleidoscope ────────────────────────────────────────────────────

export const kaleidoscope: ModernPreset = {
  id: 'kaleidoscope',
  name: 'Kaleidoscope',
  description: 'Psychedelický symetrický pattern přes celou plochu',
  setup(scene, uniforms) {
    // Plane dost velká, aby přes screenUV vyplnila celý viewport bez ohledu
    // na perspective camera FOV/distance.
    const geometry = new THREE.PlaneGeometry(20, 12)

    const material = new MeshBasicNodeMaterial({
      side: THREE.DoubleSide,
      transparent: false,
    })

    material.colorNode = Fn(() => {
      // Centered UV [-1..1] s zachováním aspect ratia (canvas je 16:9).
      const u = screenUV.sub(vec2(0.5, 0.5)).mul(2.0)
      const aspectU = vec2(u.x.mul(1.778), u.y) // 1.778 ≈ 16/9

      // Polární souřadnice
      const r = length(aspectU)
      // V TSL je `atan(y, x)` ekvivalent atan2 (dvouargumentová varianta).
      const a = atan(aspectU.y, aspectU.x) // -π..π

      // Kaleidoscope fold: počet segmentů řízen LOW bandem.
      // Nízké tóny = málo velkých segmentů (4), vysoké basy nemění; brightness
      // (high band) přidává více detailů. Tj. low řídí "základ", high jemnost.
      const segCount = uniforms.low.mul(4.0).add(uniforms.high.mul(6.0)).add(4.0)
      const segWidth = float(PI2).div(segCount)
      const segAngle = mod(a, segWidth)
      const folded = abs(segAngle.sub(segWidth.mul(0.5)))

      // Mid band (snare/melody) moduluje rychlost ring waves.
      const ringSpeed = uniforms.mid.mul(2.0).add(1.5)
      const t = uniforms.audioTime
      const ringWave = sin(r.mul(8.0).sub(t.mul(ringSpeed)))
      const armWave = sin(folded.mul(10.0).add(t.mul(0.8)))
      const pattern = ringWave.mul(armWave).mul(0.5).add(0.5)

      // Color: 3-way mix mezi cool, mid a warm
      const cool = color(0.4, 0.1, 0.95)
      const warm = color(1.0, 0.55, 0.15)
      const accent = color(1.0, 0.2, 0.55)
      const baseMix = mix(cool, warm, pattern)
      const withBeat = mix(baseMix, accent, uniforms.beat)

      // Brightness: low drží baseline, beat pulse, high jiskří.
      const brightness = uniforms.low
        .mul(0.3)
        .add(uniforms.beat.mul(0.6))
        .add(uniforms.high.mul(0.4))
        .add(0.5)
      const vignette = oneMinus(clamp(r.mul(0.45), 0.0, 1.0))

      return withBeat.mul(brightness).mul(vignette.add(0.4))
    })()

    const plane = new THREE.Mesh(geometry, material)
    // Lehce vzdálená od kamery (kamera je at z=3, plane at z=0).
    plane.position.z = 0
    scene.add(plane)

    return {
      dispose: () => {
        scene.remove(plane)
        geometry.dispose()
        material.dispose()
      },
      // No JS-side update — všechno běží v shaderu (time uniformu spravuje TSL).
    }
  },
}

// ─── Preset: Wave Field ──────────────────────────────────────────────────────

/**
 * 2D vlnové pole — interferující sinusoidní vlny v X a Y. Frekvence řízená
 * `high` bandem (hi-hat / brightness), amplituda `low` (bass), barevný shift
 * podle `centroid`, beat blesk.
 */
export const waveField: ModernPreset = {
  id: 'wave-field',
  name: 'Wave Field',
  description: 'Interferující vlnové pole, high pásmo zvyšuje frekvenci',
  setup(scene, uniforms) {
    const geometry = new THREE.PlaneGeometry(20, 12)
    const material = new MeshBasicNodeMaterial({
      side: THREE.DoubleSide,
      transparent: false,
    })

    material.colorNode = Fn(() => {
      // Centered UV s aspect korekcí (16:9).
      const u = screenUV.sub(vec2(0.5, 0.5)).mul(2.0)
      const aspectU = vec2(u.x.mul(1.778), u.y)

      const t = uniforms.audioTime
      // Frekvence — base + high band; high tóny přidávají hustší vlny.
      const freq = uniforms.high.mul(8.0).add(4.0)
      // Amplituda v barvě podle low.
      const amp = uniforms.low.mul(0.6).add(0.4)

      // Dvě sinusoidy v X a Y + diagonální komponenta pro interference.
      const waveX = sin(aspectU.x.mul(freq).add(t.mul(1.5)))
      const waveY = sin(aspectU.y.mul(freq).add(t.mul(1.1)))
      const waveD = sin(aspectU.x.add(aspectU.y).mul(freq).mul(0.7).sub(t.mul(0.9)))

      // Pattern: kombinace 3 vln (interference). Normalizováno na 0..1.
      const pattern = waveX.add(waveY).add(waveD).mul(0.166).add(0.5).mul(amp)

      // Color: centroid posouvá hue od cold (modré) k warm (žluté).
      const cold = color(0.1, 0.4, 1.0)
      const warm = color(1.0, 0.85, 0.2)
      const accent = color(1.0, 0.25, 0.6)
      const baseMix = mix(cold, warm, uniforms.centroid)
      // Beat přidává magenta pulse.
      const withBeat = mix(baseMix, accent, uniforms.beat.mul(0.7))

      // Brightness modulace: pattern × intenzita.
      const brightness = pattern.mul(1.2).add(uniforms.beat.mul(0.4))
      // Vignette pro filmový pocit.
      const r = length(aspectU)
      const vignette = oneMinus(clamp(r.mul(0.5), 0.0, 1.0))

      return withBeat.mul(brightness).mul(vignette.add(0.3))
    })()

    const plane = new THREE.Mesh(geometry, material)
    scene.add(plane)

    return {
      dispose: () => {
        scene.remove(plane)
        geometry.dispose()
        material.dispose()
      },
    }
  },
}

// ─── Preset: Plasma ──────────────────────────────────────────────────────────

/**
 * Klasický plasma efekt — suma několika sinusoid v různých směrech a fázích.
 * Mid band moduluje rychlost color cycling, low band intenzitu, high jiskřivost.
 */
export const plasma: ModernPreset = {
  id: 'plasma',
  name: 'Plasma',
  description: 'Klasický plasma efekt s audio-driven color cycling',
  setup(scene, uniforms) {
    const geometry = new THREE.PlaneGeometry(20, 12)
    const material = new MeshBasicNodeMaterial({
      side: THREE.DoubleSide,
      transparent: false,
    })

    material.colorNode = Fn(() => {
      // Plasma se počítá v "world-like" pixelové souřadnici (ne centered),
      // aby vznikl charakteristický vlnový pattern přes celou plochu.
      const u = screenUV.mul(8.0) // scale ~ 8 cycles přes obrazovku
      const t = uniforms.audioTime

      // Mid band moduluje rychlost color cycling (1..3).
      const speed = uniforms.mid.mul(2.0).add(1.0)
      const tt = t.mul(speed)

      // Suma 4 sinusoid s různými frekvencemi a směry — tradiční plasma vzorec.
      const v1 = sin(u.x.add(tt))
      const v2 = sin(u.y.add(tt.mul(0.8)))
      const v3 = sin(u.x.add(u.y).mul(0.5).add(tt.mul(0.6)))
      const cx = u.x.mul(0.5).add(sin(tt.mul(0.3)).mul(2.0))
      const cy = u.y.mul(0.5).add(cos(tt.mul(0.4)).mul(2.0))
      const v4 = sin(length(vec2(cx, cy)).add(tt))

      const plasma = v1.add(v2).add(v3).add(v4).mul(0.25)

      // Mapování plasma → RGB přes sin posuny — vyrobí vibrant cycling.
      const r = sin(plasma.mul(PI2)).mul(0.5).add(0.5)
      const g = sin(plasma.mul(PI2).add(2.094)).mul(0.5).add(0.5) // +120°
      const b = sin(plasma.mul(PI2).add(4.188)).mul(0.5).add(0.5) // +240°
      const rgb = vec3(r, g, b)

      // Low band zvedá baseline brightness (intenzita).
      const brightness = uniforms.low.mul(0.4).add(uniforms.beat.mul(0.35)).add(0.7)
      // High band přidává jiskřivost (pow curve)
      const sparkle = pow(uniforms.high.add(0.5), float(1.5))

      return rgb.mul(brightness).mul(sparkle)
    })()

    const plane = new THREE.Mesh(geometry, material)
    scene.add(plane)

    return {
      dispose: () => {
        scene.remove(plane)
        geometry.dispose()
        material.dispose()
      },
    }
  },
}

// ─── Preset: Tunnel ──────────────────────────────────────────────────────────

/**
 * Tunnel efekt — radial UV transformace (1/r) vyrobí iluzi letu skrz nekonečný
 * tunel. Low band moduluje rychlost vrtání (audioTime offset), beat brightness
 * pulse, mid band tunelové stěny color shift, high jiskry.
 */
export const tunnel: ModernPreset = {
  id: 'tunnel',
  name: 'Tunnel',
  description: 'Iluze letu skrz nekonečný tunel, low band řídí rychlost',
  setup(scene, uniforms) {
    const geometry = new THREE.PlaneGeometry(20, 12)
    const material = new MeshBasicNodeMaterial({
      side: THREE.DoubleSide,
      transparent: false,
    })

    material.colorNode = Fn(() => {
      // Centered UV s aspect korekcí.
      const u = screenUV.sub(vec2(0.5, 0.5)).mul(2.0)
      const aspectU = vec2(u.x.mul(1.778), u.y)

      // Polární souřadnice.
      const r = length(aspectU).add(0.001) // ochrana proti div by zero
      const a = atan(aspectU.y, aspectU.x)

      // Klasická tunnel transformace: nahradíme radius za 1/r → vzdálenost.
      // depth = jak hluboko jsme v tunelu. Low band moduluje rychlost.
      const speed = uniforms.low.mul(2.5).add(1.0)
      const depth = float(1.0).div(r).add(uniforms.audioTime.mul(speed))

      // Tunelové prstence: pattern v depth (sin → ring).
      const rings = sin(depth.mul(6.0)).mul(0.5).add(0.5)
      // Spirálovité žebra: kombinace angle + depth.
      const ribs = sin(a.mul(8.0).add(depth.mul(0.5))).mul(0.5).add(0.5)
      // Pattern = mix ringů a žeber.
      const pattern = mix(rings, ribs, float(0.45))

      // Color: tunelové stěny mid band moduluje hue.
      const cool = color(0.1, 0.7, 1.0)
      const warm = color(1.0, 0.35, 0.05)
      const accent = color(1.0, 0.95, 0.4)
      const baseMix = mix(cool, warm, uniforms.mid)
      const withBeat = mix(baseMix, accent, uniforms.beat.mul(0.6))

      // Brightness: pattern × beat pulse × radius-based fade (střed je tmavší).
      const centerFade = clamp(r.mul(0.5), 0.0, 1.0)
      const beatBoost = uniforms.beat.mul(0.5).add(1.0)
      // High band přidává jiskry — fract(pattern × 23.7) > 0.97.
      const sparkle = clamp(
        fract(pattern.mul(23.7).add(uniforms.audioTime.mul(2.0))).sub(0.97).mul(33.0),
        0.0,
        1.0,
      ).mul(uniforms.high)

      const litColor = withBeat
        .mul(pattern.mul(0.9).add(0.2))
        .mul(beatBoost)
        .mul(centerFade)
      return litColor.add(vec3(sparkle, sparkle, sparkle))
    })()

    const plane = new THREE.Mesh(geometry, material)
    scene.add(plane)

    return {
      dispose: () => {
        scene.remove(plane)
        geometry.dispose()
        material.dispose()
      },
    }
  },
}

// ─── Registry všech presetů ──────────────────────────────────────────────────

export const MODERN_PRESETS: ModernPreset[] = [
  sphereDistortion,
  particleFlow,
  kaleidoscope,
  waveField,
  plasma,
  tunnel,
]

export function getPresetById(id: string): ModernPreset | undefined {
  return MODERN_PRESETS.find((p) => p.id === id)
}

export const DEFAULT_PRESET_ID = MODERN_PRESETS[0].id
