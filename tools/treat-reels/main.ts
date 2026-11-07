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
import { createMaterials } from '../../src/atlas/engine/materials'
import { applySurface } from '../../src/atlas/engine/surface'
import { noise3 } from './geometry'
import { createTools, haloTexture, type ToolName } from './instruments'
import { addLook } from './look'
import { createPost } from './post'
import { canalProcedure } from './procs/canal'
import { cleaningProcedure } from './procs/cleaning'
import { crownProcedure } from './procs/crown'
import { fillingProcedure } from './procs/filling'
import { implantProcedure } from './procs/implant'
import type { Key, Pose, ProcCtx, Procedure, ProcedureName, Scenario, State } from './types'

export type { Key, Scenario }

const PROCEDURES: Record<ProcedureName, (ctx: ProcCtx) => Procedure> = {
  filling: fillingProcedure, canal: canalProcedure, crown: crownProcedure, implant: implantProcedure, cleaning: cleaningProcedure,
}

/** Значения по умолчанию, если дорожки нет. */
const DEFAULTS: Record<string, number> = {
  camAz: 0, camEl: 48, camDist: 4.2, camFov: 26, camRoll: 0,
  prep: 0, etch: 0, rinse: 0, bond: 0, fill: 0, cure: 0, polish: 0, healed: 0, compare: 0, water: 0, spray: 0, wet: 0, jet: 0,
  /** Постобработка: размытие по глубине и к краям, виньетка, зерно; «ручная» камера; капли на зубе. */
  dof: 9, edge: 5, vignette: 0.4, grain: 0.035, shake: 1, drops: 0,
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
const TOOL_POSE: Record<ToolName, Pose> = {
  bur: { at: [0, -0.04, 0], dir: [0.08, 0.82, -0.56], side: [-1, 0.1, 0] },
  syringe: { at: [0.02, 0.04, 0.02], dir: [0.3, 0.75, -0.6], side: [1, 0.3, 0] },
  air: { at: [-0.25, 0.6, -0.3], dir: [-0.35, 0.7, -0.6], side: [-1, 0.4, 0] },
  brush: { at: [0, -0.03, 0], dir: [0.35, 0.7, -0.6], side: [1, 0.4, 0] },
  lamp: { at: [0, 0.75, -0.45], dir: [0, 0.6, -0.8], side: [0, 1, 0] },
  plug: { at: [0, 0.02, 0], dir: [0.35, 0.72, -0.6], side: [1, 0.4, 0] },
  cup: { at: [0, 0.13, 0.02], dir: [0.12, 0.66, -0.74], side: [-1, 0.15, 0] },
  file: { at: [0, 0, 0], dir: [0, 1, 0], side: [1, 0, 0] },
  irrig: { at: [0, 0, 0], dir: [0.1, 0.9, -0.4], side: [1, 0.3, 0] },
  scanner: { at: [0, 0.5, 0], dir: [0, 0.35, -0.94], side: [-1, 0, 0] },
  idrill: { at: [0, 0, 0], dir: [0, 1, 0], side: [-1, 0, 0] },
  driver: { at: [0, 0, 0], dir: [0, 1, 0], side: [-1, 0, 0] },
  scaler: { at: [0, 0, 0], dir: [0.2, 0.6, 0.77], side: [1, 0.4, 0] },
  airflow: { at: [0, 0.35, 0.45], dir: [0.15, 0.55, 0.82], side: [1, 0.3, 0] },
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

export async function init(canvas: HTMLCanvasElement, scenario: Scenario): Promise<void> {
  const W = scenario.width ?? 1080, H = scenario.height ?? 1920
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(1)
  renderer.setSize(W, H, false)
  renderer.toneMapping = THREE.NeutralToneMapping
  renderer.toneMappingExposure = 1.0
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.VSMShadowMap
  // Плоскости отсечения: пульпа уходит, гуттаперча и пломба растут
  renderer.localClippingEnabled = true
  const post = createPost(renderer, W, H)

  const scene = new THREE.Scene()
  scene.background = backdrop()
  const pmrem = new THREE.PMREMGenerator(renderer)
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  scene.environmentIntensity = 0.7
  const fog = new THREE.Fog('#1d0f10', 8, 16)
  scene.fog = fog

  // Свет как от стоматологического светильника: тёплый ключевой сверху-спереди с тенями, мягкий заполняющий
  // и холодный контровой сзади (отделяет бугры от тёмного фона)
  const key = new THREE.DirectionalLight('#ffe7c9', 2.6)
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
  key.shadow.radius = 7
  key.shadow.blurSamples = 16
  key.target.position.set(0, 0.4, 0)
  const fill = new THREE.DirectionalLight('#ffe9de', 0.6)
  fill.position.set(-4, 2, 5)
  const rim = new THREE.DirectionalLight('#9cc2ff', 1.6)
  rim.position.set(-2, 3, -5)
  const hemi = new THREE.HemisphereLight('#f2ecff', '#4a2a2a', 0.35)
  // «Кольцевая вспышка» у камеры, как у стоматологических макрофото: блики на влажной эмали
  const camLight = new THREE.PointLight('#fff6ee', 5, 0, 1.6)
  scene.add(key, key.target, fill, rim, hemi, camLight)

  // ── Материалы и сетки процедуры ──
  const phys = (p: THREE.MeshPhysicalMaterialParameters) => new THREE.MeshPhysicalMaterial(p)
  const toothMat = applySurface(phys({ color: '#ffffff', vertexColors: true, roughness: 0.38, clearcoat: 0.9, clearcoatRoughness: 0.07, specularIntensity: 0.75 }),
    { kind: 'tooth', ao: true, sss: 0.45, sssColor: '#ffe2cc' })
  const gumMat = applySurface(phys({ color: '#ffffff', vertexColors: true, roughness: 0.48, clearcoat: 0.7, clearcoatRoughness: 0.12, sheen: 0.35, sheenColor: new THREE.Color('#ffc6cc') }),
    { kind: 'gum', ao: true, sss: 0.6, sssColor: '#ff7a70' })
  const toothOverMat = toothMat.clone()
  applySurface(toothOverMat, { kind: 'tooth', ao: true, sss: 0.45, sssColor: '#ffe2cc' })
  addLook(toothOverMat, ['enamel', 'wet'])
  addLook(toothMat, ['enamel', 'wet'])
  addLook(gumMat, ['gum', 'wet'])
  toothOverMat.polygonOffset = true
  toothOverMat.polygonOffsetFactor = -2
  toothOverMat.polygonOffsetUnits = -2
  let atlasMats: ReturnType<typeof createMaterials> | null = null
  const atlas = () => {
    if (!atlasMats) {
      atlasMats = createMaterials()
      addLook(atlasMats.enamel, ['wet'])
      addLook(atlasMats.gum, ['gum', 'wet'])
      addLook(atlasMats.ceramic, ['enamel', 'wet'])
    }
    return atlasMats
  }

  const mk = (m: MeshData, mat: THREE.Material, order = 0) => {
    const mesh = new THREE.Mesh(toGeometry(m), mat)
    mesh.castShadow = mesh.receiveShadow = true
    mesh.renderOrder = order
    mesh.visible = false
    scene.add(mesh)
    return mesh
  }
  const proc = PROCEDURES[scenario.procedure ?? 'filling']({ scene, mk, phys, toothMat, toothOverMat, gumMat, atlas })
  const work = new THREE.Vector3(...proc.work)
  DEFAULTS.camTx = proc.work[0]
  DEFAULTS.camTy = proc.work[1]
  DEFAULTS.camTz = proc.work[2]

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
  const spray = particles(900, 0.045, '#f4f9ff', 0.7)
  const jet = particles(2600, 0.1, '#a9c8ee', 0.85)
  // Струя Air Flow — полупрозрачный голубоватый конус от сопла и облако у поверхности (на светлой эмали
  // одни частицы не видны)
  const jetConeMat = new THREE.MeshBasicMaterial({ color: '#b4d2f5', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide })
  const jetCone = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.02, 1, 32, 1, true), jetConeMat)
  const jetHaloMat = new THREE.SpriteMaterial({ map: dot, color: '#cfe3ff', transparent: true, opacity: 0, depthWrite: false })
  const jetHalo = new THREE.Sprite(jetHaloMat)
  jetCone.visible = jetHalo.visible = false
  scene.add(jetCone, jetHalo)
  const stream = particles(900, 0.035, '#dfeeff', 0.7)
  const splash = particles(320, 0.06, '#ffffff', 0.75)

  // ── Капли воды на зубе: мелкие линзы с бликами; на крутых склонах медленно стекают ──
  const DROPS = 170
  const dropMat = phys({ color: '#ffffff', roughness: 0.02, clearcoat: 1, clearcoatRoughness: 0.01, transparent: true, opacity: 0.4, specularIntensity: 1, envMapIntensity: 2.4, depthWrite: false })
  const drops = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 18, 12), dropMat, DROPS)
  drops.renderOrder = 4
  drops.frustumCulled = false
  drops.visible = false
  scene.add(drops)
  const dropSpots: { p: THREE.Vector3; n: THREE.Vector3; r: number; h: number }[] = []
  if (proc.drops) {
    const { mesh, ok } = proc.drops
    const pos = mesh.positions, nor = mesh.normals
    const count = pos.length / 3
    for (let i = 0; dropSpots.length < DROPS && i < 40000; i++) {
      const v = Math.floor(hash(i * 3.7 + 1) * count) * 3
      const x = pos[v]!, y = pos[v + 1]!, z = pos[v + 2]!
      if (!ok(x, y, z, nor[v + 2]!)) continue
      dropSpots.push({ p: new THREE.Vector3(x, y, z), n: new THREE.Vector3(nor[v]!, nor[v + 1]!, nor[v + 2]!), r: 0.007 + 0.016 * hash(i * 9.1) ** 2, h: hash(i * 5.3 + 2) })
    }
  }
  const m4 = new THREE.Matrix4(), dq = new THREE.Quaternion(), dv = new THREE.Vector3(), ds = new THREE.Vector3(), yUp = new THREE.Vector3(0, 1, 0)
  function applyDrops(s: State) {
    const amount = s.drops!
    drops.visible = amount > 0.01 && dropSpots.length > 0
    if (!drops.visible) return
    const t = s.__t!
    dropSpots.forEach((d, i) => {
      const on = d.h < amount
      const steep = Math.max(0, 1 - d.n.y - 0.35)
      const slide = steep * 0.12 * ((t * 0.22 + d.h * 7) % 1)
      dv.copy(d.p).addScaledVector(d.n, d.r * 0.25)
      dv.y -= slide
      dq.setFromUnitVectors(yUp, d.n)
      const r = on ? d.r * (1 + 0.6 * steep * slide * 8) : 0
      ds.set(r, r * 0.45, r * (1 + slide * 3))
      m4.compose(dv, dq, ds)
      drops.setMatrixAt(i, m4)
    })
    drops.instanceMatrix.needsUpdate = true
  }

  // Бор на 300 000 об/мин глаз видит размытым «цилиндром» — полупрозрачная оболочка поверх рабочей части
  const burBlur = new THREE.Mesh(new THREE.CylinderGeometry(0.047, 0.047, 0.37, 40, 1, true),
    phys({ color: '#d6d2c8', metalness: 0.7, roughness: 0.3, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }))
  burBlur.position.y = 0.2
  tools.bur.group.add(burBlur)

  const camera = new THREE.PerspectiveCamera(26, W / H, 0.05, 60)
  const basis = new THREE.Matrix4()

  function stateAt(t: number): State {
    const s: State = {}
    for (const k of Object.keys(DEFAULTS)) s[k] = evalTrack(scenario.tracks[k], t, DEFAULTS[k]!)
    for (const k of Object.keys(scenario.tracks)) if (!(k in s)) s[k] = evalTrack(scenario.tracks[k], t, 0)
    return s
  }

  /** Ткани и материалы по состоянию (без камеры и инструментов) — у каждой процедуры свои. */
  const applyTissues = (s: State) => proc.apply(s)
  function applyCamera(s: State) {
    const az = (s.camAz! * Math.PI) / 180, el = (s.camEl! * Math.PI) / 180
    const target = new THREE.Vector3(s.camTx, s.camTy, s.camTz)
    // «Ручная» камера: несколько медленных волн и шум — дыхание оператора, без тряски
    const t = s.__t!
    const sh = s.shake!
    const nz = (k: number, f: number) => noise3(t * f, k * 7.3, 1.1) - 0.5
    const drift = new THREE.Vector3(
      (Math.sin(t * 0.71) * 0.014 + nz(1, 1.3) * 0.022) * sh,
      (Math.sin(t * 0.53 + 1) * 0.012 + nz(2, 1.1) * 0.018) * sh,
      nz(3, 0.9) * 0.02 * sh,
    )
    // Толчки на смене шага: быстрый наезд и крен, затухают
    let kickZoom = 0, kickRoll = 0
    for (const k of scenario.kicks ?? []) {
      const dt = t - k.t
      if (dt < 0 || dt > 1.6) continue
      const a = (1 - Math.exp(-dt * 16)) * Math.exp(-dt * 3.2)
      kickZoom += (k.zoom ?? -0.06) * a
      kickRoll += (k.roll ?? 0) * a
    }
    const dist = s.camDist! * (1 + kickZoom)
    camera.position.set(
      target.x + dist * Math.cos(el) * Math.sin(az),
      target.y + dist * Math.sin(el),
      target.z + dist * Math.cos(el) * Math.cos(az),
    ).add(drift)
    const roll = ((s.camRoll! + kickRoll + nz(4, 0.8) * 0.7 * sh) * Math.PI) / 180
    camera.up.set(Math.sin(roll), Math.cos(roll), 0)
    camera.fov = s.camFov!
    camera.updateProjectionMatrix()
    camera.lookAt(target.add(drift.multiplyScalar(0.6)))
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
      const pose = proc.poses?.[name] ?? TOOL_POSE[name]
      const dir = new THREE.Vector3(...pose.dir).normalize()
      // Подход: издалека вдоль оси ручки (за кадр), в конце — на месте
      // Быстро подлетает и мягко «садится» на место (ускорение → замедление), уходит наоборот
      const away = (1 - p) ** 3 * 3.4
      const wig = s[`${name}Wig`] ?? 0
      const pos = work.clone().add(new THREE.Vector3(...pose.at))
        .add(new THREE.Vector3(s[`${name}X`] ?? 0, s[`${name}Y`] ?? 0, s[`${name}Z`] ?? 0))
        .add(new THREE.Vector3(Math.sin(t * 7.3) * 0.05 * wig, Math.sin(t * 11.1) * 0.012 * wig, Math.cos(t * 5.9) * 0.025 * wig))
        .addScaledVector(dir, away)
      tool.group.position.copy(pos)
      // Базис инструмента: y — ось, x — куда изогнута ручка (side без проекции на ось), z — третья
      const sx = new THREE.Vector3(...pose.side)
      sx.addScaledVector(dir, -sx.dot(dir)).normalize()
      basis.makeBasis(sx, dir, new THREE.Vector3().crossVectors(sx, dir))
      tool.group.quaternion.setFromRotationMatrix(basis)
      // Вращение: Spin > 0 — быстрое (каждый кадр случайный угол — глазу это «размытие»), Turn — угол в оборотах
      if (tool.spin) tool.spin.rotation.y = (s[`${name}Spin`] ?? 0) > 0 ? hash(Math.floor(t * 30)) * Math.PI * 2 : (s[`${name}Turn`] ?? 0) * Math.PI * 2
      if (tool.glowMat) tool.glowMat.opacity = s[`${name}Glow`] ?? 0
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
    // Брызги — из того вращающегося инструмента, что сейчас в кадре (бор, сверло имплантолога, скейлер)
    const src = (['bur', 'idrill', 'scaler'] as const).find((n) => tools[n].group.visible) ?? 'bur'
    const tip = tools[src].group.position
    spray.visible = s.spray! > 0.01 && tools[src].group.visible
    if (spray.visible) {
      const a = spray.geometry.getAttribute('position') as THREE.BufferAttribute
      const head = new THREE.Vector3(0, tools[src].nozzle ?? 1.3, 0).applyQuaternion(tools[src].group.quaternion).add(tip)
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
    // Air Flow: плотная струя порошка с водой из сопла в рабочую точку, облако у поверхности
    jet.visible = s.jet! > 0.01 && tools.airflow.group.visible
    if (jet.visible) {
      const a = jet.geometry.getAttribute('position') as THREE.BufferAttribute
      const from = tools.airflow.group.position
      const to = work.clone().add(new THREE.Vector3(s.airflowX ?? 0, (s.airflowY ?? 0) - 0.03, (s.airflowZ ?? 0) + 0.17))
      for (let i = 0; i < a.count; i++) {
        const u = (hash(i * 1.7) + t * 3.3) % 1
        const p = from.clone().lerp(to, Math.min(1, u * 1.4))
        const cloud = Math.max(0, u * 1.4 - 1) * 1.2 + 0.015
        a.setXYZ(i, p.x + (hash(i * 4.1 + frame) - 0.5) * cloud * 2, p.y + (hash(i * 6.3 + frame) - 0.5) * cloud + cloud * 0.5, p.z + (hash(i * 9.7 + frame) - 0.5) * cloud * 1.5)
      }
      a.needsUpdate = true
      ;(jet.material as THREE.PointsMaterial).opacity = 0.85 * s.jet!
      const mid = from.clone().add(to).multiplyScalar(0.5)
      const len = from.distanceTo(to)
      jetCone.position.copy(mid)
      jetCone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize())
      jetCone.scale.set(1, len, 1)
      jetConeMat.opacity = 0.4 * s.jet! * (0.85 + 0.15 * Math.sin(t * 40))
      jetHalo.position.copy(to)
      const hs = 0.35 + 0.08 * Math.sin(t * 23)
      jetHalo.scale.set(hs, hs, 1)
      jetHaloMat.opacity = 0.7 * s.jet!
    }
    jetCone.visible = jetHalo.visible = jet.visible
    const water = s.water!
    const wsrc = tools.irrig.group.visible ? tools.irrig : tools.air
    stream.visible = splash.visible = water > 0.01 && wsrc.group.visible
    if (stream.visible) {
      const nozzle = wsrc.group.position.clone()
      const target = new THREE.Vector3(...(proc.waterTarget ?? proc.work))
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

  const rt = post.target
  function draw(t: number): State {
    const s = stateAt(t)
    s.__t = t
    applyCamera(s)
    applyTools(s)
    applyParticles(s)
    applyDrops(s)
    burBlur.visible = (s.burSpin ?? 0) > 0
    // Кадр рисуем в текстуру с глубиной, на экран — через постобработку (post.ts)
    renderer.setRenderTarget(rt)
    const w = s.compare!
    if (w > 0.001 && w < 0.999 && scenario.beforeAt != null) {
      // До/после — два кадра рядом: слева зуб «до» (стадии из beforeAt), справа «после», в каждой половине
      // зуб целиком по центру (у камеры половины своя ширина кадра). Граница — дорожка compare
      const before = stateAt(scenario.beforeAt)
      before.__t = t
      const split = Math.round(W * w)
      rt.scissorTest = true
      for (const [x0, width, st] of [[0, split, before], [split, W - split, s]] as const) {
        applyTissues(st)
        camera.aspect = width / H
        camera.updateProjectionMatrix()
        rt.viewport.set(x0, 0, width, H)
        rt.scissor.set(x0, 0, width, H)
        renderer.setRenderTarget(rt)
        renderer.render(scene, camera)
      }
      rt.scissorTest = false
      rt.viewport.set(0, 0, W, H)
      rt.scissor.set(0, 0, W, H)
      camera.aspect = W / H
      camera.updateProjectionMatrix()
    } else {
      applyTissues(s)
      renderer.render(scene, camera)
    }
    const focus = camera.position.distanceTo(new THREE.Vector3(s.camTx, s.camTy, s.camTz))
    post.finish(camera, { focus, aperture: s.dof!, edgeBlur: s.edge!, vignette: s.vignette!, grain: s.grain!, frame: Math.round(t * 30) })
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
