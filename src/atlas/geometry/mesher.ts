/**
 * Из поля расстояний на сетке — треугольники (алгоритм Surface Nets, «сетка поверхности»).
 * Идея простая: в каждой ячейке сетки, где поле меняет знак (поверхность проходит через ячейку), ставим
 * одну вершину — среднее точек пересечения рёбер; соседние такие ячейки соединяем четырёхугольниками.
 * Получается гладкая сетка без таблиц на 256 случаев, как у Marching Cubes. Нормаль — градиент поля:
 * куда поле растёт быстрее всего, туда и «наружу».
 *
 * Чистый TypeScript без three.js: работает в Web Worker и в тестах.
 */

export interface Grid {
  /** Точек по осям. */
  nx: number
  ny: number
  nz: number
  /** Угол сетки и шаг. */
  ox: number
  oy: number
  oz: number
  h: number
}

/** Готовая сетка: позиции и нормали по 3 числа на вершину, индексы треугольников; uv — по желанию. */
export interface MeshData {
  positions: Float32Array
  normals: Float32Array
  indices: Uint32Array
  uvs?: Float32Array
  colors?: Float32Array
}

export function makeGrid(min: [number, number, number], max: [number, number, number], h: number): Grid {
  return {
    nx: Math.ceil((max[0] - min[0]) / h) + 1,
    ny: Math.ceil((max[1] - min[1]) / h) + 1,
    nz: Math.ceil((max[2] - min[2]) / h) + 1,
    ox: min[0],
    oy: min[1],
    oz: min[2],
    h,
  }
}

/** Заполнить поле: f(x, y, z) в каждой точке сетки. */
export function sample(g: Grid, f: (x: number, y: number, z: number, n: number) => number): Float32Array {
  const out = new Float32Array(g.nx * g.ny * g.nz)
  let n = 0
  for (let k = 0; k < g.nz; k++) {
    const z = g.oz + k * g.h
    for (let j = 0; j < g.ny; j++) {
      const y = g.oy + j * g.h
      for (let i = 0; i < g.nx; i++, n++) out[n] = f(g.ox + i * g.h, y, z, n)
    }
  }
  return out
}

/** Ячейки сетки, покрывающие коробку [min, max] — мешеру не нужно обходить всю сетку. */
export function cellBounds(g: Grid, min: [number, number, number], max: [number, number, number]): { lo: [number, number, number]; hi: [number, number, number] } {
  const cell = (v: number, o: number) => Math.floor((v - o) / g.h)
  return {
    lo: [cell(min[0], g.ox), cell(min[1], g.oy), cell(min[2], g.oz)],
    hi: [cell(max[0], g.ox) + 1, cell(max[1], g.oy) + 1, cell(max[2], g.oz) + 1],
  }
}

// Восемь углов ячейки (смещения i, j, k) и двенадцать рёбер (пары углов)
const CORNERS = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]] as const
const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]] as const

/**
 * Поверхность «поле = 0». Ячейки берём только внутри [lo, hi) — так меньше работы для мелких деталей.
 * uvScale — текстурные координаты «с трёх сторон» (по главной оси нормали): губчатой кости нужен узор.
 */
export function surfaceNets(g: Grid, field: Float32Array, opts: { lo?: [number, number, number]; hi?: [number, number, number]; uvScale?: number } = {}): MeshData {
  const { nx, ny, nz, h } = g
  const cx = nx - 1, cy = ny - 1, cz = nz - 1
  const lo = opts.lo ?? [0, 0, 0]
  const hi = opts.hi ?? [cx, cy, cz]
  const i0 = Math.max(0, lo[0]), j0 = Math.max(0, lo[1]), k0 = Math.max(0, lo[2])
  const i1 = Math.min(cx, hi[0]), j1 = Math.min(cy, hi[1]), k1 = Math.min(cz, hi[2])
  const cellVertex = new Int32Array(cx * cy * cz).fill(-1)
  const pos: number[] = []
  const at = (i: number, j: number, k: number) => field[i + nx * (j + ny * k)]!
  const d = new Float64Array(8)

  for (let k = k0; k < k1; k++) {
    for (let j = j0; j < j1; j++) {
      for (let i = i0; i < i1; i++) {
        let mask = 0
        for (let c = 0; c < 8; c++) {
          const o = CORNERS[c]!
          const v = at(i + o[0], j + o[1], k + o[2])
          d[c] = v
          if (v < 0) mask |= 1 << c
        }
        if (mask === 0 || mask === 255) continue
        let sx = 0, sy = 0, sz = 0, cnt = 0
        for (const [a, b] of EDGES) {
          const da = d[a]!, db = d[b]!
          if (da < 0 === db < 0) continue
          const t = da / (da - db)
          const oa = CORNERS[a]!, ob = CORNERS[b]!
          sx += oa[0] + (ob[0] - oa[0]) * t
          sy += oa[1] + (ob[1] - oa[1]) * t
          sz += oa[2] + (ob[2] - oa[2]) * t
          cnt++
        }
        cellVertex[i + cx * (j + cy * k)] = pos.length / 3
        pos.push(g.ox + (i + sx / cnt) * h, g.oy + (j + sy / cnt) * h, g.oz + (k + sz / cnt) * h)
      }
    }
  }

  const idx: number[] = []
  const cell = (i: number, j: number, k: number) => cellVertex[i + cx * (j + cy * k)]!
  const quad = (a: number, b: number, c: number, e: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || e < 0) return
    if (flip) idx.push(a, c, b, a, e, c)
    else idx.push(a, b, c, a, c, e)
  }
  // Ребро сетки с переменой знака — общее для четырёх ячеек: соединяем их вершины
  for (let k = Math.max(k0, 1); k < k1; k++) {
    for (let j = Math.max(j0, 1); j < j1; j++) {
      for (let i = i0; i < i1; i++) {
        const inside = at(i, j, k) < 0
        if (inside !== at(i + 1, j, k) < 0) quad(cell(i, j - 1, k - 1), cell(i, j, k - 1), cell(i, j, k), cell(i, j - 1, k), !inside)
      }
    }
  }
  for (let k = Math.max(k0, 1); k < k1; k++) {
    for (let j = j0; j < j1; j++) {
      for (let i = Math.max(i0, 1); i < i1; i++) {
        const inside = at(i, j, k) < 0
        if (inside !== at(i, j + 1, k) < 0) quad(cell(i - 1, j, k - 1), cell(i - 1, j, k), cell(i, j, k), cell(i, j, k - 1), !inside)
      }
    }
  }
  for (let k = k0; k < k1; k++) {
    for (let j = Math.max(j0, 1); j < j1; j++) {
      for (let i = Math.max(i0, 1); i < i1; i++) {
        const inside = at(i, j, k) < 0
        if (inside !== at(i, j, k + 1) < 0) quad(cell(i - 1, j - 1, k), cell(i, j - 1, k), cell(i, j, k), cell(i - 1, j, k), !inside)
      }
    }
  }

  const positions = new Float32Array(pos)
  const normals = new Float32Array(pos.length)
  for (let v = 0; v < pos.length; v += 3) {
    const [gx, gy, gz] = gradient(g, field, pos[v]!, pos[v + 1]!, pos[v + 2]!)
    const len = Math.hypot(gx, gy, gz) || 1
    normals[v] = gx / len
    normals[v + 1] = gy / len
    normals[v + 2] = gz / len
  }
  const indices = new Uint32Array(idx)
  orient(positions, normals, indices)
  const mesh: MeshData = { positions, normals, indices }
  if (opts.uvScale) mesh.uvs = triplanarUv(positions, normals, opts.uvScale)
  return mesh
}

/** Градиент поля в точке: разности по сетке, сглаженные между узлами. */
function gradient(g: Grid, field: Float32Array, x: number, y: number, z: number): [number, number, number] {
  const fx = (x - g.ox) / g.h, fy = (y - g.oy) / g.h, fz = (z - g.oz) / g.h
  const val = (i: number, j: number, k: number) => {
    const ci = Math.min(g.nx - 1, Math.max(0, i)), cj = Math.min(g.ny - 1, Math.max(0, j)), ck = Math.min(g.nz - 1, Math.max(0, k))
    return field[ci + g.nx * (cj + g.ny * ck)]!
  }
  const tri = (px: number, py: number, pz: number) => {
    const i = Math.floor(px), j = Math.floor(py), k = Math.floor(pz)
    const tx = px - i, ty = py - j, tz = pz - k
    const c00 = val(i, j, k) * (1 - tx) + val(i + 1, j, k) * tx
    const c10 = val(i, j + 1, k) * (1 - tx) + val(i + 1, j + 1, k) * tx
    const c01 = val(i, j, k + 1) * (1 - tx) + val(i + 1, j, k + 1) * tx
    const c11 = val(i, j + 1, k + 1) * (1 - tx) + val(i + 1, j + 1, k + 1) * tx
    return (c00 * (1 - ty) + c10 * ty) * (1 - tz) + (c01 * (1 - ty) + c11 * ty) * tz
  }
  const e = 0.5
  return [tri(fx + e, fy, fz) - tri(fx - e, fy, fz), tri(fx, fy + e, fz) - tri(fx, fy - e, fz), tri(fx, fy, fz + e) - tri(fx, fy, fz - e)]
}

/** Треугольник смотрит наружу (по нормалям вершин) — иначе переворачиваем: свет и отсечение задних граней. */
function orient(p: Float32Array, n: Float32Array, idx: Uint32Array): void {
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t]! * 3, b = idx[t + 1]! * 3, c = idx[t + 2]! * 3
    const ux = p[b]! - p[a]!, uy = p[b + 1]! - p[a + 1]!, uz = p[b + 2]! - p[a + 2]!
    const vx = p[c]! - p[a]!, vy = p[c + 1]! - p[a + 1]!, vz = p[c + 2]! - p[a + 2]!
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx
    const nx = n[a]! + n[b]! + n[c]!, ny = n[a + 1]! + n[b + 1]! + n[c + 1]!, nz = n[a + 2]! + n[b + 2]! + n[c + 2]!
    if (fx * nx + fy * ny + fz * nz < 0) {
      const s = idx[t + 1]!
      idx[t + 1] = idx[t + 2]!
      idx[t + 2] = s
    }
  }
}

function triplanarUv(p: Float32Array, n: Float32Array, scale: number): Float32Array {
  const uv = new Float32Array((p.length / 3) * 2)
  for (let v = 0, w = 0; v < p.length; v += 3, w += 2) {
    const ax = Math.abs(n[v]!), ay = Math.abs(n[v + 1]!), az = Math.abs(n[v + 2]!)
    if (ax >= ay && ax >= az) { uv[w] = p[v + 2]! * scale; uv[w + 1] = p[v + 1]! * scale }
    else if (ay >= az) { uv[w] = p[v]! * scale; uv[w + 1] = p[v + 2]! * scale }
    else { uv[w] = p[v]! * scale; uv[w + 1] = p[v + 1]! * scale }
  }
  return uv
}

/** Число треугольников (для отчёта и тестов). */
export function triangles(m: MeshData): number {
  return m.indices.length / 3
}
