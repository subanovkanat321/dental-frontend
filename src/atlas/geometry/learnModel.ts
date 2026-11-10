import { CROWN_H, SHAPES, toothColor, type JawShape } from './jawModel'
import { makeGrid, sample, surfaceNets, type Grid, type MeshData } from './mesher'
import { sdEllipsoid, sdRoot, sdRoundBox, smax, smin, smoothstep } from './sdf'
import {
  boneBox, canals, cariesBlob, cementThickness, crownOuter, cut, CUT_X, enamelThickness, gumBox, hill, inToothBox, lowerMolarGrooves,
  lowerMolarTop, molarBody, neckCollar, prep, pulp, rootOuter, TOOTH_STEP, toothBoxDistance,
} from './toothModel'

/**
 * Состояния зуба для презентаций «Для пациента» (src/learn) — сверх режимов атласа: камень и налёт,
 * воспалённая десна и убыль кости, погибший нерв и воспаление у корня, трещины и скол, герметик, белое
 * пятно, лунка и её заживление, молочный зуб с зачатком постоянного, зуб мудрости и пустое место.
 *
 * Те же поля расстояний и тот же мешер, что у атласа (toothModel, jawModel): единица ~9 мм, шейка на y = 0,
 * разрез «четверть убрана» — те же плоскости. Сцены снимает только служебная страница tools/learn-art
 * (scripts/learn-art.mjs) — в сборку CRM этот файл не входит. Чистый TypeScript без three.js: сетки
 * проверяют тесты.
 */

export type SectionId =
  | 'plaque' | 'tartar' | 'gingivitis' | 'tartar-below' | 'perio' | 'perio-severe'
  | 'pulp-dead' | 'abscess' | 'spot' | 'crack-line' | 'crack-chip' | 'crack-split' | 'sealant'
  | 'socket' | 'kid' | 'kid-caries' | 'kid-deep' | 'kid-lost'
export type SegmentId = 'wisdom-tilt' | 'wisdom-half' | 'wisdom-decay' | 'gap-1' | 'gap-2' | 'gap-3'
export type LearnGeoId = SectionId | SegmentId
/** Сцена кадра: состояние зуба или улыбка, шкала оттенков, ролики (заживление лунки, герметик, отбеливание). */
export type LearnId = LearnGeoId | 'whiten-split' | 'whiten' | 'shades' | 'socket-heal' | 'sealant-apply'

/** Материал сетки — его выбирает сцена (engine/learnScene.ts). */
export type LearnMat =
  | 'enamel' | 'dentin' | 'pulp' | 'cementum' | 'pdl' | 'cortical' | 'spongy' | 'gum' | 'caries' | 'spot' | 'tartar' | 'tartarDeep'
  | 'plaque' | 'lesion' | 'sealant' | 'filling' | 'gutta' | 'clot' | 'newBone' | 'tooth' | 'kidEnamel' | 'germPulp' | 'follicle'

export interface LearnMesh {
  name: string
  mat: LearnMat
  mesh: MeshData
}

type Vec = [number, number, number]

// ——— Шум: неровные края камня, налёта, скола (детерминированный — кадр одинаковый при каждой съёмке) ———

function hash3(i: number, j: number, k: number): number {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(k, 1274126177)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** Гладкий шум 0..1 (value noise). */
export function noise3(x: number, y: number, z: number): number {
  const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z)
  const fx = x - i, fy = y - j, fz = z - k
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz)
  const l = (a: number, b: number, t: number) => a + (b - a) * t
  return l(
    l(l(hash3(i, j, k), hash3(i + 1, j, k), u), l(hash3(i, j + 1, k), hash3(i + 1, j + 1, k), u), v),
    l(l(hash3(i, j, k + 1), hash3(i + 1, j, k + 1), u), l(hash3(i, j + 1, k + 1), hash3(i + 1, j + 1, k + 1), u), v),
    w,
  )
}
const fbm = (x: number, y: number, z: number, f: number) => (noise3(x * f, y * f, z * f) * 2 + noise3(x * f * 2.1 + 5, y * f * 2.1, z * f * 2.1) + 0.5 * noise3(x * f * 4.3, y * f * 4.3 + 3, z * f * 4.3)) / 3.5

/** Полоса по высоте: 1 между lo и hi, мягкие края. */
const band = (y: number, lo: number, hi: number, soft = 0.05) => smoothstep(lo - soft, lo + soft, y) * (1 - smoothstep(hi - soft, hi + soft, y))

/**
 * Цвет десны по вершинам — множитель к цвету материала: 0 — здоровая розовая, 1 — воспалённая (краснее,
 * темнее). У воспаления цвет меняется у края, к переходной складке — меньше.
 */
export function tintGum(m: MeshData, red: (x: number, y: number, z: number) => number): MeshData {
  m.colors = new Float32Array(m.positions.length)
  for (let v = 0; v < m.positions.length; v += 3) {
    const k = Math.min(1, Math.max(0, red(m.positions[v]!, m.positions[v + 1]!, m.positions[v + 2]!)))
    m.colors[v] = 1 - 0.2 * k
    m.colors[v + 1] = 1 - 0.8 * k
    m.colors[v + 2] = 1 - 0.75 * k
  }
  return m
}

// ——— Зуб в разрезе (как в атласе) с состояниями ———

interface SectionOpts {
  caries?: number
  restoration?: boolean
  chip?: boolean
  sealant?: boolean
  spot?: boolean
  deposit?: 'plaque' | 'above' | 'below'
  swollen?: boolean
  /** Убыль кости: 0 — норма, 1 — до середины корня. */
  boneLoss?: number
  lesion?: boolean
  whole?: boolean
}

const SECTION: Record<Exclude<SectionId, 'socket' | 'kid' | 'kid-caries' | 'kid-deep' | 'kid-lost'>, SectionOpts> = {
  plaque: { deposit: 'plaque' },
  tartar: { deposit: 'above' },
  gingivitis: { deposit: 'above', swollen: true },
  'tartar-below': { deposit: 'below', swollen: true },
  perio: { deposit: 'below', swollen: true, boneLoss: 0.45 },
  'perio-severe': { deposit: 'below', swollen: true, boneLoss: 1 },
  'pulp-dead': { caries: 3 },
  abscess: { caries: 3, lesion: true },
  spot: { spot: true },
  'crack-line': { restoration: true },
  'crack-chip': { restoration: true, chip: true },
  'crack-split': { restoration: true },
  sealant: { sealant: true, whole: true },
}

/** Верх кости (альвеолярный гребень) у здорового зуба — верх boneBox. */
export const BONE_TOP = -0.22

/** Гребень кости: при убыли он ниже, у самого зуба — ещё ниже (воронкой). */
export function boneCrest(x: number, z: number, loss: number): number {
  const near = Math.exp(-Math.max(neckCollar(x, z), 0) * 5)
  return BONE_TOP - loss * (0.42 + 0.38 * near)
}
/** Кость с гребнем crest. */
export const boneAt = (x: number, y: number, z: number, loss: number) => (loss ? smax(boneBox(x, y, z), y - boneCrest(x, z, loss), 0.06) : boneBox(x, y, z))

/** Край десны: у зуба выше (десневой край), отёк — ещё выше и толще; убыль кости — десна опускается (рецессия). */
export function gumTop(x: number, z: number, o: { swollen?: boolean; boneLoss?: number } = {}): number {
  const c = Math.max(neckCollar(x, z), 0)
  const near = Math.exp(-c * 7)
  let top = -0.04 + 0.16 * near
  if (o.swollen) top += 0.05 * Math.exp(-c * 4)
  if (o.boneLoss) top -= o.boneLoss * (0.3 + 0.3 * Math.exp(-c * 4))
  return top
}

/** Камень: высота полосы на зубе и толщина (между зубами — толще). */
function tartarThickness(x: number, y: number, z: number, lo: number, hi: number): number {
  const b = band(y, lo, hi, 0.045)
  // Только у самого зуба: дальше — край коробки зуба, там поле не расстояние до зуба
  if (b <= 0 || (x / 0.74) ** 2 + (z / 0.62) ** 2 > 1) return 0
  const prox = (x * x) / (x * x + z * z + 1e-6)
  return 0.085 * b * (0.35 + 1.1 * fbm(x, y, z, 7)) * (0.8 + 0.8 * prox)
}

/** Скол: убранная часть дистально-язычного бугра — неровная плоскость (положительно — убрано). */
export function chipCut(x: number, y: number, z: number): number {
  const n = [0.72, 0.68, 0.12] as const
  const d = (x - 0.25) * n[0] + (y - 0.52) * n[1] + (z + 0.1) * n[2]
  return d + 0.06 * (fbm(x, y, z, 7) - 0.5)
}

/** Белое пятно (начальный кариес) на жевательной поверхности у фиссуры — там его видно на кадре, неровное. */
const spotBlob = (x: number, y: number, z: number) => sdEllipsoid(x - 0.14, y - 0.8, z + 0.17, 0.3, 0.24, 0.22) + 0.04 * (fbm(x, y, z, 10) - 0.5)

/** Очаг воспаления у верхушек корней (периапикальный): «размытый» шар в кости. */
export const lesionBlob = (x: number, y: number, z: number) =>
  Math.min(sdEllipsoid(x - 0.4, y + 1.9, z, 0.27, 0.25, 0.24), sdEllipsoid(x + 0.3, y + 2.0, z, 0.2, 0.18, 0.2)) + 0.04 * (fbm(x, y, z, 6) - 0.5)

/** Герметик: фиссуры залиты почти доверху, капля сверху; где фиссур нет — пусто. */
function sealantField(x: number, y: number, z: number): number {
  const g = lowerMolarGrooves(x, z)
  if (g < 0.012) return 0.05
  const filled = smax(molarBody(x, y, z), (y - (0.3 + 0.75 * (lowerMolarTop(x, z) + g * 0.95) + 0.012)) * 0.55, 0.06)
  return Math.max(filled, -crownOuter(x, y, z), 0.018 - g)
}

function sectionGrids(step: number) {
  return {
    gT: makeGrid([-0.8, -2.1, -0.7], [0.8, 1.02, 0.7], step),
    gG: makeGrid([-1.16, -1.2, -0.8], [1.16, 0.36, 0.8], step * 1.25),
    gB: makeGrid([-1.16, -2.36, -0.8], [1.16, 0.0, 0.8], step * 1.75),
  }
}

/** Зуб в разрезе: все сетки состояния. */
function buildSection(id: keyof typeof SECTION, step: number): LearnMesh[] {
  const o = SECTION[id]
  const { gT, gG, gB } = sectionGrids(step)
  const loss = o.boneLoss ?? 0
  // Целый зуб без разреза (герметик: вся жевательная поверхность сверху, как во рту)
  const cutF = o.whole ? () => -1 : cut
  const crownF = (x: number, y: number, z: number) => (inToothBox(x, y, z) ? crownOuter(x, y, z) : toothBoxDistance(x, y, z))
  const rootF = (x: number, y: number, z: number) => (inToothBox(x, y, z) ? rootOuter(x, y, z) : toothBoxDistance(x, y, z))
  const toothF = (x: number, y: number, z: number) => smin(crownF(x, y, z), rootF(x, y, z), 0.12)
  // Скол: где chipCut > 0, ткани нет (max с полем убирает её)
  const chip = o.chip ? chipCut : () => -1

  const C = sample(gT, crownF)
  const R = sample(gT, rootF)
  const T = sample(gT, (x, y, z, n) => Math.max(smin(C[n]!, R[n]!, 0.12), chip(x, y, z)))
  const P = sample(gT, (x, y, z) => (inToothBox(x, y, z) ? pulp(x, y, z) : 1))
  const DT = sample(gT, (_x, y, _z, n) => smin(C[n]! + enamelThickness(y), R[n]! + cementThickness(y), 0.1))
  const out: LearnMesh[] = []
  const add = (name: string, mat: LearnMat, mesh: MeshData) => { if (mesh.indices.length) out.push({ name, mat, mesh }) }
  const mesh = (g: Grid, f: (x: number, y: number, z: number, n: number) => number, uvScale?: number) => surfaceNets(g, sample(g, f), uvScale ? { uvScale } : {})

  // Полость: кариес (как в атласе) или препарирование под большую пломбу; при пломбе пульпа — в каналах гуттаперча
  const caries = o.caries != null ? (x: number, y: number, z: number) => cariesBlob(o.caries!, x, y, z) : () => 1
  const hole = o.restoration ? (x: number, y: number, z: number, n: number) => Math.min(prep(x, y, z), Math.max(P[n]!, 0.02 - y)) : () => 1
  add('enamel', 'enamel', mesh(gT, (x, y, z, n) => Math.max(T[n]!, -DT[n]!, -(y + 0.03), cutF(x, z), -hole(x, y, z, n))))
  add('dentin', 'dentin', mesh(gT, (x, y, z, n) => Math.max(DT[n]!, -P[n]!, cutF(x, z), chip(x, y, z), -hole(x, y, z, n))))
  if (o.restoration) {
    add('filling', 'filling', mesh(gT, (x, y, z, n) => Math.max(T[n]!, hole(x, y, z, n), cutF(x, z))))
    add('gutta', 'gutta', mesh(gT, (x, y, z) => Math.max(canals(x, y, z), y - 0.02, cutF(x, z))))
  } else add('pulp', 'pulp', mesh(gT, (x, _y, z, n) => Math.max(P[n]!, cutF(x, z))))
  add('cementum', 'cementum', mesh(gT, (x, y, z, n) => Math.max(T[n]!, -DT[n]!, y + 0.03, cutF(x, z))))
  if (o.caries != null) add('caries', 'caries', mesh(gT, (x, y, z, n) => Math.max(T[n]!, caries(x, y, z), -P[n]!, cutF(x, z))))
  if (o.spot) {
    add('spot', 'spot', mesh(gT, (x, y, z, n) => Math.max(T[n]!, spotBlob(x, y, z), -(T[n]! + 0.035), cutF(x, z))))
    // И в фиссуре, как в атласе: пятно стадии 0, но заметнее
    add('spot2', 'spot', mesh(gT, (x, y, z, n) => Math.max(T[n]!, cariesBlob(0, x, y, z) - 0.02, -P[n]!, cutF(x, z))))
  }
  if (o.sealant) add('sealant', 'sealant', mesh(gT, (x, y, z) => Math.max(sealantField(x, y, z), cutF(x, z))))

  // Налёт и камень: тонкий слой поверх зуба у шейки, бугристый; под десной — тёмный
  const gumAt = (x: number, z: number) => gumTop(x, z, o)
  if (o.deposit === 'plaque') {
    add('plaque', 'plaque', mesh(gT, (x, y, z, n) => {
      const th = (x / 0.72) ** 2 + (z / 0.6) ** 2 > 1 ? 0 : 0.05 * band(y, 0.08, 0.55, 0.06) * (0.5 + 0.9 * fbm(x, y, z, 5))
      return Math.max(T[n]! - th, -T[n]!, cutF(x, z))
    }))
  } else if (o.deposit) {
    const lo = o.deposit === 'below' ? -0.24 - loss * 0.6 : 0.06
    // Под десной камень тоньше и темнее (пропитан кровью)
    const th = (x: number, y: number, z: number) => tartarThickness(x, y, z, lo, 0.3) * (y < gumAt(x, z) - 0.03 ? 0.6 : 1)
    add('tartar', 'tartar', mesh(gT, (x, y, z, n) => Math.max(T[n]! - th(x, y, z), -T[n]!, cutF(x, z), gumAt(x, z) - 0.03 - y)))
    if (o.deposit === 'below') add('tartarDeep', 'tartarDeep', mesh(gT, (x, y, z, n) => Math.max(T[n]! - th(x, y, z), -T[n]!, cutF(x, z), y - (gumAt(x, z) - 0.03))))
  }

  // Связка, кость, десна
  const Rb = sample(gB, rootF)
  const bone = (x: number, y: number, z: number) => boneAt(x, y, z, loss)
  add('pdl', 'pdl', mesh(gT, (x, y, z, n) => Math.max(R[n]! - 0.075, -R[n]!, bone(x, y, z) - 0.01, cutF(x, z))))
  const lesion = o.lesion ? lesionBlob : () => 1
  const H = sample(gB, (x, y, z, n) => Math.min(Rb[n]! - 0.065, lesion(x, y, z)))
  const spongy = sample(gB, (x, y, z, n) => Math.max(bone(x, y, z) + 0.075, -(H[n]! - 0.045)))
  add('cortical', 'cortical', mesh(gB, (x, y, z, n) => Math.max(bone(x, y, z), -H[n]!, -spongy[n]!, cutF(x, z))))
  add('spongy', 'spongy', mesh(gB, (x, _y, z, n) => Math.max(spongy[n]!, cutF(x, z)), 1.4))
  if (o.lesion) add('lesion', 'lesion', mesh(gB, (x, y, z, n) => Math.max(lesion(x, y, z), -(Rb[n]! - 0.01), cutF(x, z))))

  // Десна: при отёке — зазор (карман) между десной и зубом до прикрепления
  const Tg = sample(gG, toothF)
  const attach = o.deposit === 'below' ? -0.2 - loss * 0.6 : 0.02
  const pocket = (y: number) => (o.swollen ? 0.035 * smoothstep(attach - 0.04, attach + 0.06, y) : 0)
  const gum = mesh(gG, (x, y, z, n) => {
    const box = gumBox(x, y + loss * 0.55, z) - (o.swollen ? 0.025 * Math.exp(-Math.max(neckCollar(x, z), 0) * 3) : 0)
    return Math.max(smax(box, y - gumAt(x, z), 0.08), -bone(x, y, z), -(Tg[n]! + 0.004 - pocket(y)), cutF(x, z))
  })
  add('gum', 'gum', tintGum(gum, (x, _y, z) => (o.swollen ? 0.55 + 0.6 * Math.exp(-Math.max(neckCollar(x, z), 0) * 2.5) : 0)))
  return out
}

// ——— Лунка после удаления: сгусток → заживление ———

function buildSocket(step: number): LearnMesh[] {
  const { gT, gG, gB } = sectionGrids(step)
  const rootF = (x: number, y: number, z: number) => (inToothBox(x, y, z) ? rootOuter(x, y, z) : toothBoxDistance(x, y, z))
  const toothF = (x: number, y: number, z: number) => smin(inToothBox(x, y, z) ? crownOuter(x, y, z) : toothBoxDistance(x, y, z), rootF(x, y, z), 0.12)
  const out: LearnMesh[] = []
  const add = (name: string, mat: LearnMat, mesh: MeshData) => { if (mesh.indices.length) out.push({ name, mat, mesh }) }
  // Лунка — место корней (чуть шире), края гребня скруглены
  const socket = (x: number, y: number, z: number) => rootF(x, y, z) - 0.05
  const Hb = sample(gB, socket)
  const spongy = sample(gB, (x, y, z, n) => Math.max(boneBox(x, y, z) + 0.075, -(Hb[n]! - 0.045)))
  add('cortical', 'cortical', surfaceNets(gB, sample(gB, (x, y, z, n) => Math.max(boneBox(x, y, z), -Hb[n]!, -spongy[n]!, cut(x, z)))))
  add('spongy', 'spongy', surfaceNets(gB, sample(gB, (x, _y, z, n) => Math.max(spongy[n]!, cut(x, z))), { uvScale: 1.4 }))
  // Новая кость заполняет лунку снизу (ролик), чуть светлее
  add('newBone', 'newBone', surfaceNets(gB, sample(gB, (x, y, z, n) => Math.max(Hb[n]!, boneBox(x, y, z) + 0.01, cut(x, z))), { uvScale: 1.4 }))
  // Десна: кольцо вокруг лунки, «крышка» над ней — та же десна внутри отверстия (заживление)
  const healedTop = (x: number, z: number) => -0.04 + 0.1 * Math.exp(-Math.max(neckCollar(x, z), 0) * 7) - 0.07 * Math.exp(-(x * x + z * z) / 0.12)
  const Tg = sample(gG, toothF)
  const healed = (x: number, y: number, z: number) => Math.max(smax(gumBox(x, y, z), y - healedTop(x, z), 0.08), -boneBox(x, y, z), cut(x, z))
  const openTop = (x: number, z: number) => -0.04 + 0.12 * Math.exp(-Math.max(neckCollar(x, z), 0) * 7)
  // Свежая ранка — край десны чуть краснее
  const fresh = (x: number, _y: number, z: number) => 0.35 * Math.exp(-Math.max(neckCollar(x, z), 0) * 4)
  add('gum', 'gum', tintGum(surfaceNets(gG, sample(gG, (x, y, z, n) => Math.max(smax(gumBox(x, y, z), y - openTop(x, z), 0.08), -boneBox(x, y, z), -(Tg[n]! + 0.03), cut(x, z)))), fresh))
  add('gumCap', 'gum', tintGum(surfaceNets(gG, sample(gG, (x, y, z, n) => Math.max(healed(x, y, z), Tg[n]! + 0.03))), () => 0.1))
  // Сгусток: заполняет лунку и отверстие в десне, сверху — чуть вогнутый
  const Rt = sample(gT, socket)
  const Tt = sample(gT, toothF)
  add('clot', 'clot', surfaceNets(gT, sample(gT, (x, y, z, n) =>
    Math.max(Math.min(Rt[n]!, Tt[n]! + 0.03), y - (0.05 - 0.06 * Math.exp(-(x * x + z * z) / 0.08)) - 0.01 * fbm(x, y, z, 8), cut(x, z)))))
  return out
}

// ——— Молочный зуб и под ним зачаток постоянного ———

/** Молочный моляр — меньше (0,8), корни короче и разведены; между ними — зачаток постоянного. */
const KID_S = 0.8
const KID_MESIAL = [-0.24, -0.12, 0, 0.15, -0.38, -0.46, 0, 0.11, -0.45, -0.76, 0, 0.06] as const
const KID_DISTAL = [0.24, -0.12, 0, 0.15, 0.4, -0.44, 0, 0.11, 0.47, -0.72, 0, 0.06] as const
const KID_MESIAL_C = [-0.22, -0.05, 0, 0.06, -0.37, -0.46, 0, 0.04, -0.44, -0.76, 0, 0.015] as const
const KID_DISTAL_C = [0.22, -0.05, 0, 0.06, 0.39, -0.44, 0, 0.04, 0.46, -0.72, 0, 0.015] as const
/** Зачаток: шейка коронки премоляра (без корня) и наклон (у выпавшего раньше срока молочного — растёт криво). */
const GERM = { x: 0.0, y: -1.2, s: 0.8 }

function germLocal(x: number, y: number, z: number, tilt: number): Vec {
  const dx = x - GERM.x, dy = y - GERM.y - 0.3
  const c = Math.cos(-tilt), s = Math.sin(-tilt)
  return [(dx * c - dy * s) / GERM.s, (dx * s + dy * c + 0.3) / GERM.s, z / GERM.s]
}
/** Коронка зачатка (премоляр без корня). */
function germCrown(x: number, y: number, z: number, tilt: number): number {
  const [lx, ly, lz] = germLocal(x, y, z, tilt)
  return smax(SHAPES.premolarLower(lx, ly, lz), -ly - 0.02, 0.04) * GERM.s
}
/** Мешочек (фолликул) вокруг зачатка и костная «крипта» под ним. */
function germSac(x: number, y: number, z: number, tilt: number): number {
  const [lx, ly, lz] = germLocal(x, y, z, tilt)
  return smin(germCrown(x, y, z, tilt) - 0.06, sdEllipsoid(lx, ly - 0.25, lz, 0.4, 0.55, 0.42) * GERM.s, 0.12)
}

function kidCrown(x: number, y: number, z: number): number {
  return crownOuter(x / KID_S, y / KID_S, z / KID_S) * KID_S
}
function kidRoot(x: number, y: number, z: number, resorb: (x: number, y: number, z: number) => number): number {
  const trunk = sdRoundBox(x, y + 0.04, z, 0.34, 0.13, 0.3, 0.12)
  const zr = z * 0.85
  const roots = Math.max(Math.min(sdRoot(x, y, zr, KID_MESIAL), sdRoot(x, y, zr, KID_DISTAL)), -resorb(x, y, z))
  return smin(trunk, roots, 0.1)
}
function kidTooth(x: number, y: number, z: number, resorb: (x: number, y: number, z: number) => number): number {
  return smin(kidCrown(x, y, z), kidRoot(x, y, z, resorb), 0.1)
}
function kidPulp(x: number, y: number, z: number, resorb: (x: number, y: number, z: number) => number): number {
  // Пульпа у молочного зуба большая, рога высоко
  let d = sdRoundBox(x, y - 0.2, z, 0.22, 0.12, 0.17, 0.08)
  for (const [px, pz] of [[0.17, 0.11], [-0.17, 0.11], [0.17, -0.11], [-0.17, -0.11]] as const) d = smin(d, sdEllipsoid(x - px, y - 0.33, z - pz, 0.06, 0.09, 0.06), 0.1)
  const zc = z * 0.85
  const c = Math.max(Math.min(sdRoot(x, y, zc, KID_MESIAL_C), sdRoot(x, y, zc, KID_DISTAL_C)), -resorb(x, y, z))
  return smin(d, c, 0.08)
}

function buildKid(id: 'kid' | 'kid-caries' | 'kid-deep' | 'kid-lost', step: number): LearnMesh[] {
  const { gT, gG, gB } = sectionGrids(step)
  const lost = id === 'kid-lost'
  const tilt = lost ? 0.42 : 0
  const out: LearnMesh[] = []
  const add = (name: string, mat: LearnMat, mesh: MeshData) => { if (mesh.indices.length) out.push({ name, mat, mesh }) }
  const mesh = (g: Grid, f: (x: number, y: number, z: number, n: number) => number, uvScale?: number) => surfaceNets(g, sample(g, f), uvScale ? { uvScale } : {})
  const sac = (x: number, y: number, z: number) => germSac(x, y, z, tilt)
  // Корни молочного зуба рассасываются там, где растёт постоянный
  const resorb = (x: number, y: number, z: number) => sac(x, y, z) - 0.03
  const kidT = (x: number, y: number, z: number) => kidTooth(x, y, z, resorb)
  const enamelK = (y: number) => 0.075 * smoothstep(-0.02, 0.3, y)

  if (!lost) {
    const T = sample(gT, kidT)
    const P = sample(gT, (x, y, z) => kidPulp(x, y, z, resorb))
    const DT = sample(gT, (x, y, z) => smin(kidCrown(x, y, z) + enamelK(y), kidRoot(x, y, z, resorb) + 0.03 * (1 - smoothstep(-0.1, 0, y)), 0.08))
    add('enamel', 'kidEnamel', mesh(gT, (x, y, z, n) => Math.max(T[n]!, -DT[n]!, -(y + 0.03), cut(x, z))))
    add('dentin', 'dentin', mesh(gT, (x, _y, z, n) => Math.max(DT[n]!, -P[n]!, cut(x, z))))
    add('pulp', 'pulp', mesh(gT, (x, _y, z, n) => Math.max(P[n]!, cut(x, z))))
    add('cementum', 'cementum', mesh(gT, (x, y, z, n) => Math.max(T[n]!, -DT[n]!, y + 0.03, cut(x, z))))
    if (id !== 'kid') {
      const stage = id === 'kid-caries' ? 2 : 3
      add('caries', 'caries', mesh(gT, (x, y, z, n) => Math.max(T[n]!, cariesBlob(stage, x / KID_S, y / KID_S, z / KID_S) * KID_S, -P[n]!, cut(x, z))))
    }
  }
  // Зачаток постоянного: эмаль, тонкий дентин, внутри — розовая пульпа (сосочек), снизу открыт — корень ещё не вырос
  const G = sample(gT, (x, y, z) => germCrown(x, y, z, tilt))
  add('germEnamel', 'enamel', mesh(gT, (x, _y, z, n) => Math.max(G[n]!, -(G[n]! + 0.065), cut(x, z))))
  add('germDentin', 'dentin', mesh(gT, (x, _y, z, n) => Math.max(G[n]! + 0.065, -(G[n]! + 0.12), cut(x, z))))
  add('germPulp', 'germPulp', mesh(gT, (x, _y, z, n) => Math.max(G[n]! + 0.12, cut(x, z))))
  const S = sample(gB, sac)
  add('follicle', 'follicle', mesh(gB, (x, y, z, n) => Math.max(S[n]!, -(germCrown(x, y, z, tilt) + 0.004), cut(x, z))))
  // Кость с лункой молочного зуба и криптой зачатка; при глубоком кариесе — очаг между корнями
  const lesion = id === 'kid-deep' ? (x: number, y: number, z: number) => sdEllipsoid(x - 0.02, y + 0.36, z, 0.24, 0.16, 0.24) + 0.03 * (fbm(x, y, z, 7) - 0.5) : () => 1
  const Kb = sample(gB, (x, y, z) => (lost ? 1 : kidT(x, y, z)))
  const H = sample(gB, (x, y, z, n) => Math.min(Kb[n]! - 0.055, S[n]!, lesion(x, y, z)))
  const spongy = sample(gB, (x, y, z, n) => Math.max(boneBox(x, y, z) + 0.075, -(H[n]! - 0.04)))
  add('cortical', 'cortical', mesh(gB, (x, y, z, n) => Math.max(boneBox(x, y, z), -H[n]!, -spongy[n]!, cut(x, z))))
  add('spongy', 'spongy', mesh(gB, (x, _y, z, n) => Math.max(spongy[n]!, cut(x, z)), 1.4))
  if (id === 'kid-deep') add('lesion', 'lesion', mesh(gB, (x, y, z, n) => Math.max(lesion(x, y, z), -(Kb[n]! - 0.01), -S[n]!, cut(x, z))))
  if (!lost) add('pdl', 'pdl', mesh(gT, (x, y, z) => { const t = kidT(x, y, z); return Math.max(t - 0.06, -t, boneBox(x, y, z) - 0.01, -sac(x, y, z), cut(x, z)) }))
  // Десна: вокруг шейки молочного зуба; без зуба — сплошная, чуть впалая
  const Tg = sample(gG, (x, y, z) => (lost ? 1 : kidT(x, y, z)))
  const collar = (x: number, z: number) => (Math.hypot(x / (0.56 * KID_S), z / (0.47 * KID_S)) - 1) * 0.5
  const top = (x: number, z: number) => (lost ? -0.06 - 0.04 * Math.exp(-(x * x + z * z) / 0.1) : -0.04 + 0.13 * Math.exp(-Math.max(collar(x, z), 0) * 7))
  add('gum', 'gum', tintGum(mesh(gG, (x, y, z, n) => Math.max(smax(gumBox(x, y, z), y - top(x, z), 0.08), -boneBox(x, y, z), -(Tg[n]! + 0.004), cut(x, z))), () => (id === 'kid-deep' ? 0.4 : 0)))
  return out
}

// ——— Участок челюсти сбоку: зуб мудрости и пустое место ———

interface SegTooth {
  shape: JawShape
  /** Шейка зуба (граница эмали и цемента) — точка (x, y); наклон tilt: + — коронкой к −x (мезиально). */
  x: number
  y: number
  tilt: number
  scale: number
  /** Кариес на стенке: центр и радиус в координатах формы. */
  caries?: [number, number, number, number]
  upper?: boolean
}
interface SegSpec {
  teeth: SegTooth[]
  x0: number
  x1: number
  /** Гребень кости и край десны (без зубов). */
  crest: (x: number) => number
  gumBase: (x: number) => number
  /** Десна над половиной коронки («капюшон»): валик-эллипсоид с центром (x, y) и полуосями (rx, ry). */
  hood?: [number, number, number, number]
  /** Воспалённая десна (краснее) — у этой точки x. */
  redAt?: number
}

/** Точка мира → координаты формы зуба. */
function local(t: SegTooth, x: number, y: number, z: number): Vec {
  const dx = x - t.x, dy = y - t.y
  const c = Math.cos(t.tilt), s = Math.sin(t.tilt)
  return [(dx * c + dy * s) / t.scale, (-dx * s + dy * c) / t.scale, z / t.scale]
}
function toothField(t: SegTooth, x: number, y: number, z: number): number {
  const [lx, ly, lz] = local(t, x, y, z)
  if (Math.abs(lx) > 0.8 || ly > 1.25 || ly < -2.3 || Math.abs(lz) > 0.8) {
    const dx = Math.max(Math.abs(lx) - 0.75, 0), dy = Math.max(ly - 1.2, -2.2 - ly, 0), dz = Math.max(Math.abs(lz) - 0.75, 0)
    // С запасом: иначе на границе коробки поле «скачет» и в кости появляются ложные стенки
    return (Math.hypot(dx, dy, dz) + 0.3) * t.scale
  }
  return SHAPES[t.shape](lx, ly, lz) * t.scale
}

const SEG_TEETH: Record<SegmentId, SegSpec> = (() => {
  const wisdom = (pose: { x: number; y: number; tilt: number }, extra: Partial<SegSpec> = {}, caries?: SegTooth['caries']): SegSpec => ({
    teeth: [
      { shape: 'molarLower', x: -1.22, y: 0, tilt: 0, scale: 1 },
      { shape: 'molarLower', x: 0, y: 0, tilt: 0, scale: 0.94, caries },
      { shape: 'molarLower', ...pose, scale: 0.86 },
    ],
    x0: -1.95, x1: 2.25,
    crest: () => BONE_TOP,
    gumBase: () => -0.04,
    ...extra,
  })
  // Пустое место на месте 36: 35 — премоляр, 37 — моляр; сверху 25, 26, 27
  const gap = (stage: 1 | 2 | 3): SegSpec => ({
    teeth: [
      { shape: 'premolarLower', x: -1.02, y: 0, tilt: stage >= 2 ? -0.24 : 0, scale: 1.19 },
      { shape: 'molarLower', x: 1.2, y: 0, tilt: stage >= 2 ? 0.3 : 0, scale: 1.04 },
      { shape: 'premolarUpper', x: -1.0, y: 0, tilt: 0, scale: 1.13, upper: true },
      { shape: 'molarUpper', x: 0.07, y: stage === 3 ? -0.34 : 0, tilt: 0, scale: 0.98, upper: true },
      { shape: 'molarUpper', x: 1.15, y: 0, tilt: 0, scale: 0.92, upper: true },
    ],
    x0: -1.8, x1: 2.0,
    // Кость без зуба убывает: в промежутке гребень ниже и вогнут
    crest: (x) => BONE_TOP - 0.32 * Math.exp(-(((x - 0.07) / 0.5) ** 2)),
    gumBase: (x) => -0.04 - 0.26 * Math.exp(-(((x - 0.07) / 0.55) ** 2)),
  })
  return {
    'wisdom-tilt': wisdom({ x: 1.32, y: -0.62, tilt: 0.8 }),
    'wisdom-half': wisdom({ x: 1.2, y: -0.28, tilt: 0.3 }, { hood: [1.6, 0.06, 0.42, 0.2], redAt: 1.5 }),
    'wisdom-decay': wisdom({ x: 1.27, y: -0.45, tilt: 0.62 }, {}, [0.5, 0.22, 0.2, 0.13]),
    'gap-1': gap(1),
    'gap-2': gap(2),
    'gap-3': gap(3),
  }
})()

export const SEGMENTS = SEG_TEETH

/** Высота «верхней» челюсти в сцене пустого места: верхние зубы смыкаются с нижними. */
export const UPPER_OFFSET = 1.52

function buildSegment(id: SegmentId, step: number): LearnMesh[] {
  const spec = SEG_TEETH[id]
  const out: LearnMesh[] = []
  for (const upper of [false, true]) {
    const teeth = spec.teeth.filter((t) => !!t.upper === upper)
    if (!teeth.length) continue
    // Верхняя челюсть строится так же, как нижняя, потом переворачивается (y → UPPER_OFFSET − y)
    const flip = (m: MeshData) => (upper ? flipY(m, UPPER_OFFSET) : m)
    teeth.forEach((t, i) => {
      for (const m of segToothMeshes(t, step * 1.25)) out.push({ name: `${upper ? 'u' : 'l'}${i}${m.name}`, mat: m.mat, mesh: flip(m.mesh) })
    })
    const all = (x: number, y: number, z: number) => teeth.reduce((d, t) => Math.min(d, toothField(t, x, y, z)), 9)
    const gB = makeGrid([spec.x0 - 0.05, -2.95, -0.8], [spec.x1 + 0.05, 0.05, 0.8], step * 1.35)
    const gG = makeGrid([spec.x0 - 0.05, -0.85, -0.82], [spec.x1 + 0.05, 0.75, 0.82], step * 1.25)
    const crest = upper ? () => BONE_TOP : spec.crest
    const block = (x: number, y: number, z: number) => smax(sdRoundBox(x - (spec.x0 + spec.x1) / 2, y + 1.5, z, (spec.x1 - spec.x0) / 2, 1.45, 0.75, 0.12), y - crest(x), 0.06)
    const A = sample(gB, all)
    const spongy = sample(gB, (x, y, z, n) => Math.max(block(x, y, z) + 0.075, -(A[n]! - 0.06 - 0.045)))
    const segCut = (z: number) => z
    out.push({ name: `${upper ? 'u' : 'l'}cortical`, mat: 'cortical', mesh: flip(surfaceNets(gB, sample(gB, (x, y, z, n) => Math.max(block(x, y, z), -(A[n]! - 0.06), -spongy[n]!, segCut(z))))) })
    out.push({ name: `${upper ? 'u' : 'l'}spongy`, mat: 'spongy', mesh: flip(surfaceNets(gB, sample(gB, (_x, _y, z, n) => Math.max(spongy[n]!, segCut(z))), { uvScale: 1.4 })) })
    // Десна: валик над костью, у каждого зуба — десневой край; «капюшон» над зубом мудрости
    const collar = (x: number, z: number) => teeth.reduce((c, t) => {
      const [lx, ly] = local(t, x, 0, z)
      return Math.min(c, ((Math.hypot(lx / 0.56, z / (0.47 * t.scale)) - 1) * 0.5 + Math.max(0, -ly) * 0.0) * t.scale)
    }, 9)
    const base = upper ? () => -0.04 : spec.gumBase
    const top = (x: number, z: number) => {
      const tp = base(x) + 0.16 * Math.exp(-Math.max(collar(x, z), 0) * 7)
      return tp
    }
    const Ag = sample(gG, all)
    const gumF = (x: number, y: number, z: number, n: number) => {
      const slab = sdRoundBox(x - (spec.x0 + spec.x1) / 2, y + 0.25, z, (spec.x1 - spec.x0) / 2 + 0.03, 0.55, 0.79, 0.1)
      let body = smax(slab, y - top(x, z), 0.08)
      const h = upper ? undefined : spec.hood
      if (h) body = smin(body, sdEllipsoid(x - h[0], y - h[1], z, h[2], h[3], 0.6), 0.14)
      return Math.max(body, -block(x, y, z), -(Ag[n]! + 0.004), segCut(z))
    }
    // Воспаление: десна у этой точки краснее
    const red = upper ? undefined : spec.redAt
    const gum = tintGum(surfaceNets(gG, sample(gG, gumF)), (x) => (red == null ? 0 : Math.exp(-(((x - red) / 0.5) ** 2))))
    out.push({ name: `${upper ? 'u' : 'l'}gum`, mat: 'gum', mesh: flip(gum) })
  }
  return out
}

/** Сетки одного зуба участка: форма с цветом по вершинам, кариес на стенке — отдельно. Вершины — сразу в мире. */
function segToothMeshes(t: SegTooth, step: number): { name: string; mat: LearnMat; mesh: MeshData }[] {
  const g = makeGrid([-0.75, -2.2, -0.75], [0.75, 1.2, 0.75], step / t.scale)
  const shape = SHAPES[t.shape]
  const carious = t.caries ? (x: number, y: number, z: number) => sdEllipsoid(x - t.caries![0], y - t.caries![1], z - t.caries![2], t.caries![3], t.caries![3] * 1.2, t.caries![3]) + 0.02 * (fbm(x, y, z, 12) - 0.5) : () => 1
  const body = surfaceNets(g, sample(g, (x, y, z) => Math.max(shape(x, y, z), -carious(x, y, z))))
  body.colors = new Float32Array(body.positions.length)
  for (let v = 0; v < body.positions.length; v += 3) toothColor(t.shape, body.positions[v]!, body.positions[v + 1]!, body.positions[v + 2]!, body.colors, v)
  const res = [{ name: 'tooth', mat: 'tooth' as LearnMat, mesh: place(body, t) }]
  if (t.caries) {
    // Дно полости — тёмный кариес на глубине; снаружи полость открыта
    const cav = surfaceNets(g, sample(g, (x, y, z) => Math.max(shape(x, y, z) + 0.0, carious(x, y, z) - 0.05, -carious(x, y, z))))
    if (cav.indices.length) res.push({ name: 'caries', mat: 'caries', mesh: place(cav, t) })
  }
  return res
}

/** Вершины формы → мир: масштаб, наклон, сдвиг шейки. */
function place(m: MeshData, t: SegTooth): MeshData {
  const c = Math.cos(t.tilt), s = Math.sin(t.tilt)
  const p = m.positions, n = m.normals
  for (let v = 0; v < p.length; v += 3) {
    const x = p[v]! * t.scale, y = p[v + 1]! * t.scale
    p[v] = x * c - y * s + t.x
    p[v + 1] = x * s + y * c + t.y
    p[v + 2] = p[v + 2]! * t.scale
    const nx = n[v]!, ny = n[v + 1]!
    n[v] = nx * c - ny * s
    n[v + 1] = nx * s + ny * c
  }
  return m
}

/** Отразить сетку по высоте: y → offset − y (и развернуть треугольники, чтобы лицевая сторона осталась снаружи). */
function flipY(m: MeshData, offset: number): MeshData {
  for (let v = 1; v < m.positions.length; v += 3) {
    m.positions[v] = offset - m.positions[v]!
    m.normals[v] = -m.normals[v]!
  }
  for (let i = 0; i < m.indices.length; i += 3) {
    const a = m.indices[i + 1]!
    m.indices[i + 1] = m.indices[i + 2]!
    m.indices[i + 2] = a
  }
  return m
}

/** Все сетки состояния. step — шаг сетки (тесты берут крупнее — быстрее). */
export function buildLearn(id: LearnGeoId, step = TOOTH_STEP): LearnMesh[] {
  if (id === 'socket') return buildSocket(step)
  if (id === 'kid' || id === 'kid-caries' || id === 'kid-deep' || id === 'kid-lost') return buildKid(id, step)
  if (id in SEG_TEETH) return buildSegment(id as SegmentId, step)
  return buildSection(id as keyof typeof SECTION, step)
}

export const SECTION_IDS = [...Object.keys(SECTION), 'socket', 'kid', 'kid-caries', 'kid-deep', 'kid-lost'] as SectionId[]
export const SEGMENT_IDS = Object.keys(SEG_TEETH) as SegmentId[]

/** Свойства для кадров: какие состояния — разрез одного зуба (камера атласа), а какие — участок челюсти. */
export const isSegment = (id: LearnGeoId): id is SegmentId => id in SEG_TEETH

/** Для меток: высота коронки формы (точка над коронкой). */
export const crownHeight = (shape: JawShape) => CROWN_H[shape]
export { CUT_X, hill }

/**
 * Точки подписей на сценах (координаты модели): к ним ведут выноски на кадре. Ключ — подпись презентации
 * (src/learn/callouts.ts). На разрезе точка лежит на плоскости среза z = 0, внутри своей ткани.
 */
const SECTION_BASE = { enamel: [0.45, 0.6, 0], dentin: [0.38, 0.2, 0], pulp: [0.05, 0.2, 0], canal: [-0.3, -1.0, 0.03], cementum: [0.455, -1.0, 0], gum: [0.85, -0.12, 0], bone: [0.85, -1.3, 0] } satisfies Record<string, Vec>
const perioGum = (loss: number): Vec => [0.85, -0.13 - 0.36 * loss, 0]
/** Кость в кадре «шейка» (ниже — за краем кадра). */
const NECK_BONE: Vec = [0.85, -0.85, 0]
export const LEARN_ANCHORS: Record<LearnId, Partial<Record<string, Vec>>> = {
  plaque: { ...SECTION_BASE, bone: NECK_BONE, plaque: [0.615, 0.3, 0] },
  tartar: { ...SECTION_BASE, bone: NECK_BONE, tartar: [0.63, 0.17, 0] },
  gingivitis: { ...SECTION_BASE, bone: NECK_BONE, tartar: [0.63, 0.2, 0] },
  'tartar-below': { ...SECTION_BASE, bone: NECK_BONE, tartar: [0.5, -0.12, 0] },
  perio: { ...SECTION_BASE, tartar: [0.5, -0.25, 0], gum: perioGum(0.45), bone: [0.85, -1.0, 0] },
  'perio-severe': { ...SECTION_BASE, tartar: [0.5, -0.4, 0], gum: perioGum(1), bone: [0.85, -1.1, 0] },
  'pulp-dead': { ...SECTION_BASE, caries: [0.02, 0.62, 0], deadPulp: [-0.05, 0.12, 0] },
  abscess: { ...SECTION_BASE, caries: [0.02, 0.62, 0], deadPulp: [-0.05, 0.12, 0], lesion: [0.42, -1.95, 0] },
  spot: { ...SECTION_BASE, spot: [-0.43, 0.3, 0.37] },
  'crack-line': { ...SECTION_BASE, crack: [0.09, 0.55, 0], filling: [0.0, 0.7, 0] },
  'crack-chip': { ...SECTION_BASE, chip: [0.47, 0.66, -0.27], filling: [0.0, 0.7, 0] },
  'crack-split': { ...SECTION_BASE, crack: [0.09, -0.6, 0], filling: [0.0, 0.7, 0] },
  sealant: { sealant: [-0.1, 0.72, 0.02] },
  'sealant-apply': {},
  socket: { clot: [0.32, -0.7, 0], gum: [0.85, -0.12, 0], bone: [0.85, -1.3, 0] },
  'socket-heal': {},
  kid: { baby: [0.32, 0.45, 0], germ: [0.2, -0.75, 0], gum: [0.85, -0.12, 0], bone: [0.85, -1.3, 0] },
  'kid-caries': { baby: [0.32, 0.45, 0], germ: [0.2, -0.75, 0], caries: [0.02, 0.48, 0] },
  'kid-deep': { baby: [0.32, 0.45, 0], germ: [0.2, -0.75, 0], caries: [0.02, 0.45, 0], lesion: [0.02, -0.42, 0] },
  'kid-lost': { germ: [0.2, -0.75, 0], gum: [0.85, -0.12, 0], bone: [0.85, -1.3, 0] },
  'wisdom-tilt': { wisdom: [1.1, -0.2, 0.3], bone: [0.6, -1.6, 0] },
  'wisdom-half': { wisdom: [0.95, 0.25, 0.3], hood: [1.55, 0.3, 0.3], gum: [-0.6, -0.05, 0] },
  'wisdom-decay': { wisdom: [1.1, 0.05, 0.3], caries: [0.44, 0.2, 0.3] },
  'gap-1': { gap: [0.07, -0.45, 0], bone: [-1.4, -1.6, 0] },
  'gap-2': { gap: [0.07, -0.45, 0] },
  'gap-3': { gap: [0.07, -0.45, 0] },
  'whiten-split': { before: [-0.45, 1.0, 0.75], after: [0.45, 1.0, 0.75] },
  whiten: {},
  shades: {},
}
