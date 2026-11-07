import * as THREE from 'three'

import { makeGrid, sample, surfaceNets, type MeshData } from '../../../src/atlas/geometry/mesher'
import { buildCommon, collar, lin, mix, molarColor, neighbourField, noise3, paint, toothT } from '../geometry'
import type { ProcCtx, Procedure, State } from '../types'

/**
 * «Профчистка крупным планом» (11): три зуба (премоляр, моляр, второй моляр) со щёчной стороны, у десны —
 * зубной камень (жёлто-коричневая корка) и налёт (мягкая кремовая плёнка), десна чуть воспалена →
 * ультразвуковой скейлер с водой снимает камень (проходом вдоль зубов) → Air Flow (порошок с водой) смывает
 * налёт → полировка пастой → фтор-лак. Дорожки: tartar 0…1 (доля снятого, проход слева направо),
 * plaque 0…1 (то же для налёта), polish 0…1, varnish 0…1, gumRed 0…1, healed.
 */
export const CLEAN_WORK: [number, number, number] = [0.05, 0.22, 0.3]

const teeth = (x: number, y: number, z: number) => Math.min(toothT(x, y, z), neighbourField(0, x, y, z), neighbourField(1, x, y, z))
/** Высота края десны у зубов (как в gumField). */
const gumTop = (x: number, z: number) => -0.3 + 0.42 * Math.exp(-Math.max(collar(x, z), 0) * 4.5)
/** Камень: корка у самой десны, толще в промежутках между зубами, со щёчной стороны. */
const tartarF = (x: number, y: number, z: number, t: number) => {
  const th = 0.018 + 0.026 * noise3(x * 16, y * 16, z * 16) + 0.012 * noise3(x * 45, y * 45, z * 45)
  const band = Math.max(gumTop(x, z) - 0.06 - y, y - (0.21 + 0.07 * noise3(x * 5, 3, z * 5)))
  return Math.max(t - th, band, -z + 0.05)
}
/** Налёт: тонкая мягкая плёнка на пришеечной и средней трети. */
const plaqueF = (x: number, y: number, z: number, t: number) =>
  Math.max(t - 0.003 - 0.016 * noise3(x * 9, y * 9, z * 9) ** 1.5, y - (0.3 + 0.16 * noise3(x * 6, 7, z * 6)), gumTop(x, z) - 0.04 - y, -z + 0.02)

export function cleaningProcedure(ctx: ProcCtx): Procedure {
  const { mk, phys, toothMat, gumMat } = ctx
  const common = buildCommon()
  for (const n of common.neighbours) mk(n, toothMat).visible = true
  const gum = mk(common.gum, gumMat)
  gum.visible = true
  const gt = makeGrid([-0.72, -0.32, -0.62], [0.72, 0.96, 0.62], 0.012)
  const toothData = paint(surfaceNets(gt, sample(gt, toothT)), (x, y, z, out, o) => molarColor(x, y, z, false, out, o))
  mk(toothData, toothMat).visible = true

  // Сетка налёта и камня: щёчная половина трёх зубов у десны
  const g = makeGrid([-1.35, -0.05, -0.1], [1.65, 0.55, 0.68], 0.009)
  const TT = sample(g, teeth)
  const STAGES = 10
  const sweep = (k: number) => -1.35 + (3.0 * k) / (STAGES - 1)
  const tartarColor = (x: number, y: number, z: number, out: Float32Array, o: number) => {
    const n = noise3(x * 30, y * 30, z * 30)
    const r = mix(0.78, 0.55, n), gg = mix(0.66, 0.42, n), b = mix(0.42, 0.24, n)
    out[o] = lin(r); out[o + 1] = lin(gg); out[o + 2] = lin(b)
  }
  const plaqueColor = (x: number, y: number, z: number, out: Float32Array, o: number) => {
    const n = noise3(x * 14, y * 14, z * 14)
    out[o] = lin(mix(0.93, 0.86, n)); out[o + 1] = lin(mix(0.88, 0.8, n)); out[o + 2] = lin(mix(0.64, 0.55, n))
  }
  const TART = sample(g, (x, y, z, n) => tartarF(x, y, z, TT[n]!))
  const PLAQ = sample(g, (x, y, z, n) => plaqueF(x, y, z, TT[n]!))
  const tartarMat = phys({ color: '#ffffff', vertexColors: true, roughness: 0.85, clearcoat: 0.25, clearcoatRoughness: 0.4 })
  const plaqueMat = phys({ color: '#ffffff', vertexColors: true, roughness: 0.75, clearcoat: 0.3, transparent: true, opacity: 0.72, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })
  const tartar: THREE.Mesh[] = []
  const plaque: THREE.Mesh[] = []
  for (let k = 0; k < STAGES; k++) {
    const sx = sweep(k)
    const mT: MeshData = surfaceNets(g, k === 0 ? TART : sample(g, (x, _y, _z, n) => Math.max(TART[n]!, sx - x)))
    tartar.push(mk(paint(mT, tartarColor, 0.5), tartarMat, 2))
    const mP: MeshData = surfaceNets(g, k === 0 ? PLAQ : sample(g, (x, _y, _z, n) => Math.max(PLAQ[n]!, sx - x)))
    plaque.push(mk(paint(mP, plaqueColor, 0.3), plaqueMat, 1))
  }
  // Фтор-лак: тонкая янтарная глянцевая плёнка; наносят кисточкой слева направо (плоскость отсечения)
  const varnishMat = phys({ color: '#fff4d6', roughness: 0.02, clearcoat: 1, clearcoatRoughness: 0.01, transparent: true, opacity: 0, depthWrite: false, specularIntensity: 1 })
  const varnishPlane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), -1.4)
  varnishMat.clippingPlanes = [varnishPlane]
  const varnish = mk(surfaceNets(g, sample(g, (_x, y, z, n) => Math.max(TT[n]! - 0.008, y - 0.5, -z + 0.02))), varnishMat, 3)
  const gumBase = gumMat.color.clone()

  return {
    work: CLEAN_WORK,
    waterTarget: CLEAN_WORK,
    poses: {
      scaler: { at: [0, -0.02, 0.06], dir: [0.6, 0.55, 0.58], side: [1, 0.4, 0] },
      airflow: { at: [0.25, 0.45, 0.65], dir: [0.6, 0.5, 0.62], side: [1, 0.3, 0] },
      cup: { at: [0, 0.02, 0.12], dir: [0.55, 0.25, 0.8], side: [0, 1, 0] },
      brush: { at: [0, -0.02, 0.05], dir: [0.4, 0.55, 0.73], side: [1, 0.4, 0] },
    },
    drops: { mesh: toothData, ok: (_x, y, _z, nz) => y > 0.1 && nz > 0 },
    apply(s: State) {
      const healed = s.healed! >= 0.5
      const tk = healed ? STAGES : Math.round(Math.min(1, s.tartar ?? 0) * (STAGES - 1)) + ((s.tartar ?? 0) >= 0.999 ? 1 : 0)
      tartar.forEach((m, i) => { m.visible = i === tk })
      const pk = healed ? STAGES : Math.round(Math.min(1, s.plaque ?? 0) * (STAGES - 1)) + ((s.plaque ?? 0) >= 0.999 ? 1 : 0)
      plaque.forEach((m, i) => { m.visible = i === pk })
      const v = healed ? 0 : (s.varnish ?? 0)
      varnish.visible = v > 0.001 && (s.varnishOff ?? 0) < 0.999
      varnishMat.opacity = 0.28 * (1 - (s.varnishOff ?? 0))
      varnishPlane.constant = -1.4 + v * 3.1
      // Воспалённая десна краснее; после чистки — спокойного кораллового цвета
      const red = healed ? 0 : (s.gumRed ?? 0)
      gumMat.color.copy(gumBase).lerp(new THREE.Color(1.05, 0.72, 0.74), red * 0.5)
      toothMat.clearcoatRoughness = 0.07 - 0.05 * (healed ? 1 : (s.polish ?? 0))
    },
  }
}
