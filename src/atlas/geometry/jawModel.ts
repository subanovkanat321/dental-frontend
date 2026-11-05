import type { WisdomPosition } from '../content'
import { isPatientRight, isUpper, toothKind, type ToothKind } from '../fdi'
import { makeGrid, sample, surfaceNets, type MeshData } from './mesher'
import { clamp01, sdCapsule, sdEllipsoid, sdRoot, sdRoundBox, sdRoundCone, sdSphere, smax, smin, smoothstep } from './sdf'
import { crownOuter, rootOuter } from './toothModel'

/**
 * Челюсти: формы зубов по типам (резец, клык, премоляр, моляр) и их места на дуге.
 * Готовые модели с Wikimedia Commons не подошли (сервер отдаёт 429 нашему адресу — см. models/CREDITS.md),
 * поэтому дуга процедурная: 32 зуба по реальным ширинам в миллиметрах. Единица — 9 мм, как у модели зуба.
 */

export type JawShape = 'incisor' | 'canine' | 'premolar' | 'molarLower' | 'molarUpper'

/** Шейка каждой формы — на y = 0, коронка вверх, +z — к щеке (вестибулярно), x — вдоль дуги. */
const SHAPES: Record<JawShape, (x: number, y: number, z: number) => number> = {
  incisor: (x, y, z) => {
    // Лопатка: к режущему краю тоньше, к шейке уже
    const w = 0.62 + 0.38 * smoothstep(0, 0.55, y)
    const th = 1 - 0.55 * clamp01(y / 1.0)
    const crown = sdRoundBox(x / w, y - 0.5, z / th, 0.42, 0.5, 0.15, 0.13) * Math.min(w, th)
    const root = sdRoundCone(x, y, z * 0.85, 0, 0.1, 0, 0, -1.3, 0, 0.21, 0.05)
    return smin(crown, root, 0.12)
  },
  canine: (x, y, z) => {
    const crown = smin(sdEllipsoid(x, y - 0.38, z, 0.38, 0.42, 0.34), sdRoundCone(x, y, z * 1.25, 0, 0.4, 0, 0, 0.98, 0, 0.3, 0.05), 0.2)
    const root = sdRoundCone(x, y, z * 0.8, 0, 0.1, 0, 0, -1.45, 0, 0.25, 0.05)
    return smin(crown, root, 0.12)
  },
  premolar: (x, y, z) => {
    let crown = sdRoundBox(x, y - 0.36, z, 0.33, 0.34, 0.4, 0.22)
    crown = smax(crown, y - 0.62, 0.14)
    crown = smin(crown, sdSphere(x, y - 0.6, z - 0.17, 0.19), 0.12)
    crown = smin(crown, sdSphere(x, y - 0.55, z + 0.17, 0.15), 0.12)
    crown = smax(crown, -sdCapsule(x, y, z, -0.3, 0.76, 0, 0.3, 0.76, 0, 0.06), 0.05)
    const root = sdRoundCone(x, y, z * 0.75, 0, 0.1, 0, 0, -1.4, 0, 0.24, 0.06)
    return smin(crown, root, 0.12)
  },
  molarLower: (x, y, z) => smin(crownOuter(x, y, z), rootOuter(x, y, z), 0.12),
  molarUpper: (x, y, z) => {
    const trunk = sdRoundBox(x, y + 0.12, z, 0.43, 0.26, 0.4, 0.2)
    const roots = Math.min(
      sdRoot(x, y, z, [-0.27, -0.25, 0.2, 0.17, -0.33, -0.9, 0.26, 0.12, -0.3, -1.5, 0.28, 0.05]),
      sdRoot(x, y, z, [0.27, -0.25, 0.2, 0.16, 0.33, -0.85, 0.26, 0.11, 0.32, -1.4, 0.3, 0.05]),
      sdRoot(x, y, z, [0, -0.25, -0.2, 0.19, 0, -0.9, -0.34, 0.14, 0, -1.55, -0.38, 0.06]),
    )
    return smin(crownOuter(x, y, z), smin(trunk, roots, 0.15), 0.12)
  },
}

/** Ширина коронки формы (по x) в единицах модели — от неё масштаб под ширину реального зуба. */
const SHAPE_WIDTH: Record<JawShape, number> = { incisor: 0.84, canine: 0.76, premolar: 0.66, molarLower: 1.1, molarUpper: 1.1 }

/** Ширина коронки, мм (средние по учебникам): верх и низ, от центрального резца к зубу мудрости. */
const WIDTH_MM: Record<'upper' | 'lower', readonly number[]> = {
  upper: [8.5, 6.5, 7.6, 7.0, 6.6, 10.2, 9.2, 8.6],
  lower: [5.3, 5.9, 6.9, 7.0, 7.1, 11.0, 10.4, 9.8],
}

export function shapeOf(fdi: number): JawShape {
  const k: ToothKind = toothKind(fdi)
  if (k === 'central' || k === 'lateral') return 'incisor'
  if (k === 'canine') return 'canine'
  if (k === 'premolar1' || k === 'premolar2') return 'premolar'
  return isUpper(fdi) ? 'molarUpper' : 'molarLower'
}

/**
 * Сетки форм с цветом по вершинам: коронка — эмаль, корень — желтоватый цемент.
 * Шаг крупнее, чем у разреза: зуб на дуге маленький.
 */
export function buildJawShapes(step = 0.03): [JawShape, MeshData][] {
  return (Object.keys(SHAPES) as JawShape[]).map((name) => {
    const g = makeGrid([-0.75, -2.2, -0.75], [0.75, 1.1, 0.75], step)
    const mesh = surfaceNets(g, sample(g, SHAPES[name]))
    const colors = new Float32Array(mesh.positions.length)
    for (let v = 0; v < mesh.positions.length; v += 3) {
      const t = smoothstep(-0.06, 0.06, mesh.positions[v + 1]!)
      colors[v] = 0.8 + 0.16 * t
      colors[v + 1] = 0.63 + 0.31 * t
      colors[v + 2] = 0.4 + 0.48 * t
    }
    mesh.colors = colors
    return [name, mesh]
  })
}

/** Дуга (левая половина у пациента, x ≥ 0), мм: от середины вперёд-назад. Сглажена Чайкиным. */
const ARCH_MM: readonly (readonly [number, number])[] = [
  [0, 0], [4, -0.6], [8.5, -2.4], [12.5, -5.2], [16, -9], [18.6, -13.5], [20.6, -19], [22.4, -26], [23.8, -34], [24.8, -43], [25.5, -52], [26, -62],
]

function smoothArch(): [number, number][] {
  let pts: [number, number][] = ARCH_MM.map(([x, z]) => [x, z])
  for (let r = 0; r < 3; r++) {
    const next: [number, number][] = [pts[0]!]
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i]!, [bx, bz] = pts[i + 1]!
      next.push([ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25], [ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75])
    }
    next.push(pts[pts.length - 1]!)
    pts = next
  }
  return pts
}
const ARCH = smoothArch()

/** Точка и касательная дуги на длине s (мм от середины). */
export function archAt(s: number, widthScale = 1): { x: number; z: number; tx: number; tz: number } {
  let left = s
  for (let i = 0; i < ARCH.length - 1; i++) {
    const [ax, az] = ARCH[i]!, [bx, bz] = ARCH[i + 1]!
    const dx = (bx - ax) * widthScale, dz = bz - az
    const len = Math.hypot(dx, dz)
    if (left <= len || i === ARCH.length - 2) {
      const t = len ? left / len : 0
      return { x: ax * widthScale + dx * t, z: az + dz * t, tx: dx / len, tz: dz / len }
    }
    left -= len
  }
  return { x: 0, z: 0, tx: 1, tz: 0 }
}

/** Где стоит зуб: позиция (в единицах модели), поворот вокруг вертикали, масштаб, зеркально ли. */
export interface Placement {
  x: number
  y: number
  z: number
  rotY: number
  scale: number
  upper: boolean
  /** Высота шейки (граница эмали и цемента) над/под плоскостью смыкания — для десны. */
  neckY: number
}

const MM = 1 / 9
/** Расстояние между челюстями (рот приоткрыт): видно и верхние, и нижние зубы. */
export const JAW_GAP = 0.45

export function toothPlacement(fdi: number): Placement {
  const upper = isUpper(fdi)
  const n = fdi % 10
  const widths = WIDTH_MM[upper ? 'upper' : 'lower']
  let s = 0
  for (let i = 0; i < n - 1; i++) s += widths[i]! + 0.25
  const w = widths[n - 1]!
  s += w / 2
  // Нижняя дуга чуть уже и короче — нижние резцы стоят за верхними
  const a = archAt(s, upper ? 1 : 0.94)
  const shape = shapeOf(fdi)
  const scale = (w * MM) / SHAPE_WIDTH[shape]
  const side = isPatientRight(fdi) ? -1 : 1
  const crownH = 0.85 * scale
  const y = upper ? JAW_GAP + crownH : -JAW_GAP - crownH
  return {
    x: side * a.x * MM,
    y,
    z: (a.z + (upper ? 0 : -1.2)) * MM,
    rotY: side * Math.atan2(-a.tz, a.tx),
    scale,
    upper,
    neckY: y,
  }
}

/** Точка над коронкой выделенного зуба — для метки с номером. */
export function toothTip(fdi: number): [number, number, number] {
  const p = toothPlacement(fdi)
  const tip = 0.95 * p.scale
  return [p.x, p.upper ? p.y - tip : p.y + tip, p.z]
}

/** Зуб мудрости (48) рядом с 47 и 46: положение (x, y) и наклон к соседу (радианы; + — коронкой к 47). */
export const WISDOM_POSES: Record<WisdomPosition, { x: number; y: number; tilt: number }> = {
  vertical: { x: 1.16, y: -0.02, tilt: 0 },
  mesial: { x: 1.3, y: -0.62, tilt: 0.8 },
  horizontal: { x: 1.2, y: -1.0, tilt: Math.PI / 2 },
  impacted: { x: 1.24, y: -1.2, tilt: 0.08 },
}
export const WISDOM_SCALE = 0.86
/** Соседи: 47 (второй моляр) и край 46. */
export const WISDOM_NEIGHBOURS = [{ fdi: 47, x: 0 }, { fdi: 46, x: -1.22 }] as const
/** Верх кости и десны в сцене зуба мудрости. */
export const WISDOM_BONE_TOP = -0.08

/** Точка на коронке зуба мудрости — для метки. */
export function wisdomAnchor(pos: WisdomPosition): [number, number, number] {
  const p = WISDOM_POSES[pos]
  const h = 0.55 * WISDOM_SCALE
  return [p.x - Math.sin(p.tilt) * h, p.y + Math.cos(p.tilt) * h, 0.45]
}
