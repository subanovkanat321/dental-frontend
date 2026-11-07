import * as THREE from 'three'

import { makeGrid, sample, surfaceNets, type MeshData } from '../../../src/atlas/geometry/mesher'
import { sdCapsule, sdRoundBox, smax } from '../../../src/atlas/geometry/sdf'
import { crownOuter } from '../../../src/atlas/geometry/toothModel'
import { buildCommon, gumColor, molarColor, NEIGHBOURS, neighbourField, noise3, paint } from '../geometry'
import type { ProcCtx, Procedure, State } from '../types'

/**
 * «Как ставят имплант» (10): место удалённого моляра между соседями, кость и десна в разрезе (окно спереди,
 * как в атласе) → прокол десны → сверление ложа (пилотное и расширение, с водой) → винтовой имплант
 * вкручивается → приживление 3–4 месяца (кость прирастает к виткам) → абатмент → коронка.
 * Дорожки: punch, drill 0…1 (глубина), widen 0…1, implantShow, implantY (над местом), implantTurn (обороты),
 * osseo 0…1, abutY, abutTurn, abutShow, crownShow, crownY, healed.
 */
export const IMPLANT_WORK: [number, number, number] = [0, -0.2, 0]
const CREST = -0.17
const DEPTH = 1.25
/** Окно разреза: спереди (z > 0) между соседями. Поле < 0 — внутри окна (там ткань убрана). */
const win = (x: number, z: number) => Math.max(Math.abs(x) - 0.62, -z)
const cutWin = (f: number, x: number, z: number) => Math.max(f, -win(x, z))
const neighbours = (x: number, y: number, z: number) => Math.min(neighbourField(0, x, y, z), neighbourField(1, x, y, z))
/** Альвеолярная кость: гребень, у места удалённого зуба чуть ниже; лунки корней соседей. */
const boneF = (x: number, y: number, z: number) => {
  const top = CREST - 0.06 * Math.exp(-x * x / 0.3) + 0.02 * (noise3(x * 4, 0, z * 4) - 0.5)
  return Math.max(smax(sdRoundBox(x - 0.1, y + 1.4, z, 2.3, 1.4, 0.6, 0.25), y - top, 0.12), -(neighbours(x, y, z) - 0.06))
}
const hole = (depth: number, r: number) => (x: number, y: number, z: number) => sdCapsule(x, y, z, 0, 0.4, 0, 0, CREST - depth + r, 0, r)
/** Десна без зуба в середине: ровный «седловидный» гребень, у соседей — десневой край. */
function gumF(x: number, y: number, z: number, punchR: number) {
  const c = Math.min((Math.hypot((x - NEIGHBOURS[0].x) / 0.34, z / 0.38) - 1) * 0.35, (Math.hypot((x - NEIGHBOURS[1].x) / 0.52, z / 0.44) - 1) * 0.5)
  const top = 0.02 + 0.12 * Math.exp(-Math.max(c, 0) * 4.5) - 0.04 * Math.exp(-x * x / 0.2)
  const ridge = sdRoundBox(0.1, y + 0.7, z + 0.02, 10, 1.0, 0.62, 0.5)
  let f = Math.max(smax(ridge, y - top, 0.1), Math.abs(x - 0.1) - 2.25, -(neighbours(x, y, z) + 0.004), -(boneF(x, y, z) - 0.002))
  if (punchR > 0) f = Math.max(f, -sdCapsule(x, y, z, 0, 0.5, 0, 0, -0.6, 0, punchR))
  return f
}

/** Винтовой имплант: стержень с витками (радиус меняется по винтовой линии), сверху шестигранник. */
function implantGeometry(): THREE.BufferGeometry {
  const L = 1.15, segR = 64, segY = 260
  const geo = new THREE.CylinderGeometry(1, 1, L, segR, segY, false)
  geo.translate(0, -L / 2, 0)
  const p = geo.getAttribute('position') as THREE.BufferAttribute
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i)
    const ang = Math.atan2(z, x)
    const u = -y / L
    const taper = 1 - 0.28 * Math.max(0, (u - 0.72) / 0.28) ** 1.5
    const thread = u < 0.06 ? 0 : Math.abs(((y * 11 + ang / (Math.PI * 2)) % 1 + 1) % 1 - 0.5) * 2 // треугольный профиль витка
    let r = (0.15 + 0.04 * thread) * taper
    if (u > 0.985) r *= 0.6
    const len = Math.hypot(x, z) || 1
    p.setXYZ(i, (x / len) * r, y, (z / len) * r)
  }
  geo.computeVertexNormals()
  return geo
}

export function implantProcedure(ctx: ProcCtx): Procedure {
  const { mk, phys, toothMat } = ctx
  const m = ctx.atlas()
  const common = buildCommon({ withMain: false })
  for (const n of common.neighbours) mk(n, toothMat).visible = true

  // Кость: снаружи окна — один раз, в окне — по стадиям сверления (корковый слой + губчатая кость)
  const gOut = makeGrid([-2.25, -2.85, -0.68], [2.45, 0.0, 0.68], 0.03)
  const outside = (f: number, x: number) => Math.max(f, 0.66 - Math.abs(x))
  const B0 = sample(gOut, boneF)
  const outCort = surfaceNets(gOut, sample(gOut, (x, _y, _z, n) => outside(Math.max(B0[n]!, -(B0[n]! + 0.07)), x)))
  const outSpongy = surfaceNets(gOut, sample(gOut, (x, _y, _z, n) => outside(B0[n]! + 0.07, x)), { uvScale: 1.4 })
  mk(outCort, m.cortical).visible = true
  mk(outSpongy, m.spongy).visible = true
  const gIn = makeGrid([-0.72, -2.85, -0.68], [0.72, 0.0, 0.68], 0.016)
  const BI = sample(gIn, boneF)
  const inside = (f: number, x: number, z: number) => Math.max(cutWin(f, x, z), Math.abs(x) - 0.7)
  const boneStage = (h: ((x: number, y: number, z: number) => number) | null): [THREE.Mesh, THREE.Mesh] => {
    const H = h ? sample(gIn, h) : null
    const cort = surfaceNets(gIn, sample(gIn, (x, _y, z, n) => inside(Math.max(BI[n]!, -(BI[n]! + 0.07), H ? -H[n]! : -9), x, z)))
    const spon = surfaceNets(gIn, sample(gIn, (x, _y, z, n) => inside(Math.max(BI[n]! + 0.07, H ? -H[n]! : -9), x, z)), { uvScale: 1.4 })
    return [mk(cort, m.cortical), mk(spon, m.spongy)]
  }
  const DRILL = 6, WIDEN = 4
  const bone: [THREE.Mesh, THREE.Mesh][] = [boneStage(null)]
  for (let i = 1; i <= DRILL; i++) bone.push(boneStage(hole((DEPTH * i) / DRILL, 0.075)))
  for (let i = 1; i <= WIDEN; i++) bone.push(boneStage(hole(DEPTH, 0.075 + (0.085 * i) / WIDEN)))

  // Десна: закрыта → прокол → вокруг абатмента/коронки
  const gG = makeGrid([-2.25, -1.6, -0.9], [2.45, 0.3, 0.9], 0.02)
  const gumMesh = (r: number, extra?: (x: number, y: number, z: number) => number) => {
    const d = paint(surfaceNets(gG, sample(gG, (x, y, z) => {
      let f = cutWin(gumF(x, y, z, r), x, z)
      if (extra) f = Math.max(f, -(extra(x, y, z) + 0.004))
      return f
    })), gumColor)
    return mk(d, m.gum)
  }
  const gumClosed = gumMesh(0)
  const gumOpen = gumMesh(0.2)

  // Имплант, абатмент, коронка
  const titanium = m.titanium.clone()
  const implant = new THREE.Mesh(implantGeometry(), titanium)
  implant.castShadow = implant.receiveShadow = true
  const hex = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.012, 6), phys({ color: '#2f3338', metalness: 0.8, roughness: 0.5 }))
  hex.position.y = 0.002
  implant.add(hex)
  ctx.scene.add(implant)
  // Кость прирастает к виткам: полупрозрачная губчатая «муфта» за имплантом (задняя половина — спереди окно)
  const sleeveMat = m.spongy.clone()
  sleeveMat.transparent = true
  sleeveMat.opacity = 0
  sleeveMat.side = THREE.DoubleSide
  const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.17, 1.1, 48, 1, true, Math.PI / 2, Math.PI), sleeveMat)
  sleeve.position.set(0, CREST - 0.6, 0)
  ctx.scene.add(sleeve)
  const abutment = new THREE.Mesh(new THREE.LatheGeometry([[0, 0], [0.15, 0], [0.18, 0.06], [0.2, 0.14], [0.16, 0.2], [0.13, 0.52], [0.1, 0.58], [0, 0.6]].map(([r, y]) => new THREE.Vector2(r, y)), 48),
    phys({ color: '#d9c9a0', metalness: 1, roughness: 0.28 }))
  abutment.castShadow = abutment.receiveShadow = true
  ctx.scene.add(abutment)
  const gc = makeGrid([-0.72, -0.1, -0.62], [0.72, 0.96, 0.62], 0.012)
  const abutField = (x: number, y: number, z: number) => sdCapsule(x, y, z, 0, CREST, 0, 0, CREST + 0.5, 0, 0.17)
  const crownData = paint(surfaceNets(gc, sample(gc, (x, y, z) => Math.max(crownOuter(x, y, z), -(y + 0.02), -abutField(x, y, z)))), (x, y, z, out, o) => molarColor(x, y, z, false, out, o))
  const crown = mk(crownData, toothMat, 1)
  const gumCrown = gumMesh(0, (x, y, z) => Math.min(crownOuter(x, y, z), abutField(x, y, z)))

  return {
    work: IMPLANT_WORK,
    poses: {
      idrill: { at: [0, 0.03, 0], dir: [0, 1, -0.12], side: [-1, 0, 0] },
      driver: { at: [0, 0, 0], dir: [0, 1, -0.12], side: [-1, 0, 0] },
      air: { at: [0.3, 0.9, 0.2], dir: [0.3, 0.7, 0.5], side: [1, 0.4, 0] },
    },
    drops: { mesh: common.neighbours[1] as MeshData, ok: (_x, y, _z, nz) => y > 0.15 && nz > -0.3 },
    apply(s: State) {
      const healed = s.healed! >= 0.5
      const d = healed ? 1 : (s.drill ?? 0), w = healed ? 1 : (s.widen ?? 0)
      const bi = w > 0 ? DRILL + Math.min(WIDEN, Math.ceil(w * WIDEN)) : Math.min(DRILL, Math.ceil(d * DRILL))
      bone.forEach(([c, sp], i) => { c.visible = sp.visible = i === bi })
      const punched = healed || (s.punch ?? 0) >= 0.5
      const withCrown = healed || (s.crownShow ?? 0) >= 0.999
      gumClosed.visible = !punched
      gumOpen.visible = punched && !withCrown
      gumCrown.visible = withCrown
      // Имплант: опускается, вкручиваясь; верх платформы — на уровне кости
      const show = healed ? 1 : (s.implantShow ?? 0)
      implant.visible = show > 0.001
      implant.position.set(0, CREST + (healed ? 0 : (s.implantY ?? 0)), 0)
      implant.rotation.y = -(healed ? 0 : (s.implantTurn ?? 0)) * Math.PI * 2
      const os = healed ? 1 : (s.osseo ?? 0)
      sleeve.visible = os > 0.01
      sleeveMat.opacity = 0.85 * os
      titanium.emissive.set('#ffd28a')
      titanium.emissiveIntensity = 0.25 * (s.glow ?? 0)
      const ab = healed ? 1 : (s.abutShow ?? 0)
      abutment.visible = ab > 0.001
      abutment.position.set(0, CREST + (healed ? 0 : (s.abutY ?? 0)), 0)
      abutment.rotation.y = -(healed ? 0 : (s.abutTurn ?? 0)) * Math.PI * 2
      const cs = healed ? 1 : (s.crownShow ?? 0)
      crown.visible = cs > 0.001
      crown.position.y = healed ? 0 : (s.crownY ?? 0)
    },
  }
}
