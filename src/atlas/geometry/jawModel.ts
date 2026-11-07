import type { WisdomPosition } from '../content'
import { isPatientRight, isUpper, toothKind, type ToothKind } from '../fdi'
import { makeGrid, sample, surfaceNets, type MeshData } from './mesher'
import { clamp01, sdRoot, sdRoundBox, sdRoundCone, smax, smin, smoothstep } from './sdf'
import { groove, hill, lowerMolarTop, rootOuter } from './toothModel'

/**
 * Челюсти: формы зубов по типам (резец, клык, премоляр, моляр) и их места на дуге.
 * Готовые модели с Wikimedia Commons не подошли (сервер отдаёт 429 нашему адресу — см. models/CREDITS.md),
 * поэтому дуга процедурная: 32 зуба по реальным ширинам в миллиметрах. Единица — 9 мм, как у модели зуба.
 */

export type JawShape =
  | 'incisorUpperCentral' | 'incisorUpperLateral' | 'incisorLower' | 'canineUpper' | 'canineLower'
  | 'premolarUpper' | 'premolarLower' | 'molarUpper' | 'molarLower'

/**
 * Формы зубов. Оси формы: шейка — на y = 0, коронка вверх, +x — дистально (от середины дуги), +z — к щеке
 * или губе (вестибулярно). Зубы правой и левой стороны — зеркальные копии (см. jawScene).
 *
 * Резцы и клыки — «профили»: ширина, губная и язычная поверхности заданы функциями высоты (губная
 * выпуклая, язычная — вогнутая лопатка с бугорком у шейки, режущий край тонкий, углы скруглены).
 * Премоляры и моляры — тело с выпуклостью у шейки и жевательная поверхность «картой высот»: бугры —
 * холмы, фиссуры — узкие канавки между ними, по краям — краевые валики. Корни сужаются к верхушке и
 * слегка загибаются дистально, как у настоящих.
 */
interface FrontParams {
  /** Полуширина у шейки и у режущего края. */
  neck: number
  wide: number
  /** Высота коронки. */
  h: number
  /** Толщина у шейки (губная и язычная поверхности) и у края. */
  lab: number
  ling: number
  edge: number
  /** Скругление дистального и мезиального угла. */
  distal: number
  mesial: number
  /** Клык: высота бугра (режущий край — двумя скатами). */
  cusp: number
  /** Корень: длина и радиусы (мезио-дистальный, губно-язычный). */
  root: number
  rx: number
  rz: number
}

function frontTooth(x: number, y: number, z: number, p: FrontParams): number {
  const t = clamp01(y / p.h)
  const hw = p.neck + (p.wide - p.neck) * smoothstep(-0.05, 0.75, t)
  const q = x / hw
  const q2 = Math.min(q * q, 1.4)
  const neckIn = 0.86 + 0.14 * smoothstep(0, 0.18, t)
  // Губная поверхность выпуклая и к краю уходит к язычной; поперёк — тоже выпуклая
  const zLab = (p.edge + (p.lab - p.edge) * (1 - t ** 1.7)) * neckIn - 0.07 * q2 * (1 - 0.4 * t)
    // две пологие бороздки между долями (три доли роста видны на губной стороне у края)
    - (p.cusp ? 0 : 0.014 * Math.exp(-(((Math.abs(q) - 0.36) / 0.12) ** 2)) * smoothstep(0.35, 0.9, t))
  // Язычная: вогнутая лопатка, у шейки — бугорок (цингулюм), по бокам — краевые валики
  const fossa = 0.06 * Math.max(0, 1 - q2 * 1.25) * smoothstep(0.15, 0.4, t) * (1 - smoothstep(0.75, 0.97, t))
  const zLing = -(p.edge * 0.6 + (p.ling - p.edge * 0.6) * (1 - t) ** 1.5) * neckIn - 0.05 * Math.exp(-(((t - 0.1) / 0.12) ** 2)) + fossa
  const side = smax(Math.abs(x) - hw, Math.max(z - zLab, zLing - z), 0.07)
  // Режущий край: углы скруглены (дистальный сильнее), у клыка — бугор, скаты к углам
  const dq = Math.max(q, 0), mq = Math.max(-q, 0)
  let top = p.h - p.distal * smoothstep(0.45, 1.05, dq) ** 2 - p.mesial * smoothstep(0.55, 1.05, mq) ** 2
  if (p.cusp) top -= p.cusp * (Math.abs(q + 0.08) ** 1.15)
  else top += 0.006 * Math.cos(q * Math.PI * 3) * (1 - q2) // едва заметные маммелоны
  let crown = smax(side * 0.85, (y - top) * 0.8, 0.05)
  crown = smax(crown, -y - 0.2, 0.05)
  return smin(crown, taperedRoot(x, y, z, p.root, p.rx, p.rz), 0.1)
}

/** Корень: эллипс в сечении, сужается к верхушке, верхушка чуть дистально. */
function taperedRoot(x: number, y: number, z: number, len: number, rx: number, rz: number): number {
  const k = clamp01(-y / len)
  const xb = x - 0.07 * k * k
  return sdRoundCone(xb, y, z * (rx / rz), 0, 0.12, 0, 0, -len, 0, rx, 0.035)
}

/**
 * Тело жевательного зуба: «бочка» со скруглённым сечением (суперэллипс), выпуклость в пришеечной
 * трети (щёчная сторона) и в средней (язычная), к шейке сужается.
 */
function posteriorBody(x: number, y: number, z: number, hw: number, hb: number, hl: number, h: number): number {
  const t = clamp01(y / h)
  const bulgeB = 1 + 0.16 * Math.sin(Math.PI * Math.min(1, t * 1.6)) - 0.1 * t * t
  const bulgeL = 1 + 0.14 * Math.sin(Math.PI * Math.min(1, t * 1.1))
  const neck = 0.84 + 0.16 * smoothstep(0, 0.3, t)
  const w = hw * (neck + 0.08 * Math.sin(Math.PI * Math.min(1, t * 1.2)))
  const zr = z >= 0 ? hb * bulgeB * neck : hl * bulgeL * neck
  const ax = Math.abs(x) / w, az = Math.abs(z) / zr
  const r = (ax ** 2.6 + az ** 2.6) ** (1 / 2.6)
  return (r - 1) * Math.min(w, zr)
}

function premolar(x: number, y: number, z: number, upper: boolean): number {
  const body = posteriorBody(x, y, z, 0.31, 0.36, upper ? 0.35 : 0.3, 0.75)
  // Щёчный бугор выше; у нижнего язычный маленький, у верхнего — почти такой же
  let top = 0.5
  top += hill(x, z, -0.02, 0.15, 0.27, 0.2, 0.15)
  top += hill(x, z, upper ? 0.0 : -0.04, -0.17, upper ? 0.22 : 0.12, 0.19, 0.14)
  top += hill(x, z, -0.25, 0, 0.1, 0.06, 0.2) + hill(x, z, 0.25, 0, 0.1, 0.06, 0.2) // краевые валики
  top -= groove(x, z, -0.2, -0.01, 0.2, -0.01, 0.1, 0.035) // центральная фиссура
  top -= hill(x, z, -0.17, -0.01, 0.05, 0.04, 0.04) + hill(x, z, 0.17, -0.01, 0.05, 0.04, 0.04) // ямки
  let crown = smax(body, (y - top) * 0.55, 0.06)
  crown = smax(crown, -y - 0.2, 0.05)
  const root = upper
    ? Math.min(taperedRoot(x, y, z - 0.09, 1.25, 0.17, 0.15), taperedRoot(x, y, z + 0.11, 1.3, 0.17, 0.15))
    : taperedRoot(x, y, z, 1.45, 0.2, 0.27)
  return smin(crown, root, 0.12)
}

/** Жевательная поверхность моляра: 4–5 бугров, фиссуры, краевые валики. */
function molarTop(x: number, z: number, upper: boolean): number {
  let top = 0.42
  if (upper) {
    top += hill(x, z, -0.25, 0.22, 0.24, 0.19, 0.16) // мезиально-щёчный
    top += hill(x, z, 0.2, 0.22, 0.21, 0.17, 0.15) // дистально-щёчный
    top += hill(x, z, -0.19, -0.2, 0.27, 0.22, 0.18) // мезиально-нёбный (самый большой)
    top += hill(x, z, 0.27, -0.24, 0.15, 0.14, 0.13) // дистально-нёбный
    top += groove(x, z, -0.19, -0.2, 0.2, 0.22, 0.05, 0.08) // косой валик
    top -= groove(x, z, -0.42, 0.0, -0.02, 0.02, 0.11, 0.035)
    top -= groove(x, z, -0.02, 0.02, 0.0, 0.46, 0.09, 0.03)
    top -= groove(x, z, 0.08, -0.04, 0.42, -0.08, 0.09, 0.03)
  } else {
    return lowerMolarTop(x, z)
  }
  top += hill(x, z, -0.44, 0, 0.09, 0.06, 0.28) + hill(x, z, 0.44, 0, 0.08, 0.06, 0.28) // краевые валики
  return top
}

function molar(x: number, y: number, z: number, upper: boolean): number {
  const body = posteriorBody(x, y, z, 0.53, upper ? 0.47 : 0.43, upper ? 0.47 : 0.41, 0.66)
  let crown = smax(body, (y - molarTop(x, z, upper)) * 0.55, 0.06)
  crown = smax(crown, -y - 0.25, 0.05)
  const trunk = sdRoundBox(x, y + 0.12, z, 0.42, 0.26, upper ? 0.4 : 0.36, 0.2)
  const roots = upper
    ? Math.min(
      sdRoot(x, y, z, [-0.27, -0.25, 0.2, 0.17, -0.33, -0.9, 0.26, 0.12, -0.3, -1.5, 0.28, 0.05]),
      sdRoot(x, y, z, [0.27, -0.25, 0.2, 0.16, 0.33, -0.85, 0.26, 0.11, 0.32, -1.4, 0.3, 0.05]),
      sdRoot(x, y, z, [0, -0.25, -0.2, 0.19, 0, -0.9, -0.34, 0.14, 0, -1.55, -0.38, 0.06]),
    )
    : rootOuter(x, y, z)
  return smin(crown, upper ? smin(trunk, roots, 0.15) : roots, 0.12)
}

const UPPER_CENTRAL: FrontParams = { neck: 0.31, wide: 0.42, h: 1.05, lab: 0.33, ling: 0.31, edge: 0.035, distal: 0.13, mesial: 0.05, cusp: 0, root: 1.35, rx: 0.2, rz: 0.27 }
const UPPER_LATERAL: FrontParams = { neck: 0.27, wide: 0.37, h: 0.95, lab: 0.3, ling: 0.29, edge: 0.035, distal: 0.2, mesial: 0.08, cusp: 0, root: 1.35, rx: 0.17, rz: 0.24 }
const LOWER_INCISOR: FrontParams = { neck: 0.2, wide: 0.27, h: 0.95, lab: 0.27, ling: 0.27, edge: 0.03, distal: 0.05, mesial: 0.03, cusp: 0, root: 1.3, rx: 0.13, rz: 0.27 }
const UPPER_CANINE: FrontParams = { neck: 0.29, wide: 0.39, h: 1.05, lab: 0.38, ling: 0.36, edge: 0.07, distal: 0.05, mesial: 0.03, cusp: 0.28, root: 1.75, rx: 0.22, rz: 0.3 }
const LOWER_CANINE: FrontParams = { neck: 0.26, wide: 0.35, h: 1.1, lab: 0.36, ling: 0.34, edge: 0.06, distal: 0.05, mesial: 0.03, cusp: 0.24, root: 1.6, rx: 0.2, rz: 0.3 }

export const SHAPES: Record<JawShape, (x: number, y: number, z: number) => number> = {
  incisorUpperCentral: (x, y, z) => frontTooth(x, y, z, UPPER_CENTRAL),
  incisorUpperLateral: (x, y, z) => frontTooth(x, y, z, UPPER_LATERAL),
  incisorLower: (x, y, z) => frontTooth(x, y, z, LOWER_INCISOR),
  canineUpper: (x, y, z) => frontTooth(x, y, z, UPPER_CANINE),
  canineLower: (x, y, z) => frontTooth(x, y, z, LOWER_CANINE),
  premolarUpper: (x, y, z) => premolar(x, y, z, true),
  premolarLower: (x, y, z) => premolar(x, y, z, false),
  molarUpper: (x, y, z) => molar(x, y, z, true),
  molarLower: (x, y, z) => molar(x, y, z, false),
}

/** Ширина коронки формы (по x) в единицах модели — от неё масштаб под ширину реального зуба. */
const SHAPE_WIDTH: Record<JawShape, number> = {
  incisorUpperCentral: 0.84, incisorUpperLateral: 0.74, incisorLower: 0.54, canineUpper: 0.78, canineLower: 0.7,
  premolarUpper: 0.66, premolarLower: 0.66, molarUpper: 1.1, molarLower: 1.1,
}
/** Высота коронки формы (от шейки до режущего края или бугров) — зубы стоят кончиками на плоскости смыкания. */
const CROWN_H: Record<JawShape, number> = {
  incisorUpperCentral: 1.05, incisorUpperLateral: 0.95, incisorLower: 0.95, canineUpper: 1.05, canineLower: 1.1,
  premolarUpper: 0.84, premolarLower: 0.8, molarUpper: 0.72, molarLower: 0.72,
}
/** Граница эмали и цемента: на губной и язычной сторонах ниже, между зубами (проксимально) — выше. */
const CEJ_ARC: Record<JawShape, number> = {
  incisorUpperCentral: 0.2, incisorUpperLateral: 0.18, incisorLower: 0.16, canineUpper: 0.16, canineLower: 0.14,
  premolarUpper: 0.09, premolarLower: 0.09, molarUpper: 0.05, molarLower: 0.05,
}

/** Ширина коронки, мм (средние по учебникам): верх и низ, от центрального резца к зубу мудрости. */
const WIDTH_MM: Record<'upper' | 'lower', readonly number[]> = {
  upper: [8.5, 6.5, 7.6, 7.0, 6.6, 10.2, 9.2, 8.6],
  lower: [5.3, 5.9, 6.9, 7.0, 7.1, 11.0, 10.4, 9.8],
}

export function shapeOf(fdi: number): JawShape {
  const k: ToothKind = toothKind(fdi)
  const up = isUpper(fdi)
  if (k === 'central') return up ? 'incisorUpperCentral' : 'incisorLower'
  if (k === 'lateral') return up ? 'incisorUpperLateral' : 'incisorLower'
  if (k === 'canine') return up ? 'canineUpper' : 'canineLower'
  if (k === 'premolar1' || k === 'premolar2') return up ? 'premolarUpper' : 'premolarLower'
  return up ? 'molarUpper' : 'molarLower'
}

/** sRGB (как в редакторе цвета) → линейный цвет, в котором three.js читает цвета вершин. */
const lin = (c: number) => c ** 2.2

/**
 * Цвет зуба по вершинам — как у живого зуба, а не однотонный белый:
 * у шейки эмаль тонкая и просвечивает жёлтый дентин; в середине — цвет слоновой кости; режущий край
 * резцов и клыков полупрозрачный — сероголубой; клыки чуть желтее резцов; корень — желтоватый цемент.
 */
function toothColor(shape: JawShape, x: number, y: number, z: number, out: Float32Array, o: number): void {
  const front = shape.startsWith('incisor') || shape.startsWith('canine')
  const h = CROWN_H[shape]
  const prox = (x * x) / (x * x + z * z + 1e-6)
  const cej = -0.04 + CEJ_ARC[shape] * prox
  const enamel = smoothstep(cej - 0.025, cej + 0.025, y)
  const t = clamp01((y - cej) / (h - cej))
  // Эмаль: шейка → тело → край
  let r = 0.94, g = 0.925, b = 0.875
  const neck = 1 - smoothstep(0.0, 0.32, t)
  r += (0.92 - r) * neck; g += (0.85 - g) * neck; b += (0.71 - b) * neck
  if (shape.startsWith('canine')) { r -= 0.01; g -= 0.025; b -= 0.05 }
  if (front) {
    const edge = smoothstep(0.72, 1.0, t) * 0.75
    r += (0.73 - r) * edge; g += (0.78 - g) * edge; b += (0.85 - b) * edge
  } else {
    // Вершины бугров — эмаль толще, светлее
    const tip = smoothstep(0.85, 1.05, t) * 0.5
    r += (0.97 - r) * tip; g += (0.95 - g) * tip; b += (0.9 - b) * tip
  }
  // Корень — цемент
  const cr = 0.84, cg = 0.72, cb = 0.52
  out[o] = lin(cr + (r - cr) * enamel)
  out[o + 1] = lin(cg + (g - cg) * enamel)
  out[o + 2] = lin(cb + (b - cb) * enamel)
}

/**
 * Сетки форм с цветом по вершинам (см. toothColor) и AO (мешер).
 * Шаг крупнее, чем у разреза: зуб на дуге маленький.
 */
export function buildJawShapes(step = 0.03): [JawShape, MeshData][] {
  return (Object.keys(SHAPES) as JawShape[]).map((name) => {
    const g = makeGrid([-0.75, -2.2, -0.75], [0.75, 1.2, 0.75], step)
    const mesh = surfaceNets(g, sample(g, SHAPES[name]))
    const colors = new Float32Array(mesh.positions.length)
    for (let v = 0; v < mesh.positions.length; v += 3) toothColor(name, mesh.positions[v]!, mesh.positions[v + 1]!, mesh.positions[v + 2]!, colors, v)
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

/**
 * Где стоит зуб: позиция (в единицах модели), поворот вокруг вертикали, масштаб, зеркально ли,
 * и собственные наклоны зуба: tip — мезио-дистальный (коронкой к середине дуги), torque — губно-язычный
 * (коронкой к губе/щеке). Живые зубы стоят не по линейке: резцы наклонены вперёд, нижние моляры —
 * к языку, а «кривая Шпее» опускает премоляры. Плюс небольшой разброс у каждого зуба (свой поворот,
 * размер) — чтобы зубы не были одинаковыми клонами.
 */
export interface Placement {
  x: number
  y: number
  z: number
  rotY: number
  scale: number
  upper: boolean
  /** Высота шейки (граница эмали и цемента) над/под плоскостью смыкания — для десны. */
  neckY: number
  /** Зеркалить форму по x: у формы +x — дистально, а с правой и левой стороны «дистально» в разные стороны. */
  mirror: boolean
  tip: number
  torque: number
  /** Небольшой поворот вокруг своей оси (разброс). */
  twist: number
}

const MM = 1 / 9
/** Расстояние между челюстями (рот приоткрыт): видно и верхние, и нижние зубы. */
export const JAW_GAP = 0.45

const DEG = Math.PI / 180
/** Наклоны по типам (градусы), как в учебниках ортодонтии: [tip, torque] — верх и низ. */
const ANGLES: Record<'upper' | 'lower', readonly (readonly [number, number])[]> = {
  upper: [[5, 14], [8, 10], [9, 3], [2, -4], [2, -4], [0, -5], [0, -6], [0, -6]],
  lower: [[2, 6], [2, 5], [5, -2], [1, -5], [1, -6], [0, -8], [0, -9], [0, -9]],
}

/** Детерминированный «случай» по номеру зуба: −1…1, всегда один и тот же. */
function jitter(fdi: number, salt: number): number {
  const s = Math.sin(fdi * 12.9898 + salt * 78.233) * 43758.5453
  return (s - Math.floor(s)) * 2 - 1
}

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
  const scale = ((w * MM) / SHAPE_WIDTH[shape]) * (1 + 0.025 * jitter(fdi, 1))
  const side = isPatientRight(fdi) ? -1 : 1
  // Кончики коронок — на плоскости смыкания; кривая Шпее: премоляры ниже на ~1,3 мм
  const spee = -1.3 * Math.exp(-(((s - 22) / 12) ** 2)) * MM
  const crownH = CROWN_H[shape] * scale
  const y = upper ? JAW_GAP + crownH + spee : -JAW_GAP - crownH + spee
  const [tip, torque] = ANGLES[upper ? 'upper' : 'lower'][n - 1]!
  return {
    x: side * a.x * MM,
    y,
    z: (a.z + (upper ? 0 : -1.2)) * MM,
    rotY: side * Math.atan2(-a.tz, a.tx),
    scale,
    upper,
    neckY: y,
    mirror: upper ? side === 1 : side === -1,
    tip: (tip + 1.5 * jitter(fdi, 2)) * DEG,
    torque: (torque + 1.5 * jitter(fdi, 3)) * DEG,
    twist: 3 * jitter(fdi, 4) * DEG,
  }
}

/** Точка над коронкой выделенного зуба — для метки с номером. */
export function toothTip(fdi: number): [number, number, number] {
  const p = toothPlacement(fdi)
  const tip = (CROWN_H[shapeOf(fdi)] + 0.1) * p.scale
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
