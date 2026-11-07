import * as THREE from 'three'

import { makeGrid, sample, surfaceNets } from '../../../src/atlas/geometry/mesher'
import { sdEllipsoid, smax, smin, smoothstep } from '../../../src/atlas/geometry/sdf'
import { crownOuter, rootOuter } from '../../../src/atlas/geometry/toothModel'
import { buildCommon, cavity, collar, enamelThickness, lin, mix, molarColor, noise3, paint, toothT } from '../geometry'
import type { ProcCtx, Procedure, State } from '../types'

/**
 * «Как ставят коронку» (09): разрушенный моляр (откол щёчного бугра, старая тёмная пломба, кариес) →
 * обточка в культю → скан (синие полосы сканера бегут по культе, за ними — сетка 3D-модели) → коронка
 * «изготовлена» и крутится над культёй → садится на цемент → излишки цемента убирают.
 * Дорожки: prep 0…1, scan 0…1, scanGlow, crownShow 0…1 (появление над зубом), crownY (высота над местом),
 * crownTurn (обороты), cement 0…1 (выдавился), cemClean 0…1, healed.
 */
export const CROWN_WORK: [number, number, number] = [0, 0.4, 0]

const cementThickness = (y: number) => 0.045 * (1 - smoothstep(-0.12, 0, y))
/** Культя: коронка, уменьшенная на ~1,5 мм, сверху ровнее, уступ у десны (как в атласе). */
const stump = (x: number, y: number, z: number) =>
  smin(smax(crownOuter(x, y, z) + enamelThickness(y) + 0.07, y - 0.52, 0.1), rootOuter(x, y, z) + cementThickness(y), 0.1)
/** Откол: щёчный мезиальный бугор отломан плоскостью, край неровный. */
const fracture = (x: number, y: number, z: number) => {
  // Плоскость скола: всё, что мезиальнее-выше-щёчнее неё, отломано (поле > 0 — отломанная часть)
  const d = (x + 0.12) * -0.45 + (y - 0.56) * 0.72 + (z - 0.14) * 0.53
  return d + 0.012 * (noise3(x * 18, y * 18, z * 18) - 0.5)
}
const broken = (x: number, y: number, z: number) => Math.max(toothT(x, y, z), fracture(x, y, z))
/** Кариес по краю откола и под старой пломбой. */
const decay = (x: number, y: number, z: number) => smin(sdEllipsoid(x + 0.1, y - 0.5, z - 0.08, 0.26, 0.16, 0.2), sdEllipsoid(x - 0.1, y - 0.55, z, 0.2, 0.1, 0.14), 0.06)

function brokenColor(x: number, y: number, z: number, out: Float32Array, o: number) {
  molarColor(x, y, z, false, out, o)
  // Кариес — тёмно-коричневый, вокруг — желтоватый ободок; старая пломба красит эмаль в серое
  const c = decay(x, y, z)
  const k = smoothstep(0.02, -0.03, c)
  const halo = smoothstep(0.08, 0.0, c) * (1 - k)
  const grey = smoothstep(0.06, 0.0, cavity(x, y, z)) * 0.5
  for (let ch = 0; ch < 3; ch++) {
    let v = out[o + ch]! ** (1 / 2.2)
    v = mix(v, [0.82, 0.74, 0.58][ch]!, halo * 0.6)
    v = mix(v, [0.62, 0.62, 0.64][ch]!, grey)
    v = mix(v, [0.3, 0.19, 0.1][ch]!, k)
    out[o + ch] = lin(v)
  }
}

export function crownProcedure(ctx: ProcCtx): Procedure {
  const { mk, phys, toothMat, gumMat } = ctx
  const common = buildCommon()
  for (const n of common.neighbours) mk(n, toothMat).visible = true
  mk(common.gum, gumMat).visible = true

  const g = makeGrid([-0.72, -0.32, -0.62], [0.72, 0.96, 0.62], 0.012)
  const B = sample(g, broken)
  const S = sample(g, stump)
  const STAGES = 14
  const stages: THREE.Mesh[] = []
  for (let i = 0; i < STAGES; i++) {
    const s = i / (STAGES - 1)
    // Обточка снаружи внутрь: «оболочка» культи сжимается до её формы; в конце — культя целиком (культю
    // восстанавливают материалом, если откол задел её)
    const f = i === 0 ? B : i === STAGES - 1 ? S : sample(g, (_x, _y, _z, n) => Math.max(B[n]!, S[n]! - (1 - s) * 0.3))
    stages.push(mk(paint(surfaceNets(g, f), i === 0 ? brokenColor : (x, y, z, out, o) => {
      brokenColor(x, y, z, out, o)
      // Обточенные поверхности — дентин: сливочно-жёлтый, кариес убран
      const cutIn = smoothstep(-0.004, -0.03, toothT(x, y, z))
      const clean = smoothstep(0.25, 0.9, s)
      const den = [0.88, 0.77, 0.56]
      for (let ch = 0; ch < 3; ch++) out[o + ch] = lin(mix(out[o + ch]! ** (1 / 2.2), den[ch]! * (0.93 + 0.08 * noise3(x * 70, y * 70, z * 70)), Math.max(cutIn * 0.8, clean * cutIn)))
    }), toothMat))
  }
  // Старая пломба (амальгама) — тёмно-серый металл; уходит при обточке
  const amalgamMat = phys({ color: '#7d8287', metalness: 0.85, roughness: 0.45 })
  const amalgam = mk(surfaceNets(g, sample(g, (x, y, z, n) => Math.max(B[n]!, cavity(x, y, z) + 0.004, fracture(x, y, z) + 0.02))), amalgamMat, 1)

  // Скан: копия культи синей сеткой (3D-модель) и светящаяся полоса, бегущая по культе
  const stumpData = surfaceNets(g, S)
  const scanGeo = new THREE.BufferGeometry()
  scanGeo.setAttribute('position', new THREE.BufferAttribute(stumpData.positions, 3))
  scanGeo.setIndex(new THREE.BufferAttribute(stumpData.indices, 1))
  const wireMat = new THREE.MeshBasicMaterial({ color: '#56b4ff', wireframe: true, transparent: true, opacity: 0, depthWrite: false })
  const front = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0)
  wireMat.clippingPlanes = [front]
  const wire = new THREE.Mesh(scanGeo, wireMat)
  wire.scale.setScalar(1.004)
  wire.renderOrder = 5
  const bandMat = new THREE.MeshBasicMaterial({ color: '#7cc8ff', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })
  const bandA = new THREE.Plane(new THREE.Vector3(1, 0, 0), 0), bandB = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0)
  bandMat.clippingPlanes = [bandA, bandB]
  const band = new THREE.Mesh(scanGeo, bandMat)
  band.scale.setScalar(1.006)
  band.renderOrder = 6
  ctx.scene.add(wire, band)

  // Коронка: форма родного зуба поверх культи (керамика в цвет соседей — тот же цвет эмали, глянцевее)
  const crownData = paint(surfaceNets(g, sample(g, (x, y, z, n) => Math.max(toothT(x, y, z), -S[n]!, -(y + 0.02)))), (x, y, z, out, o) => molarColor(x, y, z, false, out, o))
  const crownMat = toothMat.clone()
  // onBeforeCompile у клона не копируется — заново, тем же способом, что и эмаль
  crownMat.onBeforeCompile = toothMat.onBeforeCompile
  crownMat.customProgramCacheKey = toothMat.customProgramCacheKey
  crownMat.clearcoatRoughness = 0.04
  crownMat.side = THREE.DoubleSide
  const crown = mk(crownData, crownMat, 1)

  // Цемент: валик по краю коронки у десны, комочками
  const gc = makeGrid([-0.72, 0.0, -0.62], [0.72, 0.3, 0.62], 0.01)
  const cementData = surfaceNets(gc, sample(gc, (x, y, z) => {
    const ring = Math.abs(toothT(x, y, z) + 0.0) - 0.028 - 0.018 * noise3(x * 14, y * 14, z * 14)
    return Math.max(ring, Math.abs(y - 0.16 + 0.03 * collar(x, z)) - 0.045)
  }))
  const cementMat = phys({ color: '#ffffff', roughness: 0.3, clearcoat: 0.8, sheen: 0.5, sheenColor: new THREE.Color('#dff0ff') })
  const cement = mk(cementData, cementMat, 2)

  return {
    work: CROWN_WORK,
    poses: {
      bur: { at: [0, 0.0, 0.5], dir: [-0.5, 0.8, 0.33], side: [-0.3, 0.2, -1] },
      scanner: { at: [0, 0.75, -0.1], dir: [0, 0.32, -0.95], side: [-1, 0, 0] },
      plug: { at: [0.1, -0.33, 0.47], dir: [0.2, 0.75, 0.62], side: [1, 0.4, 0] },
    },
    // Капли — на культе: пока зуб цел или под коронкой, они внутри и не видны
    drops: { mesh: stumpData, ok: (_x, y, _z, nz) => y > 0.12 && nz > -0.3 },
    apply(s: State) {
      const healed = s.healed! >= 0.5
      const st = Math.round(Math.min(1, Math.max(0, s.prep ?? 0)) * (STAGES - 1))
      stages.forEach((m, i) => { m.visible = !healed && i === st })
      amalgam.visible = !healed && (s.prep ?? 0) < 0.3
      // Скан: фронт идёт по x от −0,6 до 0,6; за ним остаётся сетка
      const sc = s.scan ?? 0
      const x = -0.65 + sc * 1.3
      wire.visible = sc > 0.001 && sc < 1.5 && !healed
      wireMat.opacity = 0.55 * Math.min(1, sc * 4) * (1 - (s.scanFade ?? 0))
      front.constant = x
      band.visible = sc > 0.001 && sc < 0.999 && !healed
      bandA.constant = -(x - 0.05)
      bandB.constant = x
      bandMat.opacity = 0.8
      // Коронка: появляется над зубом (изготовление) и садится на место
      const show = healed ? 1 : (s.crownShow ?? 0)
      crown.visible = show > 0.001
      crown.position.y = healed ? 0 : (s.crownY ?? 0)
      crown.rotation.y = healed ? 0 : (s.crownTurn ?? 0) * Math.PI * 2
      crown.scale.setScalar(healed ? 1 : 0.6 + 0.4 * Math.min(1, show))
      crownMat.transparent = show < 1
      crownMat.opacity = Math.min(1, show)
      // Цемент выдавливается при посадке, потом убирают
      const cm = healed ? 0 : (s.cement ?? 0) * (1 - (s.cemClean ?? 0))
      cement.visible = cm > 0.01
      cement.scale.set(1 + 0.02 * cm, 0.3 + 0.7 * cm, 1 + 0.02 * cm)
    },
  }
}
