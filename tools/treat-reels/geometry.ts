/**
 * Геометрия крупного плана «один моляр в десне» для рилсов о лечении. Берём готовые поля расстояний атласа
 * (src/atlas/geometry: коронка и корни нижнего моляра 36, формы соседей из jawModel) и строим из них
 * сетки по стадиям лечения — заранее, один раз при запуске страницы:
 *
 * - зуб по стадиям препарирования: полость «съедает» коронку шаг за шагом (SDF-вычитание растущего тела),
 *   цвет по вершинам: эмаль, дентин в стенках полости, кариес (тёмный в дентине, меловой ободок на эмали);
 * - слои композита (плоский верх на своей высоте), последний — с излишком, после полировки — точная форма;
 * - гель протравки и плёнка бонда в полости;
 * - соседние зубы и десна с сосочками между зубами.
 *
 * Единица — около 9 мм (как в атласе), ось y вверх, шейка моляра на y = 0, +x — дистально, +z — к щеке.
 */
import { makeGrid, sample, surfaceNets, type Grid, type MeshData } from '../../src/atlas/geometry/mesher'
import { SHAPES } from '../../src/atlas/geometry/jawModel'
import { clamp01, sdEllipsoid, sdRoundBox, smax, smin, smoothstep } from '../../src/atlas/geometry/sdf'
import { crownOuter, groove, rootOuter } from '../../src/atlas/geometry/toothModel'

const lin = (c: number) => c ** 2.2
const mix = (a: number, b: number, t: number) => a + (b - a) * t

/** Весь моляр (коронка + корни) и дентин под эмалью — как в toothModel. */
const toothT = (x: number, y: number, z: number) => smin(crownOuter(x, y, z), rootOuter(x, y, z), 0.12)
const enamelThickness = (y: number) => 0.13 * smoothstep(-0.02, 0.38, y)
const dentinCore = (x: number, y: number, z: number) => crownOuter(x, y, z) + enamelThickness(y)

/**
 * Полость под пломбу (I класс по Блэку — жевательная поверхность): вытянута вдоль центральной фиссуры,
 * дно в дентине на y ≈ 0,38 (над рогами пульпы), стенки почти отвесные, углы скруглены.
 */
export function cavity(x: number, y: number, z: number): number {
  const body = sdRoundBox(x - 0.01, y - 0.86, z, 0.27, 0.48, 0.125, 0.09)
  // Продолжение в щёчную бороздку — маленький «язычок», как при настоящем препарировании по фиссурам
  const buccal = sdRoundBox(x + 0.1, y - 0.92, z - 0.15, 0.06, 0.46, 0.08, 0.05)
  return smin(body, buccal, 0.05)
}
/** Центр полости на поверхности (сюда смотрит камера и приходят инструменты). */
export const CAVITY_TOP: [number, number, number] = [0.0, 0.56, 0.0]
export const CAVITY_FLOOR = 0.38

/** Полость на стадии s ∈ [0, 1]: снизу растёт эллипсоид «выборки» и в конце совпадает с полостью. */
function cavityAt(s: number, x: number, y: number, z: number): number {
  if (s >= 1) return cavity(x, y, z)
  const e = s * s * (3 - 2 * s)
  const reach = sdEllipsoid(x - 0.02 + 0.06 * (1 - e), y - 0.95, z, 0.05 + 0.6 * e, 0.36 + 0.26 * e, 0.04 + 0.28 * e)
  return Math.max(cavity(x, y, z), reach)
}

/**
 * Кариес: снаружи — узкая тёмная точка в фиссуре с меловым ободком, внутри по дентину расходится шире
 * (типичная «скрытая» полость). Целиком помещается в полость — после препарирования его не остаётся.
 */
function caries(x: number, y: number, z: number): number {
  const dentinPart = sdEllipsoid(x - 0.03, y - 0.48, z, 0.19, 0.075, 0.095)
  const enamelPart = sdEllipsoid(x - 0.02, y - 0.57, z, 0.07, 0.13, 0.045)
  return smin(dentinPart, enamelPart, 0.04)
}

/** Цвет моляра по вершине: эмаль (тёплая шейка, светлые бугры), дентин в стенках полости, кариес. */
function molarColor(x: number, y: number, z: number, cariesOn: boolean, out: Float32Array, o: number): void {
  // Эмаль (как toothColor в jawModel: шейка просвечивает дентином, вершины бугров светлее)
  const t = clamp01(y / 0.78)
  let r = 0.935, g = 0.915, b = 0.86
  const neck = 1 - smoothstep(0.0, 0.34, t)
  r = mix(r, 0.9, neck); g = mix(g, 0.82, neck); b = mix(b, 0.66, neck)
  const tip = smoothstep(0.82, 1.02, t) * 0.5
  r = mix(r, 0.97, tip); g = mix(g, 0.955, tip); b = mix(b, 0.91, tip)
  // Естественная пигментация фиссур (у взрослых бороздки чуть темнее)
  const fis = Math.min(1, (groove(x, z, -0.42, 0.0, -0.12, 0.02, 1, 0.02) + groove(x, z, -0.12, 0.02, 0.18, -0.01, 1, 0.02) + groove(x, z, 0.18, -0.01, 0.42, 0.02, 1, 0.02)) * smoothstep(0.45, 0.6, y))
  // После пломбы бороздки в её границах чистые: композит без пигмента
  const pig = cariesOn ? 0.3 : 0.3 * smoothstep(-0.01, 0.04, cavity(x, y, z))
  r = mix(r, 0.74, fis * pig); g = mix(g, 0.64, fis * pig); b = mix(b, 0.5, fis * pig)
  // Стенки полости: глубже эмали — дентин (сливочно-жёлтый), на срезе эмали — светлый ободок
  const d = dentinCore(x, y, z)
  const inDentin = smoothstep(0.012, -0.012, d)
  r = mix(r, 0.87, inDentin); g = mix(g, 0.72, inDentin); b = mix(b, 0.48, inDentin)
  // Глубина полости (точка внутри исходного зуба — это срез бором): стенки и дно в тени (свет и рассеянный, и прямой туда заходит хуже) — видно, что это ямка
  const inCav = smoothstep(-0.004, -0.03, toothT(x, y, z)) * (0.45 + 0.55 * smoothstep(0.8, 0.4, y))
  r *= 1 - 0.3 * inCav; g *= 1 - 0.34 * inCav; b *= 1 - 0.4 * inCav
  if (cariesOn) {
    const c = caries(x, y, z)
    // Меловое пятно вокруг (деминерализация) и тёмный кариес в середине
    const halo = smoothstep(0.05, 0.0, c) * (1 - smoothstep(0.0, -0.02, c))
    r = mix(r, 0.97, halo * 0.6); g = mix(g, 0.95, halo * 0.6); b = mix(b, 0.9, halo * 0.6)
    const k = smoothstep(0.004, -0.02, c)
    const deep = smoothstep(0.52, 0.42, y) // в глубине — светлее и коричневее (мягкий дентин)
    r = mix(r, mix(0.2, 0.42, deep), k); g = mix(g, mix(0.12, 0.27, deep), k); b = mix(b, mix(0.07, 0.14, deep), k)
  }
  out[o] = lin(r); out[o + 1] = lin(g); out[o + 2] = lin(b)
}

/** Цвет по вершинам; впадины (AO из мешера) темнее и теплее — фиссуры и щели читаются, как на макрофото. */
function paint(mesh: MeshData, fn: (x: number, y: number, z: number, out: Float32Array, o: number) => void, aoTint = 0.35): MeshData {
  const colors = new Float32Array(mesh.positions.length)
  for (let v = 0; v < mesh.positions.length; v += 3) {
    fn(mesh.positions[v]!, mesh.positions[v + 1]!, mesh.positions[v + 2]!, colors, v)
    const a = mesh.ao ? mesh.ao[v / 3]! : 1
    const k = 1 - aoTint * (1 - a)
    colors[v] = colors[v]! * k
    colors[v + 1] = colors[v + 1]! * k * k
    colors[v + 2] = colors[v + 2]! * k * k * k
  }
  mesh.colors = colors
  return mesh
}

/** Соседи: премоляр 35 (мезиально) и второй моляр 37 (дистально) — на своих местах дуги. */
export const NEIGHBOURS = [
  { shape: 'premolarLower', x: -0.9, y: -0.06, s: 0.98 },
  { shape: 'molarLower', x: 1.07, y: 0.0, s: 0.93 },
] as const
const neighbourField = (i: number, x: number, y: number, z: number) => {
  const n = NEIGHBOURS[i]!
  return SHAPES[n.shape]((x - n.x) / n.s, (y - n.y) / n.s, z / n.s) * n.s
}

function neighbourColor(x: number, y: number, z: number, out: Float32Array, o: number, n: (typeof NEIGHBOURS)[number]): void {
  const ly = (y - n.y) / n.s
  const t = clamp01(ly / 0.8)
  let r = 0.93, g = 0.91, b = 0.855
  const neck = 1 - smoothstep(0.0, 0.34, t)
  r = mix(r, 0.9, neck); g = mix(g, 0.82, neck); b = mix(b, 0.66, neck)
  const lx = (x - n.x) / n.s
  const fis = n.shape === 'molarLower'
    ? Math.min(1, groove(lx, z, -0.42, 0, 0.42, 0.01, 1, 0.025)) * smoothstep(0.4, 0.58, ly)
    : Math.min(1, groove(lx, z, -0.2, -0.01, 0.2, -0.01, 1, 0.025)) * smoothstep(0.45, 0.6, ly)
  r = mix(r, 0.7, fis * 0.5); g = mix(g, 0.6, fis * 0.5); b = mix(b, 0.46, fis * 0.5)
  out[o] = lin(r); out[o + 1] = lin(g); out[o + 2] = lin(b)
}

/** Овал вокруг шейки зуба: 0 у самой шейки, растёт наружу (как neckCollar в toothModel). */
function collar(x: number, z: number): number {
  let c = (Math.hypot(x / 0.56, z / 0.47) - 1) * 0.5
  c = Math.min(c, (Math.hypot((x - NEIGHBOURS[0].x) / 0.34, z / 0.38) - 1) * 0.35)
  c = Math.min(c, (Math.hypot((x - NEIGHBOURS[1].x) / 0.52, z / 0.44) - 1) * 0.5)
  return c
}

/** Десна: альвеолярный гребень вдоль дуги, у шеек поднимается (десневой край), между зубами — сосочки. */
function gumField(x: number, y: number, z: number, teeth: number): number {
  // Гребень по ширине шеек: от края десны склоны сразу уходят вниз (к щеке и к языку)
  const ridge = sdRoundBox(0, y + 0.7, z + 0.02, 10, 1.0, 0.6, 0.5)
  const top = -0.3 + 0.42 * Math.exp(-Math.max(collar(x, z), 0) * 4.5)
  const ends = Math.abs(x - 0.1) - 2.25
  return Math.max(smax(ridge, y - top, 0.1), ends, -(teeth + 0.004))
}

function gumColor(x: number, y: number, z: number, out: Float32Array, o: number): void {
  // Прикреплённая десна — бледно-коралловая, у края светлее; ниже (слизистая) — краснее
  const margin = Math.exp(-Math.max(collar(x, z), 0) * 9)
  const low = smoothstep(-0.3, -0.8, y)
  let r = 0.8, g = 0.47, b = 0.48
  r = mix(r, 0.86, margin * 0.5); g = mix(g, 0.56, margin * 0.5); b = mix(b, 0.56, margin * 0.5)
  r = mix(r, 0.66, low); g = mix(g, 0.24, low); b = mix(b, 0.28, low)
  out[o] = lin(r); out[o + 1] = lin(g); out[o + 2] = lin(b)
}

export interface TreatMeshes {
  /** Зуб по стадиям препарирования: 0 — целый с кариесом, последний — чистая полость. */
  toothStages: MeshData[]
  /** Целый зуб без кариеса (финал, «после» — пломба в цвет зуба). */
  toothHealthy: MeshData
  /** Слои композита: подстадии по возрастанию уровня. */
  layers: MeshData[]
  layerLevels: number[]
  /** Последний слой с излишком (до полировки) и точная форма (после). */
  fillRough: MeshData
  fillFinal: MeshData
  gel: MeshData[]
  bond: MeshData
  neighbours: MeshData[]
  gum: MeshData
}

/** Построить всё. stages — число стадий препарирования; step — шаг сетки зуба. */
export function buildTreatMeshes(opts: { stages?: number; step?: number } = {}): TreatMeshes {
  const stages = opts.stages ?? 16
  const h = opts.step ?? 0.012
  // Зуб — только то, что над десной: ниже y = −0,3 не видно
  const gT = makeGrid([-0.72, -0.32, -0.62], [0.72, 0.96, 0.62], h)
  const T = sample(gT, toothT)
  const toothStages: MeshData[] = []
  for (let i = 0; i < stages; i++) {
    const s = i / (stages - 1)
    const f = i === 0 ? T : sample(gT, (x, y, z, n) => Math.max(T[n]!, -cavityAt(s, x, y, z)))
    toothStages.push(paint(surfaceNets(gT, f), (x, y, z, out, o) => molarColor(x, y, z, true, out, o)))
  }
  const toothHealthy = paint(surfaceNets(gT, T), (x, y, z, out, o) => molarColor(x, y, z, false, out, o))

  // Мелкая сетка над полостью: композит, гель, бонд
  const gC = makeGrid([-0.42, 0.32, -0.34], [0.42, 0.98, 0.36], 0.008)
  const TC = sample(gC, toothT)
  const CAV = sample(gC, cavity)
  const levels: number[] = []
  for (const [a, b] of [[CAVITY_FLOOR, 0.5], [0.5, 0.6], [0.6, 0.7]] as const) for (let k = 1; k <= 4; k++) levels.push(a + ((b - a) * k) / 4)
  const layer = (lvl: number) => surfaceNets(gC, sample(gC, (_x, y, _z, n) => Math.max(TC[n]!, CAV[n]! - 0.006, y - lvl)))
  const layers = levels.map(layer)
  const colorFill = (m: MeshData) => paint(m, (x, y, z, out, o) => molarColor(x, y, z, false, out, o))
  const fillRough = colorFill(surfaceNets(gC, sample(gC, (_x, _y, _z, n) => Math.max(TC[n]! - 0.016, CAV[n]! - 0.035))))
  const fillFinal = colorFill(surfaceNets(gC, sample(gC, (_x, _y, _z, n) => Math.max(TC[n]!, CAV[n]! - 0.006))))
  const gel = [0.5, 0.58, 0.66, 0.8].map((lvl) => surfaceNets(gC, sample(gC, (x, y, z, n) =>
    Math.max(TC[n]! - 0.03 - 0.012 * Math.sin(x * 37 + z * 23) * Math.sin(z * 31 - x * 11), CAV[n]! - 0.045, y - lvl))))
  // Бонд: тонкая плёнка поверх стенок полости (зуб с полостью, раздутый на 0,012)
  const bond = surfaceNets(gC, sample(gC, (_x, _y, _z, n) => Math.max(Math.max(TC[n]!, -CAV[n]!) - 0.012, CAV[n]! - 0.02)))

  // Соседи
  const neighbours = NEIGHBOURS.map((n, i) => {
    const g = makeGrid([n.x - 0.72 * n.s, -0.32, -0.62], [n.x + 0.72 * n.s, 1.0, 0.62], 0.016)
    return paint(surfaceNets(g, sample(g, (x, y, z) => neighbourField(i, x, y, z))), (x, y, z, out, o) => neighbourColor(x, y, z, out, o, n))
  })

  // Десна: вычитаем все три зуба
  const gG: Grid = makeGrid([-2.25, -1.6, -0.9], [2.45, 0.24, 0.9], 0.02)
  const gum = paint(surfaceNets(gG, sample(gG, (x, y, z) => {
    const teeth = Math.min(toothT(x, y, z), neighbourField(0, x, y, z), neighbourField(1, x, y, z))
    return gumField(x, y, z, teeth)
  })), gumColor)

  return { toothStages, toothHealthy, layers, layerLevels: levels, fillRough, fillFinal, gel, bond, neighbours, gum }
}
