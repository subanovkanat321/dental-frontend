import * as THREE from 'three'

import type { AtlasMode, PartId } from '../content'
import { CANAL_PATH, CUT_X, TOOTH_GROUPS, type ToothGroup, type ToothMeshName } from '../geometry/toothModel'
import type { Materials } from './materials'

/** Какие сетки видны в режиме (остальные скрыты). Сосуды, файл, винт — отдельные объекты three.js. */
export const MODE_MESHES: Record<AtlasMode, readonly ToothMeshName[]> = {
  healthy: ['enamel', 'dentin', 'pulp', 'cementum', 'pdl', 'cortical', 'spongy', 'gum'],
  caries: ['enamel', 'dentin', 'pulp', 'cementum', 'pdl', 'cortical', 'spongy', 'gum'],
  endo: ['enamelAccess', 'dentinAccess', 'pulp', 'gutta', 'cementum', 'pdl', 'cortical', 'spongy', 'gum'],
  filling: ['enamelPrep', 'dentinPrep', 'pulp', 'filling', 'cementum', 'pdl', 'cortical', 'spongy', 'gum'],
  crown: ['dentinStump', 'crownCap', 'pulp', 'cementum', 'pdl', 'cortical', 'spongy', 'gum'],
  implant: ['implantCortical', 'implantSpongy', 'implantGum', 'implantCrown'],
}

/** Группы сеток, нужные режиму: строятся в фоне только при первом открытии режима. */
export function groupsFor(mode: AtlasMode): ToothGroup[] {
  const extra: Partial<Record<AtlasMode, ToothGroup>> = { caries: 'caries', endo: 'endo', filling: 'filling', crown: 'crown', implant: 'implant' }
  return mode === 'implant' ? ['base', 'implant'] : extra[mode] ? ['base', extra[mode]] : ['base']
}

/** Длительность ролика режима и границы шагов (секунды) — для подписи «1. … 2. … 3. …». */
export const TIMELINE: Partial<Record<AtlasMode, { steps: readonly number[]; total: number }>> = {
  endo: { steps: [0, 1.6, 5.4], total: 7.8 },
  filling: { steps: [0, 1.0, 3.6], total: 4.8 },
  crown: { steps: [0, 0.9], total: 2.8 },
  implant: { steps: [0, 2.9, 3.9], total: 5.2 },
}

export function stepAt(mode: AtlasMode, t: number): number {
  const steps = TIMELINE[mode]?.steps ?? [0]
  let s = 0
  for (let i = 0; i < steps.length; i++) if (t >= steps[i]!) s = i
  return s
}

const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)
const phase = (t: number, a: number, b: number) => ease((t - a) / (b - a))

function materialOf(name: ToothMeshName, m: Materials): THREE.Material {
  if (name.startsWith('enamel')) return m.enamel
  if (name.startsWith('dentin')) return m.dentin
  if (name === 'caries0') return m.cariesSpot
  if (name.startsWith('caries')) return m.caries
  if (name.endsWith('Cortical') || name === 'cortical') return m.cortical
  if (name.endsWith('Spongy') || name === 'spongy') return m.spongy
  if (name.endsWith('Gum') || name === 'gum') return m.gum
  if (name === 'crownCap' || name === 'implantCrown') return m.ceramic
  const direct: Partial<Record<ToothMeshName, THREE.Material>> = { pulp: m.pulp, cementum: m.cementum, pdl: m.pdl, gutta: m.gutta, filling: m.filling }
  return direct[name] ?? m.dentin
}

/**
 * Сцена «зуб в разрезе»: слои из Web Worker, сосуды и нерв, инструмент, имплант. Режим меняет видимость
 * и запускает короткий ролик (анимацию) с начала.
 */
export function createToothScene(m: Materials, load: (group: ToothGroup) => Promise<Map<string, THREE.BufferGeometry>>) {
  const root = new THREE.Group()
  const meshes = new Map<ToothMeshName, THREE.Mesh>()
  const disposables: THREE.BufferGeometry[] = []
  const loaded = new Set<ToothGroup>()

  const vessels = buildVessels(m, disposables)
  const file = buildFile(m, disposables)
  const screw = buildScrew(m, disposables)
  const abutment = buildAbutment(m, disposables)
  const lamp = buildLamp(m, disposables)
  root.add(vessels, file, screw, abutment, lamp)

  // Срез в режимах с анимацией: гуттаперча и пломба «наполняются» снизу вверх — плоскость отсечения поднимается
  const fillPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0)
  m.gutta.clippingPlanes = [fillPlane]
  m.filling.clippingPlanes = [fillPlane]

  let mode: AtlasMode = 'healthy'
  let stage = 0
  let started = 0
  let part: PartId | null = null
  let token = 0

  async function ensure(groups: ToothGroup[]): Promise<void> {
    for (const group of groups) {
      if (loaded.has(group)) continue
      const geos = await load(group)
      if (loaded.has(group)) continue
      loaded.add(group)
      for (const name of TOOTH_GROUPS[group]) {
        const geo = geos.get(name)
        if (!geo) continue
        disposables.push(geo)
        const mesh = new THREE.Mesh(geo, materialOf(name, m))
        mesh.name = name
        mesh.castShadow = true
        mesh.receiveShadow = true
        mesh.visible = false
        // Кариес и наполнители — поверх тканей (совпадающие грани), их рисуем позже
        if (name.startsWith('caries') || name === 'gutta' || name === 'filling' || name === 'pdl') mesh.renderOrder = 1
        meshes.set(name, mesh)
        root.add(mesh)
      }
    }
  }

  function apply(time: number): void {
    const show = new Set<string>(MODE_MESHES[mode])
    if (mode === 'caries') show.add(`caries${stage}`)
    for (const [name, mesh] of meshes) mesh.visible = show.has(name)
    vessels.visible = mode !== 'implant' && mode !== 'endo'
    file.visible = mode === 'endo'
    screw.visible = abutment.visible = mode === 'implant'
    lamp.visible = false
    // Пульпит — пульпа воспалена: краснее и «светится»
    m.pulp.emissive.set(mode === 'caries' && stage === 3 ? '#ff2a1a' : '#000000')
    m.pulp.emissiveIntensity = mode === 'caries' && stage === 3 ? 0.35 : 0
    m.pulp.transparent = mode === 'endo'
    m.pulp.opacity = 1
    m.pulp.needsUpdate = true
    started = time
  }

  return {
    root,
    /** Включить режим: дождаться сеток (первый раз), показать, запустить ролик. */
    async setMode(next: AtlasMode, time: number): Promise<void> {
      mode = next
      const my = ++token
      await ensure(groupsFor(next))
      if (my === token) apply(time)
    },
    setStage(next: number) {
      stage = next
      if (mode === 'caries') for (let s = 0; s < 4; s++) { const c = meshes.get(`caries${s}` as ToothMeshName); if (c) c.visible = s === stage }
    },
    setPart(next: PartId | null) { part = next },
    replay(time: number) { started = time },
    /** Заранее построить сетки остальных режимов, пока пациент смотрит на здоровый зуб. */
    prefetch: () => ensure(['caries', 'endo', 'filling', 'crown', 'implant']),
    get ready() { return loaded.has('base') },
    /** Кадр анимации: t — секунды с начала ролика. Возвращает номер шага для подписи. */
    update(time: number): number {
      const t = time - started
      highlight(m, part, time)
      // Сосуды и нерв: чуть «пульсируют» — живая ткань
      vessels.children[0]?.scale.setScalar(1 + 0.04 * Math.sin(time * 6))
      if (mode === 'endo') {
        m.pulp.opacity = 1 - phase(t, 0.3, 1.4)
        const p = meshes.get('pulp')
        if (p) p.visible = m.pulp.opacity > 0.01
        // Файл: заходит сверху, работает «вверх-вниз» с поворотом, уходит
        const enter = 1 - phase(t, 1.4, 2.0)
        const leave = phase(t, 4.8, 5.4)
        const work = t > 2.0 && t < 4.8 ? 0.5 + 0.5 * Math.sin((t - 2.0) * 7) : 0
        file.position.set(0, (enter + leave) * 1.6 + work * 0.18, 0)
        ;(file.userData.spin as THREE.Group).rotation.y = t * 9
        file.visible = t < 5.4
        fillPlane.constant = -1.98 + phase(t, 5.6, 7.6) * 2.05
      } else if (mode === 'filling') {
        fillPlane.constant = 0.45 + phase(t, 1.0, 3.4) * 0.6
        const cure = t > 3.6 && t < 4.6
        lamp.visible = cure
        m.filling.emissiveIntensity = cure ? 0.5 + 0.2 * Math.sin(t * 20) : 0
      } else if (mode === 'crown') {
        const cap = meshes.get('crownCap')
        if (cap) cap.position.y = (1 - phase(t, 0.9, 2.6)) * 1.5
      } else if (mode === 'implant') {
        const s = 1 - phase(t, 0, 2.8)
        screw.position.y = s * 1.3
        screw.rotation.y = s * Math.PI * 8
        abutment.position.y = (1 - phase(t, 2.9, 3.8)) * 1.4
        const crown = meshes.get('implantCrown')
        if (crown) crown.position.y = (1 - phase(t, 3.9, 5.0)) * 1.5
      }
      return stepAt(mode, t)
    },
    dispose() {
      for (const g of disposables) g.dispose()
      ;(lamp.userData.dispose as () => void)()
      meshes.clear()
    },
  }
}
export type ToothScene = ReturnType<typeof createToothScene>

/** Подсветка выбранной части: материал мягко «светится» (пульсация), остальные — как есть. */
const PART_MATERIALS: Record<PartId, readonly (keyof Materials)[]> = {
  enamel: ['enamel'], dentin: ['dentin'], stump: ['dentin'], pulp: ['pulp'], canal: ['pulp', 'gutta'],
  vessels: ['artery', 'vein', 'nerve'], cementum: ['cementum'], pdl: ['pdl'], bone: ['cortical', 'spongy'],
  gum: ['gum'], caries: ['caries', 'cariesSpot'], file: ['steel', 'handle'], gutta: ['gutta'], access: ['enamel', 'dentin'],
  filling: ['filling'], crown: ['ceramic'], implant: ['titanium'], abutment: ['titaniumDark'],
}
const HIGHLIGHTABLE = [...new Set(Object.values(PART_MATERIALS).flat())]

function highlight(m: Materials, part: PartId | null, time: number): void {
  const on = new Set(part ? PART_MATERIALS[part] : [])
  for (const key of HIGHLIGHTABLE) {
    if (key === 'filling' || key === 'pulp') continue
    const mat = m[key] as THREE.MeshPhysicalMaterial
    if (on.has(key)) {
      mat.emissive.set('#5fe0d0')
      mat.emissiveIntensity = 0.22 + 0.14 * Math.sin(time * 4)
    } else mat.emissiveIntensity = 0
  }
  // У пульпы и пломбы свой «свет» (пульпит, лампа) — подсветку добавляем только к нему
  if (part === 'pulp' || part === 'canal') {
    if (m.pulp.emissiveIntensity < 0.3) {
      m.pulp.emissive.set('#5fe0d0')
      m.pulp.emissiveIntensity = 0.18 + 0.12 * Math.sin(time * 4)
    }
  } else if (m.pulp.emissive.getHex() === 0x5fe0d0) m.pulp.emissiveIntensity = 0
}

/** Сосуды и нерв: артерия, вена и нерв идут из кости через верхушку корня по каналу в камеру пульпы. */
export function buildVessels(m: Materials, bag: THREE.BufferGeometry[]): THREE.Group {
  const group = new THREE.Group()
  const inner = new THREE.Group()
  group.add(inner)
  const tube = (pts: THREE.Vector3[], r: number, mat: THREE.Material) => {
    const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 120, r, 10)
    bag.push(geo)
    const mesh = new THREE.Mesh(geo, mat)
    mesh.castShadow = false
    return mesh
  }
  const bundle = (path: readonly (readonly [number, number])[], plane: 'front' | 'side', extra: [number, number][]) => {
    const all = [[path[0]![0] + 0.03, path[0]![1] - 0.3] as const, ...path, ...extra]
    const n = all.length
    const lines: [number, THREE.Material, number][] = [[-1, m.artery, 0.013], [1, m.vein, 0.014], [0, m.nerve, 0.011]]
    for (const [k, mat, r] of lines) {
      const pts = all.map(([x, y], i) => {
        // У верхушки канал узкий — сосуды сходятся; к камере расходятся
        const spread = 0.006 + 0.022 * (i / (n - 1))
        return plane === 'front' ? new THREE.Vector3(x + k * spread, y, 0.002) : new THREE.Vector3(CUT_X + 0.002, y, 0.03 + k * spread)
      })
      inner.add(tube(pts, r, mat))
    }
  }
  bundle(CANAL_PATH.distal, 'front', [[0.24, 0.22], [0.17, 0.36]])
  bundle(CANAL_PATH.mesial, 'side', [])
  return group
}

/** Эндодонтический файл: витой стальной стержень, сужающийся к кончику, и жёлтая ручка (размер ISO 20). */
function buildFile(m: Materials, bag: THREE.BufferGeometry[]): THREE.Group {
  const outer = new THREE.Group()
  const spin = new THREE.Group()
  const len = 2.9
  const shaft = new THREE.BoxGeometry(0.034, len, 0.034, 1, 160, 1)
  const pos = shaft.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i)
    const t = (y + len / 2) / len // 0 — кончик, 1 — у ручки
    const a = y * 26
    const w = 0.35 + 0.65 * t
    const x = pos.getX(i) * w, z = pos.getZ(i) * w
    pos.setXYZ(i, x * Math.cos(a) - z * Math.sin(a), y, x * Math.sin(a) + z * Math.cos(a))
  }
  shaft.computeVertexNormals()
  shaft.translate(0, len / 2, 0)
  const handle = new THREE.CylinderGeometry(0.075, 0.075, 0.32, 24)
  handle.translate(0, len + 0.16, 0)
  const neck = new THREE.CylinderGeometry(0.03, 0.045, 0.1, 16)
  neck.translate(0, len - 0.02, 0)
  bag.push(shaft, handle, neck)
  spin.add(new THREE.Mesh(shaft, m.steel), new THREE.Mesh(handle, m.handle), new THREE.Mesh(neck, m.steel))
  for (const c of spin.children) c.castShadow = true
  // Ось — по дистальному каналу: от кончика у верхушки к устью и выше. axis задаёт наклон,
  // spin внутри него крутится вокруг собственной оси инструмента
  const tip = new THREE.Vector3(0.375, -1.78, 0)
  const dir = new THREE.Vector3(0.28, 0.4, 0).sub(tip).normalize()
  const axis = new THREE.Group()
  axis.position.copy(tip)
  axis.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir)
  axis.add(spin)
  outer.add(axis)
  outer.userData.spin = spin
  return outer
}

/** Имплант: стержень (тело вращения) и резьба — трубка по винтовой линии. */
function buildScrew(m: Materials, bag: THREE.BufferGeometry[]): THREE.Group {
  const g = new THREE.Group()
  const top = -0.18, apex = -1.42
  const profile = [[0, top], [0.15, top], [0.165, top - 0.06], [0.155, -1.2], [0.12, -1.36], [0.06, apex], [0, apex]].map(([r, y]) => new THREE.Vector2(r, y))
  const core = new THREE.LatheGeometry(profile, 48)
  const coreR = (y: number) => (y > -1.2 ? 0.16 : 0.155 - ((-1.2 - y) / 0.16) * 0.035)
  class Helix extends THREE.Curve<THREE.Vector3> {
    constructor() {
      super()
    }
    override getPoint(t: number, target = new THREE.Vector3()) {
      const y = -0.3 + t * (-1.32 + 0.3)
      const a = t * Math.PI * 2 * 11
      const r = coreR(y)
      return target.set(Math.cos(a) * r, y, Math.sin(a) * r)
    }
  }
  const thread = new THREE.TubeGeometry(new Helix(), 900, 0.028, 8)
  // Шестигранник-соединение сверху — тёмный
  const hex = new THREE.CylinderGeometry(0.09, 0.09, 0.02, 6)
  hex.translate(0, top + 0.009, 0)
  bag.push(core, thread, hex)
  g.add(new THREE.Mesh(core, m.titanium), new THREE.Mesh(thread, m.titanium), new THREE.Mesh(hex, m.titaniumDark))
  for (const c of g.children) c.castShadow = true
  return g
}

function buildAbutment(m: Materials, bag: THREE.BufferGeometry[]): THREE.Group {
  const g = new THREE.Group()
  const profile = [[0, -0.18], [0.145, -0.18], [0.15, -0.1], [0.172, -0.02], [0.15, 0.05], [0.115, 0.44], [0.08, 0.47], [0, 0.47]].map(([r, y]) => new THREE.Vector2(r, y))
  const geo = new THREE.LatheGeometry(profile, 48)
  bag.push(geo)
  const mesh = new THREE.Mesh(geo, m.titaniumDark)
  mesh.castShadow = true
  g.add(mesh)
  return g
}

/** Лампа для отверждения пломбы: световод с синим свечением над зубом. */
function buildLamp(m: Materials, bag: THREE.BufferGeometry[]): THREE.Group {
  const g = new THREE.Group()
  const body = new THREE.CylinderGeometry(0.1, 0.1, 1.0, 24)
  body.rotateZ(-0.5)
  body.translate(0.35, 1.75, 0.15)
  const glow = new THREE.ConeGeometry(0.32, 0.75, 32, 1, true)
  glow.translate(0, 1.15, 0.05)
  bag.push(body, glow)
  const glowMat = new THREE.MeshBasicMaterial({ color: '#4aa8ff', transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide })
  g.add(new THREE.Mesh(body, m.steel), new THREE.Mesh(glow, glowMat))
  g.userData.dispose = () => glowMat.dispose()
  return g
}
