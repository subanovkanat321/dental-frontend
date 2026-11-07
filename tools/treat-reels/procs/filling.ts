import * as THREE from 'three'

import { applySurface } from '../../../src/atlas/engine/surface'
import { buildCommon, buildFillingMeshes, CAVITY_TOP, cavity, LAYER_SUBS } from '../geometry'
import type { ProcCtx, Procedure, State } from '../types'

/**
 * «Как ставят пломбу» (07): моляр с кариесом в фиссуре → препарирование → протравка и смыв → бонд и свет →
 * композит слоями → излишек и полировка. Дорожки: prep, etch, rinse, wet, bond, fill (0…3), cure, polish, healed.
 */
export function fillingProcedure(ctx: ProcCtx): Procedure {
  const { mk, phys, toothMat, toothOverMat, gumMat } = ctx
  const meshes = buildFillingMeshes()
  const common = buildCommon()
  // Композит при внесении — пластичная глянцевая паста; синий отсвет — когда светит лампа
  const compositeMat = applySurface(phys({ color: '#efdcb4', roughness: 0.32, clearcoat: 0.8, clearcoatRoughness: 0.08, emissive: new THREE.Color('#2f62ff'), emissiveIntensity: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    { kind: 'plain', ao: true })
  const roughMat = applySurface(phys({ color: '#fbf3e4', vertexColors: true, roughness: 0.62, clearcoat: 0.15, emissive: new THREE.Color('#2f62ff'), emissiveIntensity: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    { kind: 'plain', ao: true })
  const gelMat = phys({ color: '#2d86f0', roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05, transparent: true, opacity: 0.85, emissive: new THREE.Color('#0b3a8a'), emissiveIntensity: 0.25 })
  const bondMat = phys({ color: '#fff3cf', roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02, transparent: true, opacity: 0, depthWrite: false, specularIntensity: 1 })

  const stages = meshes.toothStages.map((m) => mk(m, toothMat))
  const healthy = mk(meshes.toothHealthy, toothMat)
  const layers = meshes.layers.map((m) => mk(m, compositeMat, 1))
  const fillRough = mk(meshes.fillRough, roughMat, 1)
  const fillFinal = mk(meshes.fillFinal, toothOverMat, 1)
  const gel = meshes.gel.map((m) => mk(m, gelMat, 2))
  const bond = mk(meshes.bond, bondMat, 3)
  for (const n of common.neighbours) mk(n, toothMat).visible = true
  mk(common.gum, gumMat).visible = true

  return {
    work: CAVITY_TOP,
    waterTarget: [CAVITY_TOP[0], CAVITY_TOP[1] - 0.06, CAVITY_TOP[2]],
    drops: { mesh: meshes.toothHealthy, ok: (x, y, z, nz) => y > 0.1 && nz > -0.35 && cavity(x, y, z) > 0.05 },
    apply(s: State) {
      const healed = s.healed! >= 0.5
      const stage = Math.round(Math.min(1, Math.max(0, s.prep!)) * (stages.length - 1))
      stages.forEach((m, i) => { m.visible = !healed && i === stage })
      healthy.visible = healed
      // Слои: fill ∈ [0, 3] — три слоя по LAYER_SUBS подстадий
      const sub = Math.ceil(Math.min(3, s.fill!) * LAYER_SUBS) - 1
      const done = s.fill! >= 3
      layers.forEach((m, i) => { m.visible = !healed && !done && i === sub })
      fillRough.visible = !healed && done && s.polish! < 0.55
      fillFinal.visible = !healed && done && s.polish! >= 0.55
      const glowAmt = s.cure! * (0.75 + 0.25 * Math.sin(s.__t! * 31))
      compositeMat.emissiveIntensity = 0.55 * glowAmt
      roughMat.emissiveIntensity = 0.45 * glowAmt
      // Гель протравки: появляется стадиями, при смыве тает
      const g = s.etch!
      const gi = g <= 0 ? -1 : Math.min(gel.length - 1, Math.ceil(g * gel.length) - 1)
      gel.forEach((m, i) => { m.visible = i === gi && s.rinse! < 0.98 })
      gelMat.opacity = 0.85 * (1 - s.rinse!)
      bond.visible = s.bond! > 0.01 && s.fill! < 0.3
      bondMat.opacity = 0.42 * Math.min(1, s.bond!) + 0.3 * s.wet!
      toothMat.clearcoatRoughness = 0.07 - 0.04 * s.wet!
    },
  }
}
