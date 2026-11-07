import * as THREE from 'three'

import { makeGrid, sample, surfaceNets } from '../../../src/atlas/geometry/mesher'
import { sdEllipsoid, sdRoundBox, smin, smoothstep } from '../../../src/atlas/geometry/sdf'
import { CANAL_PATH, canals, createToothBuilder, crownOuter, CUT_X, cut, pulp, rootOuter } from '../../../src/atlas/geometry/toothModel'
import type { ProcCtx, Procedure, State } from '../types'

/**
 * «Как лечат каналы» (08): моляр в разрезе, как в 3D-атласе (четверть убрана — видно эмаль, дентин, пульпу,
 * корни в кости). Глубокий кариес дошёл до пульпы → доступ бором → файлы чистят каналы (пульпа уходит сверху
 * вниз) → промывка → гуттаперча заполняет каналы от верхушки → пломба сверху.
 * Дорожки: access 0…1, inflame (пульсирует пульпа), clean 0…1 (пульпа и сосуды убраны до этой доли длины),
 * irrigate 0…1, obtur 0…1 (гуттаперча от верхушки до устьев), cap 0…1 (пломба снизу вверх), cure, healed.
 */
export const CANAL_WORK: [number, number, number] = [0.02, 0.45, 0]

const enamelThickness = (y: number) => 0.13 * smoothstep(-0.02, 0.38, y)
const cementThickness = (y: number) => 0.045 * (1 - smoothstep(-0.12, 0, y))
/** Окно доступа к каналам (как в атласе): сверху через коронку в камеру пульпы. */
const access = (x: number, y: number, z: number) => sdRoundBox(x - 0.03, y - 0.78, z, 0.31, 0.5, 0.21, 0.08)
/** Глубокий кариес: от фиссуры до рогов пульпы; целиком внутри окна доступа. */
const deepCaries = (x: number, y: number, z: number) => smin(sdEllipsoid(x - 0.03, y - 0.56, z, 0.23, 0.26, 0.16), sdEllipsoid(x + 0.12, y - 0.42, z - 0.08, 0.08, 0.09, 0.06), 0.05)

/** Уровень (y) по доле длины канала: 0 — верх камеры пульпы, 1 — верхушка корня. */
const levelAt = (u: number) => 0.6 - u * (0.6 + 2.0)

export function canalProcedure(ctx: ProcCtx): Procedure {
  const { mk } = ctx
  const m = ctx.atlas()
  const g = makeGrid([-0.8, -2.1, -0.7], [0.8, 1.02, 0.7], 0.018)
  const C = sample(g, crownOuter)
  const R = sample(g, rootOuter)
  const T = sample(g, (_x, _y, _z, n) => smin(C[n]!, R[n]!, 0.12))
  const P = sample(g, pulp)
  const DT = sample(g, (_x, y, _z, n) => smin(C[n]! + enamelThickness(y), R[n]! + cementThickness(y), 0.1))
  const enamelBase = sample(g, (x, y, z, n) => Math.max(T[n]!, -DT[n]!, -(y + 0.03), cut(x, z)))
  const dentinBase = sample(g, (x, _y, z, n) => Math.max(DT[n]!, -P[n]!, cut(x, z)))
  const ACC = sample(g, access)
  // Доступ по стадиям: окно углубляется от фиссуры до камеры пульпы
  const STAGES = 12
  const accAt = (i: number) => {
    const floor = 0.95 - (i / (STAGES - 1)) * 0.72
    return sample(g, (_x, y, _z, n) => Math.max(ACC[n]!, floor - y))
  }
  const enamel: THREE.Mesh[] = []
  const dentin: THREE.Mesh[] = []
  const caries: THREE.Mesh[] = []
  for (let i = 0; i < STAGES; i++) {
    const A = i === 0 ? null : accAt(i)
    const e = A ? sample(g, (_x, _y, _z, n) => Math.max(enamelBase[n]!, -A[n]!)) : enamelBase
    const d = A ? sample(g, (_x, _y, _z, n) => Math.max(dentinBase[n]!, -A[n]!)) : dentinBase
    enamel.push(mk(surfaceNets(g, e), m.enamel))
    dentin.push(mk(surfaceNets(g, d), m.dentin))
    if (i < STAGES - 1) {
      caries.push(mk(surfaceNets(g, sample(g, (x, y, z, n) => Math.max(T[n]!, deepCaries(x, y, z), -P[n]!, cut(x, z), A ? -A[n]! : -9))), m.caries, 1))
    }
  }
  const enamelHealthyData = surfaceNets(g, enamelBase)

  // Пульпа (живая, при воспалении пульсирует) и раствор в каналах — обе срезаются плоскостью сверху вниз
  const pulpData = surfaceNets(g, sample(g, (x, _y, z, n) => Math.max(P[n]!, cut(x, z))))
  const pulpMat = m.pulp.clone()
  pulpMat.side = THREE.DoubleSide
  pulpMat.emissive = new THREE.Color('#ff2a1a')
  const cleanPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0.6)
  pulpMat.clippingPlanes = [cleanPlane]
  const pulpMesh = mk(pulpData, pulpMat)
  const waterMat = ctx.phys({ color: '#bfe6ff', roughness: 0.05, clearcoat: 1, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, emissive: new THREE.Color('#4aa8ff'), emissiveIntensity: 0.25 })
  const waterPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 2.1)
  waterMat.clippingPlanes = [waterPlane]
  const water = mk(pulpData, waterMat, 2)

  // Гуттаперча — каналы, растут от верхушки вверх (плоскость отсечения поднимается)
  const guttaMat = m.gutta.clone()
  const guttaPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), -2.1)
  guttaMat.clippingPlanes = [guttaPlane]
  const gutta = mk(surfaceNets(g, sample(g, (x, y, z) => Math.max(canals(x, y, z) - 0.004, y - 0.05, cut(x, z)))), guttaMat, 1)

  // Пломба: камера пульпы над устьями + окно доступа, растёт снизу вверх
  const capMat = m.filling.clone()
  const capPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0.03)
  capMat.clippingPlanes = [capPlane]
  capMat.polygonOffset = true
  capMat.polygonOffsetFactor = -1
  const cap = mk(surfaceNets(g, sample(g, (x, y, z, n) => Math.max(T[n]!, Math.min(ACC[n]! - 0.006, Math.max(P[n]! - 0.006, 0.04 - y)), cut(x, z)))), capMat, 1)

  // Ткани вокруг: цемент, связка, кость, десна — готовые из атласа
  const base = new Map(createToothBuilder(0.02).build('base'))
  for (const name of ['cementum', 'pdl', 'cortical', 'spongy', 'gum'] as const) {
    const mat = { cementum: m.cementum, pdl: m.pdl, cortical: m.cortical, spongy: m.spongy, gum: m.gum }[name]
    const mesh = mk(base.get(name)!, mat, name === 'pdl' ? 1 : 0)
    mesh.visible = true
  }

  // Сосуды и нерв: из кости через верхушку по каналу в камеру пульпы (как в атласе)
  const vessels = new THREE.Group()
  const vesselMats = [m.artery.clone(), m.vein.clone(), m.nerve.clone()]
  for (const vm of vesselMats) vm.clippingPlanes = [cleanPlane]
  const bundle = (path: readonly (readonly [number, number])[], side: boolean, extra: [number, number][]) => {
    const all: [number, number][] = [[path[0]![0] + 0.03, path[0]![1] - 0.35], ...path.map(([x, y]) => [x, y] as [number, number]), ...extra]
    const n = all.length
    ;([[-1, 0, 0.013], [1, 1, 0.014], [0, 2, 0.011]] as const).forEach(([k, mi, r]) => {
      const pts = all.map(([x, y], i) => {
        const spread = 0.006 + 0.022 * (i / (n - 1))
        return side ? new THREE.Vector3(CUT_X + 0.003, y, 0.03 + k * spread) : new THREE.Vector3(x + k * spread, y, 0.003)
      })
      const mesh = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 140, r, 10), vesselMats[mi])
      vessels.add(mesh)
    })
  }
  bundle(CANAL_PATH.distal, false, [[0.24, 0.22], [0.17, 0.36]])
  bundle(CANAL_PATH.mesial, true, [[-0.26, 0.24]])
  ctx.scene.add(vessels)

  return {
    work: CANAL_WORK,
    waterTarget: [0.29, 0.1, 0.0],
    poses: {
      bur: { at: [0.01, 0.42, 0], dir: [0.15, 0.85, 0.5], side: [-1, 0.2, 0] },
      file: { at: [0.27, -0.4, 0.004], dir: [-0.04, 1, 0.12], side: [1, 0, 0] },
      irrig: { at: [0.28, -0.25, 0.01], dir: [-0.05, 1, 0.25], side: [1, 0.3, 0] },
      plug: { at: [0.27, -0.35, 0.01], dir: [0.1, 1, 0.3], side: [1, 0.4, 0] },
      lamp: { at: [0.05, 1.2, 0.35], dir: [0.1, 0.8, 0.6], side: [0, 1, 0] },
      syringe: { at: [0.02, 0.0, 0.0], dir: [0.3, 0.75, 0.5], side: [1, 0.3, 0] },
    },
    drops: { mesh: enamelHealthyData, ok: (x, y, z, nz) => y > 0.15 && nz > -0.2 && access(x, y, z) > 0.04 && cut(x, z) < -0.03 },
    apply(s: State) {
      const healed = s.healed! >= 0.5
      const st = healed ? STAGES - 1 : Math.round(Math.min(1, Math.max(0, s.access ?? 0)) * (STAGES - 1))
      enamel.forEach((e, i) => { e.visible = i === st })
      dentin.forEach((d, i) => { d.visible = i === st })
      caries.forEach((c, i) => { c.visible = !healed && i === st })
      // Пульпа и сосуды убраны сверху вниз до доли clean
      const clean = healed ? 1 : (s.clean ?? 0)
      cleanPlane.constant = clean >= 0.999 ? -9 : levelAt(clean)
      pulpMesh.visible = clean < 0.999
      vessels.visible = clean < 0.999
      const pulse = (s.inflame ?? 0) * (0.5 + 0.5 * Math.sin(s.__t! * 7))
      pulpMat.emissiveIntensity = 0.55 * pulse
      // Раствор заполняет очищенное от верхушки до устья и потом уходит
      const irr = healed ? 0 : (s.irrigate ?? 0)
      water.visible = irr > 0.01
      waterMat.opacity = 0.55 * Math.min(1, irr * 3) * (1 - (s.drain ?? 0))
      waterPlane.constant = -levelAt(Math.min(1, irr * 1.2)) // раствор стекает от устья к верхушке: видно y ≥ уровня
      // Гуттаперча от верхушки вверх
      const ob = healed ? 1 : (s.obtur ?? 0)
      gutta.visible = ob > 0.001
      guttaPlane.constant = -2.05 + ob * 2.12
      // Пломба снизу вверх
      const cp = healed ? 1 : (s.cap ?? 0)
      cap.visible = cp > 0.001
      capPlane.constant = 0.03 + cp * 1.0
      capMat.emissive.set('#2f62ff')
      capMat.emissiveIntensity = 0.5 * (s.cure ?? 0) * (0.75 + 0.25 * Math.sin(s.__t! * 31))
    },
  }
}
