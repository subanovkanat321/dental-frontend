import { cellBounds, makeGrid, sample, surfaceNets, type Grid, type MeshData } from './mesher'
import { sdCapsule, sdEllipsoid, sdRoot, sdRoundBox, sdSphere, smax, smin, smoothstep } from './sdf'

/**
 * Моляр нижней челюсти (шестой зуб, 36/46) в кости — как в анатомическом атласе. Единица — около 9 мм:
 * коронка шириной ~1,1. Ось y вверх, шейка зуба (граница эмали и цемента) — на y = 0, корни вниз.
 *
 * Каждый слой — отдельное тело из полей расстояний: эмаль = коронка минус дентин, дентин = минус пульпа…
 * Срез «четверть убрана» — тоже поле: убираем всё, где x > CUT_X и z > 0. Плоскость z = 0 проходит
 * через ось дальнего (дистального) корня, плоскость x = CUT_X — через ось ближнего (мезиального): видны оба канала.
 */
export const CUT_X = -0.3

/** Корни: [шейка x, y, z, r, середина x, y, z, r, верхушка x, y, z, r]. */
const MESIAL_ROOT = [-0.3, -0.25, 0, 0.21, -0.33, -1.15, 0, 0.15, -0.3, -1.9, 0, 0.05] as const
const DISTAL_ROOT = [0.3, -0.25, 0, 0.2, 0.34, -1.1, 0, 0.14, 0.38, -1.8, 0, 0.05] as const
const MESIAL_CANAL = [-0.29, 0.05, 0, 0.085, -0.33, -1.15, 0, 0.05, -0.3, -1.95, 0, 0.018] as const
const DISTAL_CANAL = [0.29, 0.05, 0, 0.085, 0.34, -1.1, 0, 0.05, 0.38, -1.85, 0, 0.018] as const
/** Верхушки корней (для анимации и сосудов). */
export const APEX = { mesial: [-0.3, -1.95, 0], distal: [0.38, -1.85, 0] } as const
export const CANAL_PATH = {
  distal: [[0.38, -1.92], [0.36, -1.45], [0.34, -1.1], [0.32, -0.6], [0.29, 0.05]],
  mesial: [[-0.3, -2.0], [-0.32, -1.5], [-0.33, -1.15], [-0.31, -0.6], [-0.29, 0.05]],
} as const

/**
 * Коронка нижнего моляра: тело с выпуклостью у шейки и жевательная поверхность «картой высот» —
 * пять бугров (язычные выше и острее щёчных), фиссуры между ними, краевые валики (см. jawModel).
 * Центральная фиссура — на x ≈ 0, z ≈ 0: там начинается кариес и стоит пломба.
 */
export function crownOuter(x: number, y: number, z: number): number {
  const body = molarBody(x, y, z)
  const top = 0.3 + 0.75 * lowerMolarTop(x, z)
  return smax(smax(body, (y - top) * 0.55, 0.06), -y - 0.3, 0.05)
}

function molarBody(x: number, y: number, z: number): number {
  const t = Math.min(1, Math.max(0, y / 0.7))
  const bulgeB = 1 + 0.16 * Math.sin(Math.PI * Math.min(1, t * 1.6)) - 0.1 * t * t
  const bulgeL = 1 + 0.14 * Math.sin(Math.PI * Math.min(1, t * 1.1))
  const neck = 0.84 + 0.16 * smoothstep(0, 0.3, t)
  const w = 0.55 * (neck + 0.08 * Math.sin(Math.PI * Math.min(1, t * 1.2)))
  const zr = z >= 0 ? 0.45 * bulgeB * neck : 0.43 * bulgeL * neck
  const r = ((Math.abs(x) / w) ** 2.6 + (Math.abs(z) / zr) ** 2.6) ** (1 / 2.6)
  return (r - 1) * Math.min(w, zr)
}

/** Холм рельефа (бугор): высота h, радиусы по x и z. */
export const hill = (x: number, z: number, cx: number, cz: number, h: number, rx: number, rz: number) =>
  h * Math.exp(-(((x - cx) / rx) ** 2) - ((z - cz) / rz) ** 2)
/** Канавка (фиссура) вдоль отрезка a→b в плоскости xz: глубина d, полуширина w. */
export function groove(x: number, z: number, ax: number, az: number, bx: number, bz: number, d: number, w: number): number {
  const px = x - ax, pz = z - az, vx = bx - ax, vz = bz - az
  const h = Math.min(1, Math.max(0, (px * vx + pz * vz) / (vx * vx + vz * vz)))
  const dx = px - vx * h, dz = pz - vz * h
  return d * Math.exp(-(dx * dx + dz * dz) / (w * w))
}

/** Рельеф жевательной поверхности нижнего моляра (высота над шейкой в единицах формы). */
export function lowerMolarTop(x: number, z: number): number {
  let top = 0.42
  top += hill(x, z, -0.28, 0.21, 0.22, 0.17, 0.15) // мезиально-щёчный
  top += hill(x, z, 0.04, 0.24, 0.2, 0.15, 0.14) // дистально-щёчный
  top += hill(x, z, 0.34, 0.12, 0.15, 0.12, 0.12) // дистальный (пятый)
  top += hill(x, z, -0.25, -0.2, 0.27, 0.17, 0.15) // мезиально-язычный (язычные выше)
  top += hill(x, z, 0.17, -0.2, 0.25, 0.17, 0.15) // дистально-язычный
  // Центральная фиссура зигзагом и боковые — к щеке и к языку
  top -= groove(x, z, -0.42, 0.0, -0.12, 0.02, 0.11, 0.035)
  top -= groove(x, z, -0.12, 0.02, 0.18, -0.01, 0.11, 0.035)
  top -= groove(x, z, 0.18, -0.01, 0.42, 0.02, 0.1, 0.035)
  top -= groove(x, z, -0.12, 0.02, -0.1, 0.46, 0.08, 0.03)
  top -= groove(x, z, 0.18, -0.01, 0.24, 0.42, 0.07, 0.03)
  top -= groove(x, z, -0.02, 0.0, -0.03, -0.44, 0.08, 0.03)
  top += hill(x, z, -0.44, 0, 0.09, 0.06, 0.28) + hill(x, z, 0.44, 0, 0.08, 0.06, 0.28) // краевые валики
  return top
}

export function rootOuter(x: number, y: number, z: number): number {
  const trunk = sdRoundBox(x, y + 0.12, z, 0.43, 0.26, 0.37, 0.2)
  const zr = z * 0.78
  const roots = Math.min(sdRoot(x, y, zr, MESIAL_ROOT), sdRoot(x, y, zr, DISTAL_ROOT)) * 0.9
  return smin(trunk, roots, 0.15)
}

export function pulp(x: number, y: number, z: number): number {
  let d = sdRoundBox(x, y - 0.2, z, 0.25, 0.13, 0.2, 0.1)
  // Рога пульпы — под буграми
  d = smin(d, sdSphere(x + 0.2, y - 0.37, z + 0.13, 0.075), 0.12)
  d = smin(d, sdSphere(x - 0.2, y - 0.37, z + 0.13, 0.075), 0.12)
  d = smin(d, sdSphere(x + 0.2, y - 0.37, z - 0.13, 0.075), 0.12)
  d = smin(d, sdSphere(x - 0.2, y - 0.37, z - 0.13, 0.075), 0.12)
  return smin(d, canals(x, y, z), 0.08)
}

export function canals(x: number, y: number, z: number): number {
  const zc = z * 0.85
  return Math.min(sdRoot(x, y, zc, MESIAL_CANAL), sdRoot(x, y, zc, DISTAL_CANAL))
}

/** Толщина эмали: у бугров ~1,2 мм, к шейке сходит на нет. */
const enamelThickness = (y: number) => 0.13 * smoothstep(-0.02, 0.38, y)
/** Цемент — тонкий слой только на корне. */
const cementThickness = (y: number) => 0.045 * (1 - smoothstep(-0.12, 0, y))

const boneBox = (x: number, y: number, z: number) => sdRoundBox(x, y + 1.25, z, 1.12, 1.03, 0.76, 0.1)
const gumBox = (x: number, y: number, z: number) => sdRoundBox(x, y + 0.2, z, 1.15, 0.42, 0.79, 0.1)

/**
 * Насколько далеко от шейки зуба (по горизонтали): десна у зуба выше (десневой край), дальше — ниже.
 * Гладкая формула овала вокруг шейки, а не поле зуба: то за пределами коробки зуба грубое, и на десне
 * появлялись «ступеньки».
 */
const neckCollar = (x: number, z: number) => (Math.hypot(x / 0.56, z / 0.47) - 1) * 0.5

/** Убрана четверть: x > CUT_X и z > 0. */
export const cut = (x: number, z: number) => Math.min(x - CUT_X, z)

/** Кариес по стадиям: пятно → эмаль → дентин → пульпа. Центр — в фиссуре, на плоскости среза. */
export const CARIES_RADII = [0.09, 0.17, 0.34, 0.52] as const
export function cariesBlob(stage: number, x: number, y: number, z: number): number {
  const r = CARIES_RADII[Math.max(0, Math.min(CARIES_RADII.length - 1, stage))]!
  const cy = 0.74 - r * 0.5
  return sdEllipsoid(x - 0.02, y - cy, z, r * 0.8, r * 1.15, r * 0.85)
}

/** Доступ к каналам (лечение): окно сверху через коронку в камеру пульпы. */
const access = (x: number, y: number, z: number) => sdRoundBox(x - 0.03, y - 0.78, z, 0.31, 0.5, 0.21, 0.08)
/** Полость под пломбу: от фиссуры до дентина, над пульпой. */
const prep = (x: number, y: number, z: number) => sdRoundBox(x - 0.04, y - 0.82, z, 0.3, 0.3, 0.23, 0.07)
/** Отверстие в кости под имплант и под абатмент в десне. */
const implantHole = (x: number, y: number, z: number) => sdCapsule(x, y, z, 0, -0.05, 0, 0, -1.24, 0, 0.2)
const abutmentHole = (x: number, y: number, z: number) => sdCapsule(x, y, z, 0, -0.4, 0, 0, 0.42, 0, 0.15)

/** Группы сеток: строятся по требованию — какой режим открыли, ту и считаем. */
export const TOOTH_GROUPS = {
  base: ['enamel', 'dentin', 'pulp', 'cementum', 'pdl', 'cortical', 'spongy', 'gum'],
  caries: ['caries0', 'caries1', 'caries2', 'caries3'],
  endo: ['enamelAccess', 'dentinAccess', 'gutta'],
  filling: ['enamelPrep', 'dentinPrep', 'filling'],
  crown: ['dentinStump', 'crownCap'],
  implant: ['implantCortical', 'implantSpongy', 'implantGum', 'implantCrown'],
} as const
export type ToothGroup = keyof typeof TOOTH_GROUPS
export type ToothMeshName = (typeof TOOTH_GROUPS)[ToothGroup][number]

/** Шаг сетки зуба: меньше — глаже и дольше. 0,02 ≈ 0,2 мм. Кость и десна крупнее — они проще. */
export const TOOTH_STEP = 0.02

/**
 * Построитель сеток модели. Базовые поля (коронка, корни, пульпа) считаются один раз, слои собираются из
 * них поэлементно. Три сетки разной точности: зуб — мелкая, десна — средняя, кость — крупная
 * (большие плоские грани кости на мелкой сетке дали бы сотни тысяч лишних треугольников).
 */
export function createToothBuilder(step = TOOTH_STEP) {
  const gT = makeGrid([-0.8, -2.1, -0.7], [0.8, 1.02, 0.7], step)
  const gG = makeGrid([-1.16, -0.75, -0.8], [1.16, 0.32, 0.8], step * 1.25)
  const gB = makeGrid([-1.16, -2.36, -0.8], [1.16, 0.0, 0.8], step * 1.75)

  /** Поля зуба на сетке g: C — коронка, R — корни, P — пульпа, T — весь зуб, DT — дентин снаружи. */
  const fieldsOn = (g: Grid) => {
    const C = sample(g, (x, y, z) => (inToothBox(x, y, z) ? crownOuter(x, y, z) : toothBoxDistance(x, y, z)))
    const R = sample(g, (x, y, z) => (inToothBox(x, y, z) ? rootOuter(x, y, z) : toothBoxDistance(x, y, z)))
    const T = sample(g, (_x, _y, _z, n) => smin(C[n]!, R[n]!, 0.12))
    return { C, R, T }
  }
  let tooth: ReturnType<typeof fieldsOn> & { P: Float32Array; DT: Float32Array; enamel: Float32Array; dentin: Float32Array } | null = null
  const toothFields = () => {
    if (tooth) return tooth
    const f = fieldsOn(gT)
    const P = sample(gT, (x, y, z) => (inToothBox(x, y, z) ? pulp(x, y, z) : 1))
    const DT = sample(gT, (_x, y, _z, n) => smin(f.C[n]! + enamelThickness(y), f.R[n]! + cementThickness(y), 0.1))
    const enamel = sample(gT, (x, y, z, n) => Math.max(f.T[n]!, -DT[n]!, -(y + 0.03), cut(x, z)))
    const dentin = sample(gT, (x, _y, z, n) => Math.max(DT[n]!, -P[n]!, cut(x, z)))
    tooth = { ...f, P, DT, enamel, dentin }
    return tooth
  }
  let boneRoots: Float32Array | null = null
  const boneR = () => (boneRoots ??= fieldsOn(gB).R)
  let gumT: Float32Array | null = null
  const gumTooth = () => (gumT ??= fieldsOn(gG).T)

  const toothMesh = (f: Float32Array) => surfaceNets(gT, f)
  const gumMesh = (hole: (x: number, y: number, z: number, n: number) => number, collar: (x: number, z: number, n: number) => number) =>
    surfaceNets(gG, sample(gG, (x, y, z, n) => {
      const top = -0.04 + 0.16 * Math.exp(-Math.max(collar(x, z, n), 0) * 7)
      return Math.max(smax(gumBox(x, y, z), y - top, 0.08), -boneBox(x, y, z), -hole(x, y, z, n), cut(x, z))
    }))
  /** Кость вокруг «дыры» (лунка корня или отверстие под имплант): корковый слой и губчатая кость. */
  const boneMeshes = (hole: (x: number, y: number, z: number, n: number) => number, lining: number): [MeshData, MeshData] => {
    const H = sample(gB, hole)
    const spongy = sample(gB, (x, y, z, n) => Math.max(boneBox(x, y, z) + 0.075, -(H[n]! - lining)))
    const cortical = sample(gB, (x, y, z, n) => Math.max(boneBox(x, y, z), -H[n]!, -spongy[n]!, cut(x, z)))
    const spongyCut = sample(gB, (x, _y, z, n) => Math.max(spongy[n]!, cut(x, z)))
    return [surfaceNets(gB, cortical), surfaceNets(gB, spongyCut, { uvScale: 1.4 })]
  }

  function build(group: ToothGroup): [ToothMeshName, MeshData][] {
    const t = toothFields()
    switch (group) {
      case 'base': {
        const [cortical, spongy] = boneMeshes((_x, _y, _z, n) => boneR()[n]! - 0.065, 0.045)
        return [
          ['enamel', toothMesh(t.enamel)],
          ['dentin', toothMesh(t.dentin)],
          ['pulp', toothMesh(sample(gT, (x, _y, z, n) => Math.max(t.P[n]!, cut(x, z))))],
          ['cementum', toothMesh(sample(gT, (x, y, z, n) => Math.max(t.T[n]!, -t.DT[n]!, y + 0.03, cut(x, z))))],
          // Связка чуть толще лунки в кости: кость на крупной сетке, щели между ними быть не должно
          ['pdl', toothMesh(sample(gT, (x, y, z, n) => Math.max(t.R[n]! - 0.075, -t.R[n]!, boneBox(x, y, z) - 0.01, cut(x, z))))],
          ['cortical', cortical],
          ['spongy', spongy],
          ['gum', gumMesh((_x, _y, _z, n) => gumTooth()[n]! + 0.004, neckCollar)],
        ]
      }
      case 'caries':
        return TOOTH_GROUPS.caries.map((name, s) => [name, surfaceNets(gT,
          sample(gT, (x, y, z, n) => Math.max(t.T[n]!, cariesBlob(s, x, y, z), -t.P[n]!, cut(x, z))),
          cellBounds(gT, [-0.7, -0.3, -0.7], [0.7, 1.0, 0.7]))])
      case 'endo':
        return [
          ['enamelAccess', toothMesh(sample(gT, (x, y, z, n) => Math.max(t.enamel[n]!, -access(x, y, z))))],
          ['dentinAccess', toothMesh(sample(gT, (x, y, z, n) => Math.max(t.dentin[n]!, -access(x, y, z))))],
          ['gutta', toothMesh(sample(gT, (x, y, z) => Math.max(canals(x, y, z), y - 0.02, cut(x, z))))],
        ]
      case 'filling':
        return [
          ['enamelPrep', toothMesh(sample(gT, (x, y, z, n) => Math.max(t.enamel[n]!, -prep(x, y, z))))],
          ['dentinPrep', toothMesh(sample(gT, (x, y, z, n) => Math.max(t.dentin[n]!, -prep(x, y, z))))],
          ['filling', toothMesh(sample(gT, (x, y, z, n) => Math.max(t.T[n]!, prep(x, y, z), cut(x, z))))],
        ]
      case 'crown': {
        const stump = sample(gT, (_x, y, _z, n) => smin(smax(t.C[n]! + enamelThickness(y) + 0.07, y - 0.55, 0.1), t.R[n]! + cementThickness(y), 0.1))
        return [
          ['dentinStump', toothMesh(sample(gT, (x, _y, z, n) => Math.max(stump[n]!, -t.P[n]!, cut(x, z))))],
          ['crownCap', toothMesh(sample(gT, (x, y, z, n) => Math.max(t.T[n]!, -stump[n]!, -(y + 0.02), cut(x, z))))],
        ]
      }
      case 'implant': {
        const [cortical, spongy] = boneMeshes((x, y, z) => implantHole(x, y, z), 0)
        return [
          ['implantCortical', cortical],
          ['implantSpongy', spongy],
          ['implantGum', gumMesh((x, y, z) => abutmentHole(x, y, z), (x, z) => Math.hypot(x, z) - 0.42)],
          ['implantCrown', toothMesh(sample(gT, (x, y, z, n) => Math.max(t.C[n]!, -abutmentHole(x, y, z), -y, cut(x, z))))],
        ]
      }
    }
  }
  return { build }
}

const TOOTH_MIN = [-0.78, -2.1, -0.66] as const
const TOOTH_MAX = [0.78, 1.06, 0.66] as const
function inToothBox(x: number, y: number, z: number): boolean {
  return x > TOOTH_MIN[0] && x < TOOTH_MAX[0] && y > TOOTH_MIN[1] && y < TOOTH_MAX[1] && z > TOOTH_MIN[2] && z < TOOTH_MAX[2]
}
/** Вне коробки зуба формулы не считаем: расстояние до коробки — оценка снизу, знак верный. */
function toothBoxDistance(x: number, y: number, z: number): number {
  const dx = Math.max(TOOTH_MIN[0] - x, 0, x - TOOTH_MAX[0])
  const dy = Math.max(TOOTH_MIN[1] - y, 0, y - TOOTH_MAX[1])
  const dz = Math.max(TOOTH_MIN[2] - z, 0, z - TOOTH_MAX[2])
  return Math.hypot(dx, dy, dz) + 0.05
}

const toothT = (x: number, y: number, z: number) => smin(crownOuter(x, y, z), rootOuter(x, y, z), 0.12)
const toothDT = (x: number, y: number, z: number) => smin(crownOuter(x, y, z) + enamelThickness(y), rootOuter(x, y, z) + cementThickness(y), 0.1)

/**
 * Ткани здорового зуба формулами (без сетки и без среза): где метка, там и ткань — это проверяют тесты.
 * Отрицательное значение — точка внутри ткани.
 */
export const TISSUES = {
  enamel: (x: number, y: number, z: number) => Math.max(toothT(x, y, z), -toothDT(x, y, z), -(y + 0.03)),
  dentin: (x: number, y: number, z: number) => Math.max(toothDT(x, y, z), -pulp(x, y, z)),
  pulp,
  canal: canals,
  cementum: (x: number, y: number, z: number) => Math.max(toothT(x, y, z), -toothDT(x, y, z), y + 0.03),
  pdl: (x: number, y: number, z: number) => Math.max(rootOuter(x, y, z) - 0.075, -rootOuter(x, y, z), boneBox(x, y, z) - 0.01),
  bone: (x: number, y: number, z: number) => Math.max(boneBox(x, y, z), -(rootOuter(x, y, z) - 0.065)),
  gum: (x: number, y: number, z: number) => {
    const top = -0.04 + 0.16 * Math.exp(-Math.max(neckCollar(x, z), 0) * 7)
    return Math.max(smax(gumBox(x, y, z), y - top, 0.08), -boneBox(x, y, z), -toothT(x, y, z))
  },
} as const
export type Tissue = keyof typeof TISSUES
