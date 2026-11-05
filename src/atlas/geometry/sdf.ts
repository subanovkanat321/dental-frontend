/**
 * Функции расстояния (SDF, signed distance function): для точки пространства — расстояние до поверхности
 * тела, внутри — со знаком минус. Тела складываются как в конструкторе: объединение — min, пересечение —
 * max, вычитание — max(a, −b); «мягкие» smin/smax скругляют стык, как у живой ткани. Из таких полей
 * мешер (mesher.ts) строит треугольники. Формулы — классические, по статьям Иниго Килеса (iquilezles.org).
 * Всё на числах, без объектов: в сетке миллион точек, лишние объекты тормозят.
 */

export function smin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k
  return Math.min(a, b) - h * h * k * 0.25
}

export function smax(a: number, b: number, k: number): number {
  return -smin(-a, -b, k)
}

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0))
  return t * t * (3 - 2 * t)
}

export function sdSphere(x: number, y: number, z: number, r: number): number {
  return Math.sqrt(x * x + y * y + z * z) - r
}

/** Эллипсоид (приближённо, но для гладких форм хватает). */
export function sdEllipsoid(x: number, y: number, z: number, rx: number, ry: number, rz: number): number {
  const k0 = Math.sqrt((x / rx) ** 2 + (y / ry) ** 2 + (z / rz) ** 2)
  const k1 = Math.sqrt((x / (rx * rx)) ** 2 + (y / (ry * ry)) ** 2 + (z / (rz * rz)) ** 2)
  return k1 === 0 ? -Math.min(rx, ry, rz) : (k0 * (k0 - 1)) / k1
}

/** Коробка со скруглёнными рёбрами: полуразмеры bx, by, bz, радиус r. */
export function sdRoundBox(x: number, y: number, z: number, bx: number, by: number, bz: number, r: number): number {
  const qx = Math.abs(x) - bx + r
  const qy = Math.abs(y) - by + r
  const qz = Math.abs(z) - bz + r
  const ox = Math.max(qx, 0)
  const oy = Math.max(qy, 0)
  const oz = Math.max(qz, 0)
  return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, qy, qz), 0) - r
}

/** Капсула от A к B радиусом r. */
export function sdCapsule(px: number, py: number, pz: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number): number {
  const pax = px - ax, pay = py - ay, paz = pz - az
  const bax = bx - ax, bay = by - ay, baz = bz - az
  const h = clamp01((pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz))
  const dx = pax - bax * h, dy = pay - bay * h, dz = paz - baz * h
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - r
}

/** Конус со сферами на концах (корень зуба, канал): от A радиусом r1 к B радиусом r2. */
export function sdRoundCone(px: number, py: number, pz: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, r1: number, r2: number): number {
  const bax = bx - ax, bay = by - ay, baz = bz - az
  const l2 = bax * bax + bay * bay + baz * baz
  const rr = r1 - r2
  const a2 = l2 - rr * rr
  const il2 = 1 / l2
  const pax = px - ax, pay = py - ay, paz = pz - az
  const y = pax * bax + pay * bay + paz * baz
  const z = y - l2
  const cx = pax * l2 - bax * y, cy = pay * l2 - bay * y, cz = paz * l2 - baz * y
  const x2 = cx * cx + cy * cy + cz * cz
  const y2 = y * y * l2
  const z2 = z * z * l2
  const k = Math.sign(rr) * rr * rr * x2
  if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2
  if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1
  return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - r1
}

/** Корень из двух отрезков (слегка изогнутый): точки и радиусы по порядку от шейки к верхушке. */
export function sdRoot(x: number, y: number, z: number, r: readonly number[]): number {
  // r = [ax, ay, az, ra, bx, by, bz, rb, cx, cy, cz, rc]
  const a = sdRoundCone(x, y, z, r[0]!, r[1]!, r[2]!, r[4]!, r[5]!, r[6]!, r[3]!, r[7]!)
  const b = sdRoundCone(x, y, z, r[4]!, r[5]!, r[6]!, r[8]!, r[9]!, r[10]!, r[7]!, r[11]!)
  return Math.min(a, b)
}
