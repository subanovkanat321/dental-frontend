import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'

import type { WisdomPosition } from '../content'
import { ALL_FDI, fdiToIndex } from '../fdi'
import { shapeOf, toothPlacement, WISDOM_BONE_TOP, WISDOM_NEIGHBOURS, WISDOM_POSES, WISDOM_SCALE, type JawShape } from '../geometry/jawModel'
import type { Materials } from './materials'
import { cloneSurface, applySurface } from './surface'

/**
 * Обе челюсти: 32 зуба на дуге и десна. Каждый зуб — своя сетка (index = fdiToIndex), чтобы выделять
 * его подсветкой и находить по нажатию (raycast — «луч» из камеры через точку экрана).
 */
export function createJawScene(m: Materials, shapes: Map<string, THREE.BufferGeometry>) {
  const root = new THREE.Group()
  // Белый зуб + свечение пересвечивается в белый — поэтому выделенный зуб и сам бирюзовый
  const highlight = cloneSurface(m.toothJaw)
  highlight.color.set('#62d8cb')
  highlight.emissive.set('#0e8a80')
  const teeth: THREE.Mesh[] = []
  for (const fdi of ALL_FDI) {
    const p = toothPlacement(fdi)
    // Место на дуге — у группы; у самого зуба — свои наклоны и зеркало. Зеркало (масштаб −1 по x)
    // переворачивает и повороты вокруг y и z — поэтому у зеркального зуба их знак обратный
    const place = new THREE.Group()
    place.position.set(p.x, p.y, p.z)
    place.rotation.set(0, p.rotY, p.upper ? Math.PI : 0, 'YXZ')
    const flip = p.mirror ? -1 : 1
    const mesh = new THREE.Mesh(shapes.get(shapeOf(fdi)), m.toothJaw)
    mesh.rotation.set(p.torque, flip * p.twist, flip * p.tip, 'YXZ')
    mesh.scale.set(flip * p.scale, p.scale, p.scale)
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.userData.fdi = fdi
    teeth[fdiToIndex(fdi)!] = mesh
    place.add(mesh)
    root.add(place)
  }
  const gums = [gumGeometry(true), gumGeometry(false)]
  for (const geo of gums) {
    const mesh = new THREE.Mesh(geo, m.gumJaw)
    mesh.receiveShadow = true
    root.add(mesh)
  }
  let selected: number | null = null

  return {
    root,
    teeth,
    select(fdi: number | null) {
      if (selected != null) teeth[selected]!.material = m.toothJaw
      selected = fdi == null ? null : fdiToIndex(fdi)
      if (selected != null) teeth[selected]!.material = highlight
    },
    /** Корни видны сквозь полупрозрачную десну. */
    setRoots(show: boolean) {
      m.gumJaw.transparent = show
      m.gumJaw.opacity = show ? 0.38 : 1
      m.gumJaw.depthWrite = !show
      m.gumJaw.needsUpdate = true
    },
    update(time: number) {
      highlight.emissiveIntensity = 0.25 + 0.2 * Math.sin(time * 4)
    },
    dispose() {
      for (const g of gums) g.dispose()
      highlight.dispose()
    },
  }
}
export type JawScene = ReturnType<typeof createJawScene>

/** Половина ширины десны (к щеке и к языку) у зуба формы — в единицах масштаба зуба. */
const GUM_HALF: Record<JawShape, number> = {
  incisorUpperCentral: 0.62, incisorUpperLateral: 0.66, incisorLower: 0.85, canineUpper: 0.78, canineLower: 0.82,
  premolarUpper: 0.84, premolarLower: 0.82, molarUpper: 0.92, molarLower: 0.9,
}

/**
 * Десна — «валик» вдоль дуги: сечение (к щеке, сверху над шейками, к языку) протягиваем по дуге с обеих
 * сторон. Между зубами край десны выше — межзубные сосочки, как у настоящей десны.
 */
function gumGeometry(upper: boolean): THREE.BufferGeometry {
  const q = upper ? [1, 2] : [4, 3]
  // Соседние зубы по порядку вдоль дуги: правая сторона (от 8 к 1), затем левая (от 1 к 8)
  const order = [...[8, 7, 6, 5, 4, 3, 2, 1].map((n) => q[0]! * 10 + n), ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => q[1]! * 10 + n)]
  const P = order.map(toothPlacement)
  // Сечение: (n — от середины валика к щеке, d — от шейки вглубь челюсти)
  const profile = smoothProfile([[0.7, 1.75], [0.98, 1.15], [1.03, 0.4], [0.82, -0.08], [0.3, -0.12], [-0.3, -0.12], [-0.8, -0.08], [-0.99, 0.4], [-0.96, 1.15], [-0.68, 1.75]])
  const verts: number[] = []
  const colors: number[] = []
  const rows: number[] = []
  const samples = 20
  let rowCount = 0
  for (let t = 0; t < P.length; t++) {
    const p = P[t]!
    const halfOf = (i: number) => GUM_HALF[shapeOf(order[i]!)] * P[i]!.scale * 0.36
    for (let k = 0; k < samples; k++) {
      // Положение внутри зуба: −0.5…0.5 по его ширине
      const f = k / samples - 0.5
      const next = P[t + 1]
      const prev = P[t - 1]
      // Точка дуги: между центром зуба и соседями
      const neighbour = f >= 0 ? next : prev
      const a = Math.abs(f)
      // Ширина валика — плавно между соседями, иначе на стыке зубов видны вертикальные «рёбра»
      const ni = f >= 0 ? t + 1 : t - 1
      const half = ni >= 0 && ni < P.length ? halfOf(t) + (halfOf(ni) - halfOf(t)) * a : halfOf(t)
      const base = neighbour
        ? { x: p.x + (neighbour.x - p.x) * a, z: p.z + (neighbour.z - p.z) * a, y: p.y + (neighbour.y - p.y) * a }
        : { x: p.x, z: p.z, y: p.y }
      // Нормаль наружу: от центра дуги
      const along = neighbour ? new THREE.Vector2(neighbour.x - p.x, neighbour.z - p.z).multiplyScalar(f >= 0 ? 1 : -1).normalize() : new THREE.Vector2(Math.cos(p.rotY), -Math.sin(p.rotY))
      let nx = -along.y, nz = along.x
      // Центр дуги — примерно (0, −3.2): нормаль должна смотреть от него
      if (nx * base.x + nz * (base.z + 3.2) < 0) { nx = -nx; nz = -nz }
      const papilla = Math.pow(a * 2, 3) * 0.16
      for (const [pn, pd] of profile) {
        // Сосочек поднимаем только у края десны (верх сечения)
        const d = pd - papilla * Math.max(0, 1 - Math.max(pd, 0) / 0.35)
        const y = upper ? base.y + d : base.y - d
        verts.push(base.x + nx * pn * half * 2, y, base.z + nz * pn * half * 2)
        colors.push(...gumColor(d))
      }
      rows.push(rowCount++)
    }
  }
  const idx: number[] = []
  const w = profile.length
  for (let r = 0; r < rowCount - 1; r++) {
    for (let c = 0; c < w - 1; c++) {
      const a = r * w + c, b = a + 1, d = a + w, e = d + 1
      idx.push(a, d, b, b, d, e)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  return geo
}

/**
 * Цвет десны по глубине от края (d): свободный край и сосочки светлее и розовее, прикреплённая десна —
 * коралловая, ниже переходной складки слизистая краснее (там тонкий эпителий и сосуды ближе).
 */
const GUM_STOPS: readonly (readonly [number, number, number, number])[] = [
  [-0.1, 0.94, 0.66, 0.66], [0.12, 0.9, 0.57, 0.58], [0.75, 0.86, 0.5, 0.52], [1.2, 0.78, 0.36, 0.42], [1.8, 0.74, 0.32, 0.38],
]
function gumColor(d: number): [number, number, number] {
  let i = 0
  while (i < GUM_STOPS.length - 2 && d > GUM_STOPS[i + 1]![0]) i++
  const a = GUM_STOPS[i]!, b = GUM_STOPS[i + 1]!
  const t = Math.min(1, Math.max(0, (d - a[0]) / (b[0] - a[0])))
  const c = (k: 1 | 2 | 3) => (a[k] + (b[k] - a[k]) * t) ** 2.2
  return [c(1), c(2), c(3)]
}

/** Сечение десны сглаживаем (Чайкин): без острых углов свет ложится ровно, без «граней». */
function smoothProfile(points: [number, number][]): [number, number][] {
  let pts = points
  for (let r = 0; r < 2; r++) {
    const next: [number, number][] = [pts[0]!]
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i]!, [bx, by] = pts[i + 1]!
      next.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25], [ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75])
    }
    next.push(pts[pts.length - 1]!)
    pts = next
  }
  return pts
}

/**
 * Сцена «зуб мудрости»: участок нижней челюсти сбоку — 46, 47 и 48 в полупрозрачной кости
 * (как на снимке, видны корни). Положение 48 меняется плавно.
 */
export function createWisdomScene(m: Materials, shapes: Map<string, THREE.BufferGeometry>) {
  const root = new THREE.Group()
  const molar = shapes.get('molarLower')!
  const geos: THREE.BufferGeometry[] = []
  for (const n of WISDOM_NEIGHBOURS) {
    const t = new THREE.Mesh(molar, m.toothJaw)
    t.position.set(n.x, 0, 0)
    t.scale.setScalar(n.fdi === 47 ? 0.94 : 1)
    t.castShadow = true
    root.add(t)
  }
  const wisdomMat = cloneSurface(m.toothJaw)
  wisdomMat.color.set('#a6eae2')
  wisdomMat.emissive.set('#0e8a80')
  const wisdom = new THREE.Mesh(molar, wisdomMat)
  wisdom.scale.setScalar(WISDOM_SCALE)
  wisdom.castShadow = true
  root.add(wisdom)

  const boneGeo = new RoundedBoxGeometry(5.2, 2.9, 1.5, 4, 0.18)
  boneGeo.translate(0.5, WISDOM_BONE_TOP - 1.45, 0)
  const gumGeo = new RoundedBoxGeometry(5.26, 0.34, 1.56, 4, 0.15)
  gumGeo.translate(0.5, WISDOM_BONE_TOP + 0.02, 0)
  geos.push(boneGeo, gumGeo)
  // У коробки-десны нет цвета по вершинам — свой однотонный цвет
  const gumMat = applySurface(m.gumJaw.clone(), { kind: 'gum', sss: 0.6, sssColor: '#ff7a70' })
  gumMat.vertexColors = false
  gumMat.color.set('#d9757c')
  gumMat.transparent = true
  gumMat.opacity = 0.7
  gumMat.depthWrite = false
  const bone = new THREE.Mesh(boneGeo, m.boneGlass)
  const gum = new THREE.Mesh(gumGeo, gumMat)
  bone.renderOrder = 2
  gum.renderOrder = 3
  root.add(bone, gum)

  let from = { ...WISDOM_POSES.vertical }
  let to = { ...WISDOM_POSES.vertical }
  let since = -10
  const place = (p: { x: number; y: number; tilt: number }) => {
    wisdom.position.set(p.x, p.y, 0)
    wisdom.rotation.set(0, 0, p.tilt)
  }
  place(to)

  return {
    root,
    setPosition(pos: WisdomPosition, time: number) {
      from = { x: wisdom.position.x, y: wisdom.position.y, tilt: wisdom.rotation.z }
      to = { ...WISDOM_POSES[pos] }
      since = time
    },
    update(time: number) {
      const k = Math.min(1, (time - since) / 0.9)
      const e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2
      place({ x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, tilt: from.tilt + (to.tilt - from.tilt) * e })
      wisdomMat.emissiveIntensity = 0.15 + 0.12 * Math.sin(time * 3)
    },
    dispose() {
      for (const g of geos) g.dispose()
      wisdomMat.dispose()
      gumMat.dispose()
    },
  }
}
export type WisdomScene = ReturnType<typeof createWisdomScene>
