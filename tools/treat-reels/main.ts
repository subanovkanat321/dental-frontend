/**
 * Рендерер рилсов «Как лечат»: крупный план одного моляра в десне, лечение по шагам. Собирается отдельно
 * от приложения (vite.config.ts рядом → out/scene.js, формат IIFE) и подключается страницей сборки рилса
 * (бэкенд `e2e/promo/reels/treat.mjs`). Страница вызывает:
 *
 *   await TreatReels.init(canvas, scenario)   — построить сетки и сцену (один раз);
 *   TreatReels.render(t)                       — поставить сцену на момент t (секунды) и нарисовать кадр.
 *
 * Сценарий — данные: дорожки ключевых кадров (камера, стадии лечения, инструменты). Рендер детерминирован:
 * один и тот же t — один и тот же кадр (без Date.now и Math.random), поэтому покадровый рендер в
 * headless Chromium даёт ровное видео при любой скорости машины.
 */
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

import type { MeshData } from '../../src/atlas/geometry/mesher'
import { applySurface } from '../../src/atlas/engine/surface'
import { buildTreatMeshes, CAVITY_TOP } from './geometry'
import { createTools, haloTexture, type ToolName } from './instruments'

/** Ключ дорожки: [время, значение] или [время, значение, 'l' — линейно | 's' — скачком]. */
export type Key = [number, number] | [number, number, 'l' | 's']

export interface Scenario {
  width?: number
  height?: number
  /** Дорожки: cam* — камера; prep, etch, rinse, bond, fill, cure, polish, healed, compare — стадии; инструменты — по имени. */
  tracks: Record<string, Key[]>
  /** Момент «до» для сравнения до/после (стадии берутся из этого времени). */
  beforeAt?: number
}

/** Значения по умолчанию, если дорожки нет. */
const DEFAULTS: Record<string, number> = {
  camAz: 0, camEl: 48, camDist: 4.2, camFov: 26, camTx: CAVITY_TOP[0], camTy: CAVITY_TOP[1], camTz: CAVITY_TOP[2], camRoll: 0,
  prep: 0, etch: 0, rinse: 0, bond: 0, fill: 0, cure: 0, polish: 0, healed: 0, compare: 0, water: 0, spray: 0, wet: 0,
}

const smooth = (x: number) => x * x * (3 - 2 * x)

function evalTrack(keys: Key[] | undefined, t: number, def: number): number {
  if (!keys || !keys.length) return def
  if (t <= keys[0]![0]) return keys[0]![1]
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1, mode] = keys[i]!
    if (t < t1) {
      const [t0, v0] = keys[i - 1]!
      const u = (t - t0) / (t1 - t0)
      if (mode === 's') return v0
      return v0 + (v1 - v0) * (mode === 'l' ? u : smooth(u))
    }
  }
  return keys[keys.length - 1]![1]
}

/** Детерминированный «случай» по номеру: брызги и капли одинаковы в каждой сборке. */
function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return s - Math.floor(s)
}

/**
 * Где работает инструмент (кончик, от центра полости), куда уходит его ось (dir) и куда изогнута ручка (side).
 * Оси наклонены к языку (−z): с камеры спереди-сверху инструмент «растёт» вверх по кадру и не закрывает зуб.
 */
const TOOL_POSE: Record<ToolName, { at: [number, number, number]; dir: [number, number, number]; side: [number, number, number] }> = {
  bur: { at: [0, -0.04, 0], dir: [0.08, 0.82, -0.56], side: [-1, 0.1, 0] },
  syringe: { at: [0.02, 0.04, 0.02], dir: [0.3, 0.75, -0.6], side: [1, 0.3, 0] },
  air: { at: [-0.25, 0.6, -0.3], dir: [-0.35, 0.7, -0.6], side: [-1, 0.4, 0] },
  brush: { at: [0, -0.03, 0], dir: [0.35, 0.7, -0.6], side: [1, 0.4, 0] },
  lamp: { at: [0, 0.75, -0.45], dir: [0, 0.6, -0.8], side: [0, 1, 0] },
  plug: { at: [0, 0.02, 0], dir: [0.35, 0.72, -0.6], side: [1, 0.4, 0] },
  cup: { at: [0, 0.13, 0.02], dir: [0.12, 0.66, -0.74], side: [-1, 0.15, 0] },
}
const TOOLS = Object.keys(TOOL_POSE) as ToolName[]

function toGeometry(m: MeshData): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3))
  g.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3))
  if (m.colors) g.setAttribute('color', new THREE.BufferAttribute(m.colors, 3))
  if (m.ao) g.setAttribute('ao', new THREE.BufferAttribute(m.ao, 1))
  g.setIndex(new THREE.BufferAttribute(m.indices, 1))
  g.computeBoundingSphere()
  return g
}

/** Фон: тёмный тёплый (рот за кадром), как чёрный контрастер у стоматологических макрофото. */
function backdrop(): THREE.Texture {
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 256
  const ctx = c.getContext('2d')
  if (ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, 256)
    g.addColorStop(0, '#120a0b')
    g.addColorStop(0.45, '#2a1517')
    g.addColorStop(0.75, '#3a1c1f')
    g.addColorStop(1, '#170c0d')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 64, 256)
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

type State = Record<string, number>

export async function init(canvas: HTMLCanvasElement, scenario: Scenario): Promise<void> {
  const W = scenario.width ?? 1080, H = scenario.height ?? 1920
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(1)
  renderer.setSize(W, H, false)
  renderer.toneMapping = THREE.NeutralToneMapping
  renderer.toneMappingExposure = 1.0
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap

  const scene = new THREE.Scene()
  scene.background = backdrop()
  const pmrem = new THREE.PMREMGenerator(renderer)
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  scene.environmentIntensity = 0.7
  const fog = new THREE.Fog('#1d0f10', 6.5, 12)
  scene.fog = fog

  // Свет как от стоматологического светильника: тёплый ключевой сверху-спереди с тенями, мягкий заполняющий
  // и холодный контровой сзади (отделяет бугры от тёмного фона)
  const key = new THREE.DirectionalLight('#fff4e8', 2.4)
  key.position.set(1.5, 6, 4)
  key.castShadow = true
  key.shadow.mapSize.set(2048, 2048)
  const sc = key.shadow.camera
  sc.left = sc.bottom = -2.2
  sc.right = sc.top = 2.2
  sc.near = 2
  sc.far = 14
  key.shadow.bias = -0.0005
  key.shadow.normalBias = 0.015
  key.shadow.radius = 4
  key.target.position.set(0, 0.4, 0)
  const fill = new THREE.DirectionalLight('#ffe9de', 0.6)
  fill.position.set(-4, 2, 5)
  const rim = new THREE.DirectionalLight('#b5d0ff', 1.1)
  rim.position.set(-2, 3, -5)
  const hemi = new THREE.HemisphereLight('#f2ecff', '#4a2a2a', 0.35)
  // «Кольцевая вспышка» у камеры, как у стоматологических макрофото: блики на влажной эмали
  const camLight = new THREE.PointLight('#ffffff', 9, 0, 1.6)
  scene.add(key, key.target, fill, rim, hemi, camLight)

  // ── Сетки ──
  const meshes = buildTreatMeshes()
  const phys = (p: THREE.MeshPhysicalMaterialParameters) => new THREE.MeshPhysicalMaterial(p)
  const toothMat = applySurface(phys({ color: '#ffffff', vertexColors: true, roughness: 0.38, clearcoat: 0.9, clearcoatRoughness: 0.07, specularIntensity: 0.75 }),
    { kind: 'tooth', ao: true, sss: 0.45, sssColor: '#ffe2cc' })
  const gumMat = applySurface(phys({ color: '#ffffff', vertexColors: true, roughness: 0.48, clearcoat: 0.7, clearcoatRoughness: 0.12, sheen: 0.35, sheenColor: new THREE.Color('#ffc6cc') }),
    { kind: 'gum', ao: true, sss: 0.6, sssColor: '#ff7a70' })
  // Композит до полировки — чуть матовее и плотнее эмали; синий отсвет — когда светит лампа
  const compositeMat = applySurface(phys({ color: '#f1dfb8', roughness: 0.55, clearcoat: 0.3, clearcoatRoughness: 0.3, emissive: new THREE.Color('#2f62ff'), emissiveIntensity: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    { kind: 'plain', ao: true })
  const roughMat = applySurface(phys({ color: '#ffffff', vertexColors: true, roughness: 0.6, clearcoat: 0.2, emissive: new THREE.Color('#2f62ff'), emissiveIntensity: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    { kind: 'plain', ao: true })
  const finalMat = toothMat.clone()
  applySurface(finalMat, { kind: 'tooth', ao: true, sss: 0.45, sssColor: '#ffe2cc' })
  finalMat.polygonOffset = true
  finalMat.polygonOffsetFactor = -2
  finalMat.polygonOffsetUnits = -2
  const gelMat = phys({ color: '#2d86f0', roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05, transparent: true, opacity: 0.85, emissive: new THREE.Color('#0b3a8a'), emissiveIntensity: 0.25 })
  const bondMat = phys({ color: '#fff3cf', roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02, transparent: true, opacity: 0, depthWrite: false, specularIntensity: 1 })

  const mk = (m: MeshData, mat: THREE.Material, order = 0) => {
    const mesh = new THREE.Mesh(toGeometry(m), mat)
    mesh.castShadow = mesh.receiveShadow = true
    mesh.renderOrder = order
    mesh.visible = false
    scene.add(mesh)
    return mesh
  }
  const stages = meshes.toothStages.map((m) => mk(m, toothMat))
  const healthy = mk(meshes.toothHealthy, toothMat)
  const layers = meshes.layers.map((m) => mk(m, compositeMat, 1))
  const fillRough = mk(meshes.fillRough, roughMat, 1)
  const fillFinal = mk(meshes.fillFinal, finalMat, 1)
  const gel = meshes.gel.map((m) => mk(m, gelMat, 2))
  const bond = mk(meshes.bond, bondMat, 3)
  for (const n of meshes.neighbours) mk(n, toothMat).visible = true
  mk(meshes.gum, gumMat).visible = true

  // ── Инструменты и частицы ──
  const tools = createTools()
  for (const t of Object.values(tools)) scene.add(t.group)
  const dot = haloTexture()
  const particles = (count: number, size: number, color: string, opacity: number) => {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3))
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ map: dot, size, color, transparent: true, opacity, depthWrite: false, sizeAttenuation: true }))
    pts.visible = false
    pts.frustumCulled = false
    scene.add(pts)
    return pts
  }
  const spray = particles(700, 0.05, '#eef6ff', 0.55)
  const stream = particles(900, 0.035, '#dfeeff', 0.7)
  const splash = particles(260, 0.05, '#f2f8ff', 0.6)

  const camera = new THREE.PerspectiveCamera(26, W / H, 0.05, 60)
  const cavity = new THREE.Vector3(...CAVITY_TOP)
  const basis = new THREE.Matrix4()

  function stateAt(t: number): State {
    const s: State = {}
    for (const k of Object.keys(DEFAULTS)) s[k] = evalTrack(scenario.tracks[k], t, DEFAULTS[k]!)
    for (const k of Object.keys(scenario.tracks)) if (!(k in s)) s[k] = evalTrack(scenario.tracks[k], t, 0)
    return s
  }

  /** Ткани и материалы по состоянию (без камеры и инструментов). */
  function applyTissues(s: State) {
    const healed = s.healed! >= 0.5
    const stage = Math.round(Math.min(1, Math.max(0, s.prep!)) * (stages.length - 1))
    stages.forEach((m, i) => { m.visible = !healed && i === stage })
    healthy.visible = healed
    // Слои: fill ∈ [0, 3] — три слоя по четыре подстадии
    const sub = Math.ceil(Math.min(3, s.fill!) * 4) - 1
    const done = s.fill! >= 3
    layers.forEach((m, i) => { m.visible = !healed && !done && i === sub })
    fillRough.visible = !healed && done && s.polish! < 0.55
    fillFinal.visible = !healed && done && s.polish! >= 0.55
    const glowAmt = s.cure! * (0.75 + 0.25 * Math.sin(s.__t! * 31))
    compositeMat.emissiveIntensity = 0.55 * glowAmt
    roughMat.emissiveIntensity = 0.45 * glowAmt
    // Гель протравки: появляется стадиями, при смыве тает
    const g = s.etch!
    const gi = g <= 0 ? -1 : Math.min(gel.length - 1, Math.ceil(g * gel.length) - 1)
    gel.forEach((m, i) => { m.visible = i === gi && s.rinse! < 0.98 })
    gelMat.opacity = 0.85 * (1 - s.rinse!)
    bond.visible = s.bond! > 0.01 && s.fill! < 0.3
    bondMat.opacity = 0.42 * Math.min(1, s.bond!) + 0.3 * s.wet!
    toothMat.clearcoatRoughness = 0.07 - 0.04 * s.wet!
  }

  function applyCamera(s: State) {
    const az = (s.camAz! * Math.PI) / 180, el = (s.camEl! * Math.PI) / 180
    const target = new THREE.Vector3(s.camTx, s.camTy, s.camTz)
    // Лёгкое «дыхание» камеры в руке — кадр живой, но без тряски
    const t = s.__t!
    const drift = new THREE.Vector3(Math.sin(t * 0.7) * 0.012, Math.sin(t * 0.53 + 1) * 0.01, 0)
    camera.position.set(
      target.x + s.camDist! * Math.cos(el) * Math.sin(az),
      target.y + s.camDist! * Math.sin(el),
      target.z + s.camDist! * Math.cos(el) * Math.cos(az),
    ).add(drift)
    camera.up.set(Math.sin((s.camRoll! * Math.PI) / 180), Math.cos((s.camRoll! * Math.PI) / 180), 0)
    camera.fov = s.camFov!
    camera.updateProjectionMatrix()
    camera.lookAt(target.add(drift))
    // Туман — за зубом: дальние края десны и соседей тонут в темноте (как малая глубина резкости)
    fog.near = s.camDist! + 1.2
    fog.far = s.camDist! + 7
    camLight.position.copy(camera.position)
  }

  function applyTools(s: State) {
    const t = s.__t!
    for (const name of TOOLS) {
      const tool = tools[name]
      const p = Math.min(1, Math.max(0, s[name] ?? 0))
      tool.group.visible = p > 0.001
      if (!tool.group.visible) continue
      const pose = TOOL_POSE[name]
      const dir = new THREE.Vector3(...pose.dir).normalize()
      // Подход: издалека вдоль оси ручки (за кадр), в конце — на месте
      const away = (1 - smooth(p)) * 3.2
      const wig = s[`${name}Wig`] ?? 0
      const pos = cavity.clone().add(new THREE.Vector3(...pose.at))
        .add(new THREE.Vector3(s[`${name}X`] ?? 0, s[`${name}Y`] ?? 0, s[`${name}Z`] ?? 0))
        .add(new THREE.Vector3(Math.sin(t * 7.3) * 0.05 * wig, Math.sin(t * 11.1) * 0.012 * wig, Math.cos(t * 5.9) * 0.025 * wig))
        .addScaledVector(dir, away)
      tool.group.position.copy(pos)
      // Базис инструмента: y — ось, x — куда изогнута ручка (side без проекции на ось), z — третья
      const sx = new THREE.Vector3(...pose.side)
      sx.addScaledVector(dir, -sx.dot(dir)).normalize()
      basis.makeBasis(sx, dir, new THREE.Vector3().crossVectors(sx, dir))
      tool.group.quaternion.setFromRotationMatrix(basis)
      if (tool.spin) tool.spin.rotation.y = (s[`${name}Spin`] ?? 0) > 0 ? hash(Math.floor(t * 30)) * Math.PI * 2 : 0
    }
    const lamp = tools.lamp.glow!
    lamp.light.intensity = 1.6 * s.cure!
    lamp.tip.color.setRGB(0.45 + 0.55 * s.cure!, 0.6 + 0.4 * s.cure!, 1)
    lamp.halo.opacity = 0.85 * s.cure!
  }

  /** Брызги воды из наконечника и струя пистолета вода-воздух — частицы по детерминированному «случаю». */
  function applyParticles(s: State) {
    const t = s.__t!
    const frame = Math.floor(t * 30)
    const tip = tools.bur.group.position
    spray.visible = s.spray! > 0.01 && tools.bur.group.visible
    if (spray.visible) {
      const a = spray.geometry.getAttribute('position') as THREE.BufferAttribute
      const head = new THREE.Vector3(0, 1.3, 0).applyQuaternion(tools.bur.group.quaternion).add(tip)
      for (let i = 0; i < a.count; i++) {
        const r1 = hash(i * 3.1 + frame * 17.7), r2 = hash(i * 7.7 + frame * 3.3), r3 = hash(i * 1.3 + frame * 9.1)
        const u = (r1 + (t * 2.2) % 1) % 1 // доля пути от сопла к бору и дальше
        const from = head.clone().lerp(tip, Math.min(1, u * 1.2))
        const spread = 0.04 + u * 0.35
        a.setXYZ(i, from.x + (r2 - 0.5) * spread, from.y + (r3 - 0.5) * spread * 0.6 + (u > 0.85 ? (u - 0.85) * 1.5 : 0), from.z + (hash(i + frame) - 0.5) * spread)
      }
      a.needsUpdate = true
      ;(spray.material as THREE.PointsMaterial).opacity = 0.5 * s.spray!
    }
    const water = s.water!
    stream.visible = splash.visible = water > 0.01 && tools.air.group.visible
    if (stream.visible) {
      const nozzle = tools.air.group.position.clone()
      const target = cavity.clone().add(new THREE.Vector3(0, -0.06, 0))
      const a = stream.geometry.getAttribute('position') as THREE.BufferAttribute
      for (let i = 0; i < a.count; i++) {
        const u = (i / a.count + t * 3.1) % 1
        const p = nozzle.clone().lerp(target, u)
        const j = 0.012 + u * 0.02
        a.setXYZ(i, p.x + (hash(i * 2.3 + frame) - 0.5) * j, p.y + (hash(i * 5.1 + frame) - 0.5) * j, p.z + (hash(i * 8.9 + frame) - 0.5) * j)
      }
      a.needsUpdate = true
      const b = splash.geometry.getAttribute('position') as THREE.BufferAttribute
      for (let i = 0; i < b.count; i++) {
        const life = (hash(i * 4.7) + t * 2.5) % 1
        const ang = hash(i * 9.3) * Math.PI * 2, sp = 0.15 + hash(i * 2.9) * 0.45
        b.setXYZ(i, target.x + Math.cos(ang) * sp * life, target.y + 0.04 + life * 0.35 - life * life * 0.5, target.z + Math.sin(ang) * sp * life * 0.7)
      }
      b.needsUpdate = true
      ;(stream.material as THREE.PointsMaterial).opacity = 0.7 * water
      ;(splash.material as THREE.PointsMaterial).opacity = 0.6 * water
    }
  }

  function draw(t: number): State {
    const s = stateAt(t)
    s.__t = t
    applyCamera(s)
    applyTools(s)
    applyParticles(s)
    const w = s.compare!
    if (w > 0.001 && w < 0.999 && scenario.beforeAt != null) {
      // До/после — два кадра рядом: слева зуб «до» (стадии из beforeAt), справа «после», в каждой половине
      // зуб целиком по центру (у камеры половины своя ширина кадра). Граница — дорожка compare
      const before = stateAt(scenario.beforeAt)
      before.__t = t
      const split = Math.round(W * w)
      renderer.setScissorTest(true)
      for (const [x0, width, st] of [[0, split, before], [split, W - split, s]] as const) {
        applyTissues(st)
        camera.aspect = width / H
        camera.updateProjectionMatrix()
        renderer.setViewport(x0, 0, width, H)
        renderer.setScissor(x0, 0, width, H)
        renderer.render(scene, camera)
      }
      renderer.setScissorTest(false)
      renderer.setViewport(0, 0, W, H)
      camera.aspect = W / H
      camera.updateProjectionMatrix()
    } else {
      applyTissues(s)
      renderer.render(scene, camera)
    }
    return s
  }

  api.render = (t: number) => {
    const s = draw(t)
    return { compare: s.compare! }
  }
  // Первый кадр: шейдеры компилируются здесь, а не в первом кадре ролика
  draw(0)
}

const api: { init: typeof init; render: (t: number) => { compare: number } } = {
  init,
  render: () => { throw new Error('Сначала TreatReels.init') },
}
;(window as unknown as { TreatReels: typeof api }).TreatReels = api
