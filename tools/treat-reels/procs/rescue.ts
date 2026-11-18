import * as THREE from 'three'
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js'

import { applySurface } from '../../../src/atlas/engine/surface'
import { makeGrid, sample, surfaceNets, type Grid, type MeshData } from '../../../src/atlas/geometry/mesher'
import { sdEllipsoid, sdRoundBox, sdSphere, smax, smin, smoothstep } from '../../../src/atlas/geometry/sdf'
import { canals, crownOuter, rootOuter } from '../../../src/atlas/geometry/toothModel'
import { lin, mix, noise3, toothT } from '../geometry'
import type { Tool, ToolName } from '../instruments'
import type { ProcCtx, Procedure, State } from '../types'

/**
 * «Смотри, как мы спасаем зуб» (16): моляр в разрезе крупным планом на чёрном фоне — как распил зуба на
 * студийном макро. Плоскость среза z = ZC обращена к камере: видно эмаль (сероватая полупрозрачная кайма),
 * дентин с канальцами, рога пульпы и бурый кариес под сколом эмали. Дальше — лечение: шаровидный бор с
 * водяным спреем и стружкой → синий гель-протравка выдавливается «червяком» по краю и растекается → смыв
 * струёй, вода в полости мутнеет и уходит → влажный блеск → бонд с кисточки растекается золотистой плёнкой →
 * синий свет лампы → композит гладилкой, три слоя, последний лепит бугры → до/после → поворот к целому зубу.
 *
 * Дорожки: prep 0…1, worm 0…1 (гель по краю), coat 0…1 (гель в полость), rinse 0…1 (гель смыт), pool 0…1
 * (вода в полости: уровень), wet, bond 0…1 (плёнка растекается), bdrop (капля на кисточке), cure, fill 0…3,
 * blob (комок на гладилке), mist (спрей бора), stream (струя воды), exterior (целый зуб снаружи).
 */
export const ZC = -0.1
/** Центр полости на срезе: сюда смотрит камера и приходят инструменты. */
export const RESCUE_WORK: [number, number, number] = [0, 0.62, ZC]
const CZ = -0.12

// ── Поля ──
/** Пульпа этого зуба ниже атласной (зуб взрослого — камера пульпы с возрастом уменьшается). */
function pulpField(x: number, y: number, z: number): number {
  let d = sdRoundBox(x, y + 0.02, z, 0.22, 0.11, 0.18, 0.1)
  for (const [hx, hz] of [[-0.18, -0.11], [0.18, -0.11], [-0.18, 0.11], [0.18, 0.11]] as const) d = smin(d, sdSphere(x - hx, y - 0.13, z - hz, 0.045), 0.1)
  return smin(d, canals(x, y, z), 0.08)
}
const enamelT = (y: number) => 0.14 * smoothstep(-0.02, 0.36, y)
const dentinCore = (x: number, y: number, z: number) => smin(crownOuter(x, y, z) + enamelT(y), rootOuter(x, y, z) + 0.04 * (1 - smoothstep(-0.12, 0, y)), 0.1)

/** Итоговая полость: округлый «карман» за срезом, дно над рогами пульпы, следы бора. */
function prepF(x: number, y: number, z: number): number {
  const box = sdRoundBox(x - 0.01, y - 0.87, z - CZ, 0.27, 0.43, 0.19, 0.11)
  const bulb = sdEllipsoid(x - 0.01, y - 0.55, z - CZ, 0.29, 0.15, 0.2)
  const marks = 0.003 * (noise3(x * 26, y * 30, z * 26) - 0.5) + 0.0008 * Math.sin(y * 90 + 4 * noise3(x * 6, y * 6, z * 6))
  return smin(box, bulb, 0.07) + marks
}
/** Скол эмали над кариесом: рваный край, «выкрошенная» полость. */
function hole(x: number, y: number, z: number): number {
  return sdEllipsoid(x + 0.03, y - 0.78, z - CZ, 0.16, 0.2, 0.14) + 0.035 * (noise3(x * 13, y * 13, z * 13) - 0.5) + 0.014 * (noise3(x * 38 + 5, y * 38, z * 38) - 0.5)
}
/** Кариес: бурое пятно в дентине под сколом, расходится вдоль эмали; строго внутри итоговой полости. */
function caries(x: number, y: number, z: number): number {
  const body = sdEllipsoid(x + 0.01, y - 0.62, z - CZ, 0.22, 0.15, 0.15)
  const flat = sdEllipsoid(x, y - 0.69, z - CZ, 0.25, 0.06, 0.16)
  const c = smin(body, flat, 0.05) + 0.03 * (noise3(x * 11 + 2, y * 11, z * 11) - 0.5)
  return Math.max(c, prepF(x, y, z) + 0.02)
}
/** Полость на стадии s: скол + растущая «выборка» бора; при s = 1 — ровно итоговая полость. */
function cavityAt(s: number, x: number, y: number, z: number): number {
  if (s <= 0) return hole(x, y, z)
  if (s >= 1) return prepF(x, y, z)
  const e = s * s * (3 - 2 * s)
  const reach = sdEllipsoid(x - 0.01, y - 0.76 + 0.12 * e, z - CZ, 0.1 + 0.5 * e, 0.14 + 0.42 * e, 0.09 + 0.4 * e)
  return Math.min(hole(x, y, z), Math.max(prepF(x, y, z), reach))
}

// ── Цвет и ткань по вершинам ──
const C = {
  enamelOut: [0.94, 0.91, 0.84], enamelCut: [0.8, 0.82, 0.83], dentin: [0.95, 0.84, 0.64], dentinDeep: [0.9, 0.74, 0.52],
  pulp: [0.76, 0.3, 0.27], cement: [0.86, 0.73, 0.53], cariesDark: [0.25, 0.13, 0.06], cariesSoft: [0.56, 0.37, 0.18], chalk: [0.97, 0.95, 0.89],
  compDentin: [0.93, 0.83, 0.65], compEnamel: [0.9, 0.88, 0.82],
} as const

type Painter = (x: number, y: number, z: number, nz: number, col: number[], tis: number[]) => void

function toothPainter(withCaries: boolean): Painter {
  return (x, y, z, nz, col, tis) => {
    const onCut = nz > 0.9 && Math.abs(z - ZC) < 0.01 ? 1 : 0
    const dc = dentinCore(x, y, z)
    const crown = smoothstep(-0.07, 0.02, y)
    const enamelW = smoothstep(-0.006, 0.006, dc) * crown
    const cementW = smoothstep(-0.006, 0.006, dc) * (1 - crown)
    const pu = pulpField(x, y, z)
    const pulpW = smoothstep(0.006, -0.006, pu)
    const deep = 1 - smoothstep(0.02, 0.16, pu)
    let r = mix(C.dentin[0], C.dentinDeep[0], deep), g = mix(C.dentin[1], C.dentinDeep[1], deep), b = mix(C.dentin[2], C.dentinDeep[2], deep)
    const en = onCut ? C.enamelCut : C.enamelOut
    // Эмаль на срезе у границы с дентином желтеет (просвечивает дентин), снаружи у шейки — теплее
    const dej = onCut ? 1 - smoothstep(0, 0.05, dc) : (1 - smoothstep(0.0, 0.32, y)) * 1.2
    let er = mix(en[0], 0.9, dej * 0.5), eg = mix(en[1], 0.84, dej * 0.5), eb = mix(en[2], 0.7, dej * 0.5)
    if (!onCut) { const tip = smoothstep(0.62, 0.85, y) * 0.5; er = mix(er, 0.95, tip); eg = mix(eg, 0.95, tip); eb = mix(eb, 0.93, tip) }
    r = mix(r, er, enamelW); g = mix(g, eg, enamelW); b = mix(b, eb, enamelW)
    r = mix(r, C.cement[0], cementW); g = mix(g, C.cement[1], cementW); b = mix(b, C.cement[2], cementW)
    r = mix(r, C.pulp[0], pulpW); g = mix(g, C.pulp[1], pulpW); b = mix(b, C.pulp[2], pulpW)
    let cw = 0
    if (withCaries) {
      const c = caries(x, y, z)
      // Меловая кайма (деминерализация) вокруг, внутри — мягкий бурый дентин, в середине почти чёрный
      const halo = smoothstep(0.05, 0.0, c) * (1 - smoothstep(0.0, -0.015, c))
      r = mix(r, C.chalk[0], halo * 0.55); g = mix(g, C.chalk[1], halo * 0.55); b = mix(b, C.chalk[2], halo * 0.55)
      cw = smoothstep(0.008, -0.012, c)
      const core = smoothstep(-0.02, -0.08, c)
      const mott = noise3(x * 60, y * 60, z * 60)
      const kr = mix(C.cariesSoft[0], C.cariesDark[0], core) * (0.8 + 0.4 * mott)
      const kg = mix(C.cariesSoft[1], C.cariesDark[1], core) * (0.8 + 0.4 * mott)
      const kb = mix(C.cariesSoft[2], C.cariesDark[2], core) * (0.8 + 0.4 * mott)
      r = mix(r, kr, cw); g = mix(g, kg, cw); b = mix(b, kb, cw)
    }
    col[0] = r; col[1] = g; col[2] = b
    tis[0] = enamelW * (1 - cw); tis[1] = (1 - enamelW) * (1 - pulpW) * (1 - cw); tis[2] = pulpW; tis[3] = cw
  }
}

/** Покрасить сетку: цвет (линейный) с AO и атрибут ткани (эмаль, дентин, пульпа, кариес). */
function paintMesh(m: MeshData, fn: Painter): MeshData & { tis: Float32Array } {
  const n = m.positions.length / 3
  const colors = new Float32Array(n * 3)
  const tis = new Float32Array(n * 4)
  const col = [0, 0, 0], t = [0, 0, 0, 0]
  for (let i = 0; i < n; i++) {
    const v = i * 3
    fn(m.positions[v]!, m.positions[v + 1]!, m.positions[v + 2]!, m.normals[v + 2]!, col, t)
    const a = m.ao ? (m.ao[i] = 0.55 + 0.45 * m.ao[i]!) : 1
    const k = 1 - 0.3 * (1 - a)
    colors[v] = lin(col[0]!) * k; colors[v + 1] = lin(col[1]!) * k; colors[v + 2] = lin(col[2]!) * k ** 1.1
    tis.set(t, i * 4)
  }
  m.colors = colors
  return Object.assign(m, { tis })
}

// ── Текстура среза: ткани на плоскости z = ZC в высоком разрешении (сетка для этого грубовата) ──
export const CUT = { x0: -0.64, x1: 0.64, y0: -2.1, y1: 0.98 }

function cutTexture(): THREE.DataTexture {
  const W = 1400, H = Math.round((W * (CUT.y1 - CUT.y0)) / (CUT.x1 - CUT.x0))
  const data = new Uint8Array(W * H * 4)
  const z = ZC
  const put = (o: number, r: number, g: number, b: number, a: number) => {
    data[o] = Math.max(0, Math.min(255, Math.round(r * 255))); data[o + 1] = Math.max(0, Math.min(255, Math.round(g * 255)))
    data[o + 2] = Math.max(0, Math.min(255, Math.round(b * 255))); data[o + 3] = Math.round(a * 255)
  }
  for (let j = 0; j < H; j++) {
    const y = CUT.y0 + ((j + 0.5) / H) * (CUT.y1 - CUT.y0)
    for (let i = 0; i < W; i++) {
      const x = CUT.x0 + ((i + 0.5) / W) * (CUT.x1 - CUT.x0)
      const o = (j * W + i) * 4
      const T = toothT(x, y, z)
      if (T > 0.03) { put(o, 0.9, 0.8, 0.6, 0.4); continue }
      const grain = noise3(x * 25, y * 25, 0.7), fine = noise3(x * 140, y * 140, 2.1)
      // Дентин: канальцы (S-линии от пульпы), линии роста, пятнистость; у пульпы темнее и насыщеннее
      const px = x, py = y - 0.0
      const rr = Math.hypot(px, py)
      const ang = Math.atan2(py, px)
      const tub = (0.5 + 0.5 * Math.sin(ang * 260 + 3 * Math.sin(rr * 11) + 2.5 * noise3(x * 20, y * 20, 0.3))) ** 6
      const grow = 0.5 + 0.5 * Math.sin(rr * 260 + 2 * noise3(x * 9, y * 9, 1.3))
      const pu = pulpField(x, y, z)
      const deep = 1 - smoothstep(0.015, 0.2, pu)
      let r = mix(0.95, 0.89, deep), g = mix(0.85, 0.72, deep), b = mix(0.66, 0.5, deep)
      const k = 1 - 0.06 * tub - 0.025 * grow + 0.06 * (grain - 0.5) + 0.03 * (fine - 0.5)
      r *= k; g *= k; b *= k
      let rough = 0.42
      // Предентин — светлая полоска у пульпы
      const pre = smoothstep(0.0, 0.004, pu) * (1 - smoothstep(0.012, 0.02, pu))
      r = mix(r, 0.97, pre * 0.6); g = mix(g, 0.9, pre * 0.6); b = mix(b, 0.76, pre * 0.6)
      // Эмаль: граница с дентином фестончатая, призмы, полосы Гунтера–Шрегера, линии Ретциуса
      const dc = dentinCore(x, y, z) + 0.0015 * Math.sin(x * 130 + 2 * noise3(x * 8, y * 8, 5))
      const crown = smoothstep(-0.07, -0.01, y)
      const en = smoothstep(-0.002, 0.003, dc) * crown
      if (en > 0) {
        const ae = Math.atan2(y - 0.25, x)
        const prism = (0.5 + 0.5 * Math.sin(ae * 700 + 4 * noise3(x * 30, y * 30, 3))) ** 3
        const hsb = 0.5 + 0.5 * Math.sin(ae * 70 + Math.hypot(x, y - 0.25) * 30)
        const retz = 0.5 + 0.5 * Math.sin(T * 480 + 2.5 * noise3(x * 12, y * 12, 4))
        const outer = smoothstep(-0.05, 0, T) // у наружной поверхности эмаль светлее и голубее
        const nearDej = 1 - smoothstep(0, 0.04, dc)
        let er = mix(0.8, 0.88, outer), eg = mix(0.82, 0.9, outer), eb = mix(0.83, 0.93, outer)
        er = mix(er, 0.86, nearDej * 0.5); eg = mix(eg, 0.82, nearDej * 0.5); eb = mix(eb, 0.72, nearDej * 0.5)
        const ek = 1 - 0.012 * prism - 0.015 * hsb - 0.015 * retz + 0.04 * (grain - 0.5) + 0.02 * (fine - 0.5)
        r = mix(r, er * ek, en); g = mix(g, eg * ek, en); b = mix(b, eb * ek, en)
        rough = mix(rough, 0.2, en)
      }
      // Тонкая тёмная линия эмалево-дентинной границы; цемент на корне
      const line = Math.exp(-((dc / 0.005) ** 2)) * crown * 0.1
      r *= 1 - line; g *= 1 - line; b *= 1 - line * 1.3
      const cem = smoothstep(-0.002, 0.003, dc) * (1 - crown)
      r = mix(r, 0.86, cem); g = mix(g, 0.73, cem); b = mix(b, 0.53, cem)
      // Пульпа: красная, с сосудами и светлой каймой одонтобластов
      if (pu < 0.004) {
        const pw = smoothstep(0.003, -0.003, pu)
        const ves = 1 - smoothstep(0, 0.035, Math.abs(noise3(x * 30, y * 30, 7) - 0.5))
        const ves2 = 1 - smoothstep(0, 0.03, Math.abs(noise3(x * 70, y * 70, 9) - 0.5))
        let pr = 0.78, pg = 0.47, pb = 0.42
        const v = Math.min(1, ves * 0.8 + ves2 * 0.5)
        pr = mix(pr, 0.62, v); pg = mix(pg, 0.26, v); pb = mix(pb, 0.25, v)
        const odo = smoothstep(-0.018, -0.004, pu)
        pr = mix(pr, 0.86, odo * 0.5); pg = mix(pg, 0.6, odo * 0.5); pb = mix(pb, 0.52, odo * 0.5)
        const pk = 0.92 + 0.16 * grain
        r = mix(r, pr * pk, pw); g = mix(g, pg * pk, pw); b = mix(b, pb * pk, pw)
        rough = mix(rough, 0.36, pw)
      }
      // Кариес: заражённый бурый дентин (пятнистый, с тёмными крапинами), вокруг — жёлто-бурая зона
      // поражённого дентина, ещё дальше — склерозированный (чуть серее); на эмали — меловая кайма
      const c = caries(x, y, z)
      if (c < 0.07) {
        const halo = smoothstep(0.06, 0.0, c) * (1 - smoothstep(0.0, -0.01, c))
        r = mix(r, 0.98, halo * en * 0.7); g = mix(g, 0.97, halo * en * 0.7); b = mix(b, 0.92, halo * en * 0.7)
        const scl = smoothstep(0.07, 0.04, c) * (1 - en)
        r *= 1 - 0.05 * scl; g *= 1 - 0.06 * scl; b *= 1 - 0.04 * scl
        const aff = smoothstep(0.035, 0.0, c) * (1 - en)
        r = mix(r, 0.82, aff * 0.6); g = mix(g, 0.62, aff * 0.6); b = mix(b, 0.36, aff * 0.6)
        const inf = smoothstep(0.004, -0.008, c)
        const depth = smoothstep(-0.005, -0.09, c)
        const m1 = noise3(x * 70, y * 70, 11), m2 = noise3(x * 180, y * 180, 13)
        let kr = mix(0.6, 0.27, depth), kg = mix(0.4, 0.14, depth), kb = mix(0.2, 0.06, depth)
        const km = 0.75 + 0.45 * m1 + 0.2 * (m2 - 0.5)
        kr *= km; kg *= km; kb *= km
        const spot = smoothstep(0.74, 0.8, noise3(x * 80, y * 80, 17)) * 0.8
        kr = mix(kr, 0.13, spot); kg = mix(kg, 0.07, spot); kb = mix(kb, 0.04, spot)
        r = mix(r, kr, inf); g = mix(g, kg, inf); b = mix(b, kb, inf)
        rough = mix(rough, 0.6, aff * 0.5)
        rough = mix(rough, 0.88, inf)
      }
      put(o, r, g, b, rough)
    }
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.generateMipmaps = true
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.anisotropy = 4
  tex.needsUpdate = true
  return tex
}

// ── Шейдер: канальцы дентина, призмы эмали, рыхлый кариес, мокрый лак, синий свет лампы ──
const RESCUE_PARS = /* glsl */ `
varying vec4 vTis;
uniform float uWet;
uniform float uCure;
uniform vec3 uCurePos;
uniform sampler2D uCutMap;
`
const RESCUE_COLOR = /* glsl */ `
float rCutF = step(0.9, vSurfNrm.z) * step(abs(vSurfPos.z - (${ZC.toFixed(3)})), 0.012);
vec4 rCut = texture2D(uCutMap, vec2((vSurfPos.x - (${CUT.x0.toFixed(3)})) / ${(CUT.x1 - CUT.x0).toFixed(3)}, (vSurfPos.y - (${CUT.y0.toFixed(3)})) / ${(CUT.y1 - CUT.y0).toFixed(3)}));
{
  vec3 sp = vSurfPos;
  // Срез — из текстуры (точнее сетки: канальцы, призмы, зоны кариеса); стенки полости — цвет по вершинам
  diffuseColor.rgb = mix(diffuseColor.rgb, rCut.rgb, rCutF);
  float off = 1.0 - rCutF;
  float kn = sNoise(sp * 70.0) * 0.6 + sNoise(sp * 160.0) * 0.4;
  diffuseColor.rgb *= mix(1.0, 0.7 + 0.6 * kn, vTis.w * off);
  diffuseColor.rgb *= 1.0 + off * (vTis.x + vTis.y) * 0.05 * (sNoise(sp * 24.0) - 0.5);
}
`
const RESCUE_ROUGH = /* glsl */ `
#include <roughnessmap_fragment>
{
  float rgh = vTis.x * 0.26 + vTis.y * 0.5 + vTis.z * 0.42 + vTis.w * 0.9;
  float rest = 1.0 - clamp(vTis.x + vTis.y + vTis.z + vTis.w, 0.0, 1.0);
  rgh = mix(rgh + rest * roughnessFactor, rCut.a, rCutF);
  roughnessFactor = mix(rgh, 0.1, uWet * (1.0 - vTis.w) * (1.0 - rCutF * step(0.7, rCut.a)));
}
`
const RESCUE_COAT = /* glsl */ `
#include <lights_physical_fragment>
#ifdef USE_CLEARCOAT
{
  float wn = sNoise(vSurfPos * 9.0 + 11.0) * 0.65 + sNoise(vSurfPos * 27.0) * 0.35;
  float base = vTis.x * 0.9 + vTis.y * 0.25 + vTis.z * 0.5 + (1.0 - clamp(vTis.x + vTis.y + vTis.z + vTis.w, 0.0, 1.0)) * material.clearcoat;
  material.clearcoat = clamp(mix(base, 1.0, uWet) * (1.0 - vTis.w * 0.9), 0.0, 1.0);
  material.clearcoatRoughness = clamp(mix(0.03, 0.2, smoothstep(0.35, 0.75, wn)) * (1.0 - 0.6 * uWet), 0.0, 1.0);
}
#endif
`
const RESCUE_BUMP = /* glsl */ `
#include <normal_fragment_maps>
{
  // Рыхлый кариес и следы бора: мелкий рельеф по шуму (на ровном распиле — почти нет)
  float pix = length(fwidth(vSurfPos));
  float cutF = step(0.9, vSurfNrm.z) * step(abs(vSurfPos.z - (${ZC.toFixed(3)})), 0.012);
  float hb = vTis.w * (0.004 * sNoise(vSurfPos * 55.0) + 0.002 * sNoise(vSurfPos * 140.0) * sFade(140.0, pix))
    + (1.0 - cutF) * (vTis.x + vTis.y) * 0.0006 * sNoise(vSurfPos * 90.0) * sFade(90.0, pix)
    + cutF * 0.00025 * sNoise(vSurfPos * 120.0) * sFade(120.0, pix);
  vec3 dpx = dFdx(-vViewPosition);
  vec3 dpy = dFdy(-vViewPosition);
  vec3 r1 = cross(dpy, normal);
  vec3 r2 = cross(normal, dpx);
  float det = dot(dpx, r1);
  vec3 grad = sign(det) * (dFdx(hb) * r1 + dFdy(hb) * r2);
  normal = normalize(abs(det) * normal - grad);
}
`
/** Синий свет лампы: подсветка, которая гаснет с расстоянием от световода (дёшево вместо объёмного света). */
const RESCUE_GLOW = /* glsl */ `
#include <emissivemap_fragment>
{
  float dl = distance(vSurfPos, uCurePos);
  totalEmissiveRadiance += vec3(0.16, 0.34, 1.0) * uCure * (0.15 + 0.6 * exp(-dl * dl * 4.0)) * (0.4 + 0.6 * diffuseColor.g);
}
`

interface RescueUniforms { uWet: { value: number }; uCure: { value: number }; uCurePos: { value: THREE.Vector3 }; uCutMap: { value: THREE.Texture | null } }

function rescueLook<M extends THREE.MeshPhysicalMaterial>(mat: M, u: RescueUniforms, tissue: boolean): M {
  const prev = mat.onBeforeCompile.bind(mat)
  const prevKey = mat.customProgramCacheKey.bind(mat)
  mat.onBeforeCompile = (shader, renderer) => {
    prev(shader, renderer)
    Object.assign(shader.uniforms, u)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec4 vTis;\n${tissue ? 'attribute vec4 tis;' : ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvTis = ${tissue ? 'tis' : 'vec4(0.0)'};`)
    let fs = shader.fragmentShader.replace('#include <common>', `#include <common>\n${RESCUE_PARS}`)
    if (tissue) {
      fs = fs.replace('#include <roughnessmap_fragment>', `${RESCUE_COLOR}\n#include <roughnessmap_fragment>`)
      fs = fs.replace('#include <roughnessmap_fragment>', RESCUE_ROUGH)
      fs = fs.replace('#include <normal_fragment_maps>', RESCUE_BUMP)
    }
    fs = fs.replace('#include <lights_physical_fragment>', RESCUE_COAT)
    fs = fs.replace('#include <emissivemap_fragment>', RESCUE_GLOW)
    shader.fragmentShader = fs
  }
  mat.customProgramCacheKey = () => `${prevKey()}|rescue:${tissue ? 1 : 0}`
  mat.needsUpdate = true
  return mat
}

/** Плёнка, которая «растекается» из точки: видна в шаре радиуса spR вокруг spC с мягким краем. */
function spreading<M extends THREE.MeshPhysicalMaterial>(mat: M, key: string) {
  const u = { spC: { value: new THREE.Vector3() }, spR: { value: 0 }, spSoft: { value: 0.04 } }
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSpPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSpPos = transformed;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSpPos;\nuniform vec3 spC;\nuniform float spR;\nuniform float spSoft;')
      .replace('#include <alphatest_fragment>', 'diffuseColor.a *= smoothstep(spR, spR - spSoft, distance(vSpPos, spC));\nif (diffuseColor.a < 0.01) discard;\n#include <alphatest_fragment>')
  }
  mat.customProgramCacheKey = () => `spread:${key}`
  mat.needsUpdate = true
  return u
}

function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return s - Math.floor(s)
}

/** Высота поверхности целого зуба над точкой (x, z) — сверху вниз до первого попадания. */
function surfaceY(x: number, z: number): number {
  for (let y = 1.1; y > 0.2; y -= 0.003) if (toothT(x, y, z) < 0) return y
  return 0.6
}

export function rescueProcedure(ctx: ProcCtx): Procedure {
  const { scene, phys } = ctx
  // ── Студия: чёрный фон, мягкий верхний софтбокс, контровой свет по буграм ──
  scene.background = new THREE.Color('#000000')
  scene.fog = null
  scene.environmentIntensity = 0.55
  const L = ctx.lights
  L.key.color.set('#fff4e8'); L.key.intensity = 1.1; L.key.position.set(0.8, 5.5, 4.5); L.key.target.position.set(0, 0.5, ZC)
  L.key.shadow.radius = 10
  L.fill.color.set('#fff3ec'); L.fill.intensity = 0.55; L.fill.position.set(-4, 1.5, 4)
  L.rim.color.set('#d8e6ff'); L.rim.intensity = 2.2; L.rim.position.set(1.5, 4, -5)
  L.hemi.intensity = 0.25
  L.camLight.intensity = 0.9
  // Отражения — «студия»: чёрная комната с софтбоксами (хром отражает полосы света, а не серую комнату)
  const studio = new THREE.Scene()
  studio.background = new THREE.Color('#000000')
  const panel = (w: number, h: number, k: number, p: [number, number, number], tint = '#ffffff') => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(tint).multiplyScalar(k), side: THREE.DoubleSide }))
    m.position.set(...p)
    m.lookAt(0, 0, 0)
    studio.add(m)
  }
  panel(7, 3.5, 5, [0, 6, 1.5])
  panel(1.4, 6, 3, [-6, 1.2, 1.2])
  panel(1.4, 6, 2.4, [6, 1.2, -0.5], '#e8f0ff')
  panel(3.5, 1.6, 1.4, [0, 0.8, 7])
  panel(6, 6, 0.08, [0, -6, 0])
  // Тусклый серый «купол» — хром не уходит в чистый чёрный
  studio.add(new THREE.Mesh(new THREE.SphereGeometry(20, 32, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.09, 0.09, 0.1), side: THREE.BackSide })))
  const pm = new THREE.PMREMGenerator(ctx.renderer)
  scene.environment = pm.fromScene(studio, 0.02).texture
  const spot = new THREE.SpotLight('#fff2e2', 28, 14, 0.42, 0.9, 1.4)
  spot.position.set(0.5, 4.6, 3.0)
  spot.target.position.set(0, 0.85, ZC)
  scene.add(spot, spot.target)
  RectAreaLightUniformsLib.init()
  const soft = new THREE.RectAreaLight('#ffffff', 2.2, 3.2, 1.6)
  soft.position.set(0, 3.2, 2.2)
  soft.lookAt(0, 0.6, ZC)
  scene.add(soft)
  const cureLight = new THREE.PointLight('#2a55ff', 0, 3, 1.5)
  scene.add(cureLight)

  const u: RescueUniforms = { uWet: { value: 0 }, uCure: { value: 0 }, uCurePos: { value: new THREE.Vector3(0, 1, ZC) }, uCutMap: { value: cutTexture() } }
  const toothMat = rescueLook(applySurface(phys({ color: '#ffffff', vertexColors: true, roughness: 0.4, clearcoat: 0.7, clearcoatRoughness: 0.08, specularIntensity: 0.8 }),
    { kind: 'plain', ao: true, sss: 0.5, sssColor: '#ffd9b5' }), u, true)
  const compMat = rescueLook(applySurface(phys({ color: '#ffffff', vertexColors: true, roughness: 0.3, clearcoat: 0.75, clearcoatRoughness: 0.07, specularIntensity: 0.8, sheen: 0.25, sheenColor: new THREE.Color('#fff6e6'), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    { kind: 'plain', ao: true, sss: 0.6, sssColor: '#ffe6c8' }), u, false)

  const geo = (m: MeshData & { tis?: Float32Array }) => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3))
    g.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3))
    if (m.colors) g.setAttribute('color', new THREE.BufferAttribute(m.colors, 3))
    if (m.ao) g.setAttribute('ao', new THREE.BufferAttribute(m.ao, 1))
    if (m.tis) g.setAttribute('tis', new THREE.BufferAttribute(m.tis, 4))
    g.setIndex(new THREE.BufferAttribute(m.indices, 1))
    g.computeBoundingSphere()
    return g
  }
  const mk = (m: MeshData, mat: THREE.Material, order = 0) => {
    const mesh = new THREE.Mesh(geo(m), mat)
    mesh.castShadow = mesh.receiveShadow = true
    mesh.renderOrder = order
    mesh.visible = false
    scene.add(mesh)
    return mesh
  }

  // ── Зуб в разрезе по стадиям препарирования ──
  const STAGES = 16
  const g: Grid = makeGrid([-0.64, -0.78, -0.54], [0.64, 0.98, -0.07], 0.0085)
  const T = sample(g, (x, y, z) => Math.max(toothT(x, y, z), z - ZC))
  const inBox = (x: number, y: number, z: number) => Math.abs(x) < 0.46 && y > 0.3 && z > -0.42
  const stageData: MeshData[] = []
  for (let i = 0; i < STAGES; i++) {
    const s = i / (STAGES - 1)
    const f = sample(g, (x, y, z, n) => (inBox(x, y, z) ? smax(T[n]!, -cavityAt(s, x, y, z), 0.014) : T[n]!))
    stageData.push(paintMesh(surfaceNets(g, f), toothPainter(true)))
  }
  const stages = stageData.map((m) => mk(m, toothMat))
  // Для поворота в финале — тот же вылеченный срез, но с корнями целиком (обычные стадии обрезаны снизу кадра)
  const gF: Grid = makeGrid([-0.64, -2.1, -0.54], [0.64, 0.98, -0.07], 0.0095)
  const secFull = mk(paintMesh(surfaceNets(gF, sample(gF, (x, y, z) => {
    const t0 = Math.max(toothT(x, y, z), z - ZC)
    return inBox(x, y, z) ? smax(t0, -prepF(x, y, z), 0.014) : t0
  })), toothPainter(false)), toothMat)

  // ── Мелкая сетка полости: композит, гель, бонд, вода ──
  const gc: Grid = makeGrid([-0.38, 0.32, -0.36], [0.38, 0.98, -0.07], 0.0055)
  const TC = sample(gc, (x, y, z) => Math.max(toothT(x, y, z), z - ZC))
  const CAV = sample(gc, prepF)
  const FILL_SUBS = 6
  const L1 = 0.55, L2 = 0.66
  const compPaint: Painter = (_x, y, _z, _nz, col) => {
    const k = smoothstep(L1 + 0.02, L1 + 0.05, y)
    for (let ch = 0; ch < 3; ch++) col[ch] = mix(C.compDentin[ch]!, C.compEnamel[ch]!, k)
  }
  const fills: THREE.Mesh[] = []
  for (let layer = 0; layer < 3; layer++) {
    for (let k = 1; k <= FILL_SUBS; k++) {
      const p = k / FILL_SUBS
      let f: Float32Array
      if (layer < 2) {
        // Слой: уровень растёт, комок под гладилкой оседает и прижимается к стенкам
        const a = layer === 0 ? 0.36 : L1, b = layer === 0 ? L1 : L2
        const lvl = a + (b - a) * Math.min(1, 0.3 + p * 0.8)
        const mound = 0.07 * (1 - p) ** 1.3
        f = sample(gc, (x, y, z, n) => {
          const r2 = (x - 0.02) ** 2 + (z - CZ) ** 2
          const top = lvl + mound * Math.exp(-r2 / 0.012) + 0.004 * (noise3(x * 30, lvl * 9, z * 30) - 0.5)
          return Math.max(CAV[n]!, z - ZC, y - top)
        })
      } else {
        // Последний слой: паста с излишком, гладилка лепит бугры и фиссуру — к концу точная анатомия зуба
        const lvl = L2 + (1.05 - L2) * Math.min(1, p * 1.8)
        const excess = 0.05 * (1 - p) ** 1.5
        f = sample(gc, (x, y, z, n) => {
          const r2 = (x - 0.02) ** 2 + (z - CZ) ** 2
          const bulge = excess * Math.exp(-r2 / 0.03) - 0.02 * (1 - p) * (noise3(x * 18, y * 18, z * 18) - 0.5)
          return Math.max(CAV[n]! - 0.0, z - ZC, y - lvl, toothT(x, y, z) - bulge)
        })
      }
      fills.push(mk(paintMesh(surfaceNets(gc, f), compPaint), compMat, 1))
    }
  }

  // Плёнка по стенкам полости (для геля и бонда): тонкий слой поверх дна и стенок
  // Только внутри исходного зуба: плёнка не торчит над жевательной поверхностью
  const film = (th: number, lumps: number) => surfaceNets(gc, sample(gc, (x, y, z, n) => {
    const wall = smax(TC[n]!, -CAV[n]!, 0.014)
    const l = lumps * (noise3(x * 20, y * 20, z * 20) - 0.5)
    return Math.max(wall - th - l, CAV[n]! - th - 0.02, z - ZC - 0.002, toothT(x, y, z) + 0.006)
  }))
  const gelMat = phys({ color: '#1667f0', roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.04, transparent: true, opacity: 0.8, sheen: 0.3, sheenColor: new THREE.Color('#8fc0ff'), emissive: new THREE.Color('#0a2c8a'), emissiveIntensity: 0.35, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 })
  const gelSpread = spreading(gelMat, 'gel')
  const gelCoat = mk(film(0.013, 0.006), gelMat, 2)
  const bondMat = phys({ color: '#ffd77e', roughness: 0.02, clearcoat: 1, clearcoatRoughness: 0.02, transparent: true, opacity: 0.4, specularIntensity: 1, emissive: new THREE.Color('#4a2400'), emissiveIntensity: 0.25, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 })
  const bondSpread = spreading(bondMat, 'bond')
  bondSpread.spSoft.value = 0.06
  const bond = mk(film(0.01, 0.004), bondMat, 3)

  // Вода в полости при смыве: уровни с рябью; сначала голубая (смытый гель), потом прозрачная
  const waterMat = phys({ color: '#e8f4ff', roughness: 0.02, clearcoat: 1, clearcoatRoughness: 0.01, transparent: true, opacity: 0.5, specularIntensity: 1, envMapIntensity: 2.2, depthWrite: false, side: THREE.DoubleSide, emissive: new THREE.Color('#1a5cff'), emissiveIntensity: 0 })
  const pools = [0.48, 0.58, 0.68, 0.76].map((lvl) => mk(surfaceNets(gc, sample(gc, (x, y, z, n) =>
    Math.max(CAV[n]! + 0.002, z - ZC - 0.003, y - lvl - 0.006 * Math.sin(x * 60 + z * 20) * Math.sin(z * 50 - x * 15)))), waterMat, 4))

  // ── Гель «червяком» по краю полости: трубка вдоль края эмали, растёт за канюлей ──
  const rim: THREE.Vector3[] = []
  {
    const hx = 0.3, back = CZ - 0.215, rc = 0.08
    const pts2: [number, number][] = []
    const N = 60
    // U-образный край полости (вид сверху): от среза назад, по дну «U», снова к срезу
    for (let i = 0; i <= N; i++) {
      const u = i / N
      const L = (ZC - back - rc) * 2 + Math.PI * rc + (2 * hx - 2 * rc)
      let d = u * L
      const legL = ZC - back - rc
      if (d < legL) { pts2.push([-hx, ZC - 0.012 - d]); continue }
      d -= legL
      if (d < (Math.PI / 2) * rc) { const a = d / rc; pts2.push([-hx + rc - rc * Math.cos(a), back + rc - rc * Math.sin(a)]); continue }
      d -= (Math.PI / 2) * rc
      if (d < 2 * hx - 2 * rc) { pts2.push([-hx + rc + d, back]); continue }
      d -= 2 * hx - 2 * rc
      if (d < (Math.PI / 2) * rc) { const a = d / rc; pts2.push([hx - rc + rc * Math.sin(a), back + rc - rc * Math.cos(a)]); continue }
      d -= (Math.PI / 2) * rc
      pts2.push([hx, Math.min(ZC - 0.012, back + rc + d)])
    }
    for (const [x, z] of pts2) rim.push(new THREE.Vector3(x, surfaceY(x, z) + 0.012, z))
  }
  const rimCurve = new THREE.CatmullRomCurve3(rim)
  const WORM_SEG = 220, WORM_RAD = 16
  const wormGeo = new THREE.TubeGeometry(rimCurve, WORM_SEG, 0.034, WORM_RAD, false)
  {
    // Толщина «червяка» неровная: паста выдавливается толчками
    const p = wormGeo.getAttribute('position') as THREE.BufferAttribute
    for (let i = 0; i <= WORM_SEG; i++) {
      const c = rimCurve.getPointAt(i / WORM_SEG)
      const k = 1 + 0.05 * Math.sin(i * 0.13) + 0.03 * Math.sin(i * 0.41 + 1)
      for (let j = 0; j <= WORM_RAD; j++) {
        const v = i * (WORM_RAD + 1) + j
        p.setXYZ(v, c.x + (p.getX(v) - c.x) * k, c.y + (p.getY(v) - c.y) * k * 0.8, c.z + (p.getZ(v) - c.z) * k)
      }
    }
    wormGeo.computeVertexNormals()
  }
  const wormMat = phys({ color: '#1667f0', roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.03, transparent: true, opacity: 0.97, sheen: 0.3, sheenColor: new THREE.Color('#9cc8ff'), emissive: new THREE.Color('#0a2c8a'), emissiveIntensity: 0.35 })
  const worm = new THREE.Mesh(wormGeo, wormMat)
  worm.castShadow = true
  worm.renderOrder = 2
  const wormHead = new THREE.Mesh(new THREE.SphereGeometry(0.036, 24, 16), wormMat)
  const wormTail = new THREE.Mesh(new THREE.SphereGeometry(0.034, 24, 16), wormMat)
  wormTail.position.copy(rim[0]!)
  scene.add(worm, wormHead, wormTail)

  // ── Целый зуб снаружи (финал): коронка и корни, без среза ──
  const gx: Grid = makeGrid([-0.68, -2.05, -0.6], [0.68, 0.98, 0.6], 0.012)
  const whole = mk(paintMesh(surfaceNets(gx, sample(gx, toothT)), toothPainter(false)), toothMat)

  // ── Частицы: спрей бора (штрихи), стружка, струя воды, брызги ──
  const MIST = 1400
  const mistGeo = new THREE.BufferGeometry()
  mistGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MIST * 6), 3))
  const mistMat = new THREE.LineBasicMaterial({ color: '#f2f8ff', transparent: true, opacity: 0.55, depthWrite: false })
  const mist = new THREE.LineSegments(mistGeo, mistMat)
  mist.frustumCulled = false
  mist.renderOrder = 6
  scene.add(mist)
  const CHIPS = 140
  const chipMat = phys({ color: '#ffffff', roughness: 0.7 })
  const chips = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), chipMat, CHIPS)
  chips.frustumCulled = false
  for (let i = 0; i < CHIPS; i++) {
    const brown = hash(i * 3.3) < 0.55
    chips.setColorAt(i, new THREE.Color().setRGB(...(brown ? [lin(0.42), lin(0.26), lin(0.12)] : [lin(0.95), lin(0.92), lin(0.85)]) as [number, number, number]))
  }
  scene.add(chips)
  const dropGeoM = new THREE.SphereGeometry(1, 14, 10)
  const splashMat = phys({ color: '#dfeeff', roughness: 0.0, metalness: 0.2, clearcoat: 1, transparent: true, opacity: 0.3, envMapIntensity: 3, depthWrite: false })
  const SPL = 70
  const splash = new THREE.InstancedMesh(dropGeoM, splashMat, SPL)
  splash.frustumCulled = false
  splash.renderOrder = 6
  scene.add(splash)
  const streamMat = phys({ color: '#f4faff', roughness: 0.02, clearcoat: 1, transparent: true, opacity: 0.42, envMapIntensity: 2.6, depthWrite: false, emissive: new THREE.Color('#9cc4ff'), emissiveIntensity: 0.12 })
  const streamGeo = new THREE.CylinderGeometry(1, 1, 1, 20, 24, true)
  const streamBase = (streamGeo.getAttribute('position') as THREE.BufferAttribute).array.slice()
  const stream = new THREE.Mesh(streamGeo, streamMat)
  stream.frustumCulled = false
  stream.renderOrder = 6
  scene.add(stream)

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v3 = new THREE.Vector3(), sc = new THREE.Vector3()
  const work = new THREE.Vector3(...RESCUE_WORK)
  const floorC = new THREE.Vector3(0.01, 0.45, CZ + 0.02)

  return {
    work: RESCUE_WORK,
    poses: { lamp: { at: [0.06, 0.66, 0.16], dir: [0.3, 1, 0.5], side: [0, 1, 0] } },
    drops: { mesh: stageData[STAGES - 1]!, ok: (x, y, z, nz) => nz < 0.85 && y > 0.4 && prepF(x, y, z) > -0.02 && prepF(x, y, z) < 0.03 },
    apply(s: State) {
      const ext = s.exterior! >= 0.5
      const fill = s.fill!
      const stage = Math.round(Math.min(1, Math.max(0, s.prep!)) * (STAGES - 1))
      const full = s.fullSec! >= 0.5
      stages.forEach((m, i) => { m.visible = !ext && !full && i === stage })
      secFull.visible = !ext && full
      whole.visible = ext
      const sub = Math.min(fills.length - 1, Math.ceil(Math.min(3, fill) * FILL_SUBS) - 1)
      fills.forEach((m, i) => { m.visible = !ext && fill > 0 && i === sub })
      u.uWet.value = s.wet!
      // Гель: червяк растёт за канюлей, потом гель затекает в полость сверху вниз; при смыве тает
      const wv = s.worm!, gone = s.rinse!
      worm.visible = !ext && wv > 0.002 && gone < 0.98
      wormHead.visible = wormTail.visible = worm.visible
      wormGeo.setDrawRange(0, Math.floor(WORM_SEG * Math.min(1, wv)) * WORM_RAD * 6)
      wormHead.position.copy(rimCurve.getPointAt(Math.min(1, Math.max(0.001, wv))))
      const melt = 1 - gone
      worm.scale.setScalar(1)
      wormMat.opacity = 0.97 * melt
      gelMat.opacity = 0.8 * melt
      gelCoat.visible = !ext && s.coat! > 0.01 && gone < 0.98
      gelSpread.spC.value.set(0.01, 0.82, CZ)
      gelSpread.spR.value = 0.12 + 0.42 * s.coat!
      // Вода: уровень (pool 0…1), голубая, пока в ней смытый гель
      const pl = s.pool!
      const pi = pl <= 0.02 ? -1 : Math.min(pools.length - 1, Math.floor(pl * pools.length))
      pools.forEach((m, i) => { m.visible = !ext && i === pi })
      waterMat.color.setRGB(mix(0.35, 0.92, s.poolClear!), mix(0.62, 0.96, s.poolClear!), 1)
      waterMat.emissiveIntensity = 0.35 * (1 - s.poolClear!)
      waterMat.opacity = mix(0.42, 0.14, s.poolClear!)
      // Бонд: растекается от точки касания кисточки
      bond.visible = !ext && s.bond! > 0.01 && fill < 2
      bondSpread.spC.value.copy(floorC)
      bondSpread.spR.value = 0.03 + 0.5 * s.bond!
      bondMat.opacity = (0.3 + 0.12 * s.wet!) * (fill > 0 ? 0.45 : 1)
      // Синий свет: светятся ткани и композит, сильнее — ближе к световоду
      u.uCure.value = s.cure! * (0.85 + 0.15 * Math.sin(s.__t! * 37))
    },
    frame(s: State, tools: Record<ToolName, Tool>) {
      const t = s.__t!
      const frame = Math.floor(t * 30)
      // Канюля идёт за головой «червяка»
      const cn = tools.cannula
      if (cn.group.visible) {
        const head = rimCurve.getPointAt(Math.min(1, Math.max(0, s.worm!)))
        cn.group.position.add(head.sub(work)).add(new THREE.Vector3(0, 0.05, 0))
      }
      // Капля бонда на кисточке и комок композита на гладилке
      const drop = tools.mbrush.parts?.drop
      if (drop) { const k = Math.max(0.001, s.bdrop!); drop.scale.set(k, 1.2 * k, k); drop.visible = k > 0.02 }
      const blob = tools.spatula.parts?.blob
      if (blob) { const k = Math.max(0.001, s.blob!); blob.scale.set(k, 0.85 * k, 0.75 * k); blob.visible = k > 0.03 }
      // Лампа: синий точечный свет у световода и центр свечения для шейдера
      const lamp = tools.lamp
      cureLight.intensity = 6 * s.cure!
      if (lamp.glow) {
        lamp.glow.tip.color.setRGB(0.25 + 0.25 * s.cure!, 0.4 + 0.25 * s.cure!, 0.6 + 0.4 * s.cure!)
        lamp.glow.halo.opacity = 0.3 * s.cure!
      }
      if (lamp.group.visible) {
        cureLight.position.copy(lamp.group.position).add(new THREE.Vector3(0, -0.1, 0))
        u.uCurePos.value.copy(lamp.group.position).add(new THREE.Vector3(0, -0.5, 0))
      }
      // Спрей бора: штрихи воды от трёх форсунок к бору и разлёт в стороны
      const ball = tools.ball
      mist.visible = s.mist! > 0.01 && ball.group.visible
      if (mist.visible) {
        const a = mistGeo.getAttribute('position') as THREE.BufferAttribute
        const tip = new THREE.Vector3(0, 0.06, 0).applyMatrix4(ball.group.matrixWorld)
        for (let i = 0; i < MIST; i++) {
          const jet = i % 3
          const ang = (jet / 3) * Math.PI * 2 + 0.5
          const nz = new THREE.Vector3(Math.cos(ang) * 0.3, 1.27, Math.sin(ang) * 0.3).applyMatrix4(ball.group.matrixWorld)
          const u0 = (hash(i * 1.37) + t * 2.6) % 1
          let p0: THREE.Vector3, p1: THREE.Vector3
          if (u0 < 0.7) {
            // Струйка от форсунки к бору: тонкий конус
            const k = u0 / 0.7
            const jit = 0.01 + 0.07 * k * (1 - k * 0.5)
            p0 = nz.clone().lerp(tip, k).add(new THREE.Vector3((hash(i + frame * 7.1) - 0.5) * jit, (hash(i * 3.7 + frame) - 0.5) * jit, (hash(i * 2.1 + frame) - 0.5) * jit))
            p1 = p0.clone().add(tip.clone().sub(nz).multiplyScalar(0.025))
          } else {
            // Разлёт от бора: брызги по сторонам и вниз
            const k = (u0 - 0.7) / 0.3
            const dirA = hash(i * 9.7) * Math.PI * 2
            const sp = 0.25 + 0.45 * hash(i * 4.3)
            const vel = new THREE.Vector3(Math.cos(dirA) * sp, 0.25 * hash(i * 6.1) - 0.05, Math.sin(dirA) * sp * 0.6 + 0.1)
            p0 = tip.clone().addScaledVector(vel, k).add(new THREE.Vector3(0, -0.4 * k * k, 0))
            p1 = p0.clone().addScaledVector(vel, 0.04).add(new THREE.Vector3(0, -0.015, 0))
          }
          a.setXYZ(i * 2, p0.x, p0.y, p0.z)
          a.setXYZ(i * 2 + 1, p1.x, p1.y, p1.z)
        }
        a.needsUpdate = true
        mistMat.opacity = 0.38 * s.mist!
      }
      // Стружка: крошки кариеса и дентина летят от бора
      chips.visible = mist.visible && s.prep! > 0.02 && s.prep! < 0.98
      if (chips.visible) {
        const tip = new THREE.Vector3(0, 0.06, 0).applyMatrix4(ball.group.matrixWorld)
        for (let i = 0; i < CHIPS; i++) {
          const life = (hash(i * 2.7) + t * 1.8) % 1
          const ang = hash(i * 5.9 + Math.floor(hash(i * 2.7) + t * 1.8)) * Math.PI * 2
          const sp = 0.3 + 0.5 * hash(i * 8.3)
          v3.set(tip.x + Math.cos(ang) * sp * life, tip.y + (0.5 * hash(i * 1.9)) * life - 0.9 * life * life, tip.z + (Math.abs(Math.sin(ang)) * 0.7 + 0.1) * sp * life)
          const r = (0.005 + 0.011 * hash(i * 7.7)) * (life < 0.85 ? 1 : (1 - life) / 0.15)
          q.setFromEuler(new THREE.Euler(t * 9 + i, t * 7 + i * 2, i))
          m4.compose(v3, q, sc.set(r, r * 0.7, r * 1.2))
          chips.setMatrixAt(i, m4)
        }
        chips.instanceMatrix.needsUpdate = true
      }
      // Струя воды из пистолета: прозрачная «нить» с бегущими утолщениями, брызги от удара
      const air = tools.air
      const sw = s.stream!
      stream.visible = splash.visible = sw > 0.01 && air.group.visible
      if (stream.visible) {
        const from = air.group.position.clone()
        const to = new THREE.Vector3(0.0, 0.5, CZ + 0.03)
        const len = from.distanceTo(to) * Math.min(1, sw * 1.5)
        const pa = streamGeo.getAttribute('position') as THREE.BufferAttribute
        for (let i = 0; i < pa.count; i++) {
          const bx = streamBase[i * 3]!, by = streamBase[i * 3 + 1]!, bz = streamBase[i * 3 + 2]!
          const yy = by + 0.5
          const rad = 0.011 * (1 + 0.25 * Math.sin(yy * 40 - t * 50) + 0.5 * yy)
          pa.setXYZ(i, bx * rad, -yy * len, bz * rad)
        }
        pa.needsUpdate = true
        stream.position.copy(from)
        stream.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), to.clone().sub(from).normalize())
        streamMat.opacity = 0.42 * Math.min(1, sw * 2)
        for (let i = 0; i < SPL; i++) {
          const life = (hash(i * 3.1) + t * 2.2) % 1
          const ang = hash(i * 7.3 + Math.floor(hash(i * 3.1) + t * 2.2)) * Math.PI * 2
          const sp = 0.2 + 0.5 * hash(i * 2.2)
          v3.set(to.x + Math.cos(ang) * sp * life, to.y + 0.25 + (0.7 * hash(i * 4.4) + 0.3) * life - 1.6 * life * life, to.z + 0.12 + Math.abs(Math.sin(ang)) * sp * life * 0.8)
          const r = (0.004 + 0.007 * hash(i * 5.5)) * sw * (life < 0.8 ? 1 : (1 - life) / 0.2)
          m4.compose(v3, q.identity(), sc.set(r, r, r))
          splash.setMatrixAt(i, m4)
        }
        splash.instanceMatrix.needsUpdate = true
      }
    },
  }
}
