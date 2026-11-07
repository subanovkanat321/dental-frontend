import * as THREE from 'three'

import { CUT_X } from '../geometry/toothModel'

/**
 * «Живая» поверхность тканей: добавки к шейдеру MeshPhysicalMaterial через onBeforeCompile (three.js
 * отдаёт текст шейдера перед компиляцией — вставляем в него свои строки). Без текстур и файлов:
 *
 * - микрорельеф (bump) из процедурного шума по координатам модели — эмаль с перикиматами (тонкие
 *   поперечные волны роста), десна «апельсиновой коркой» (stippling), пористая кость;
 * - неоднородный цвет: тёплая шейка у эмали, дентинные канальцы штрихом на срезе, пятнистость пульпы;
 * - AO по вершинам (атрибут `ao`, его считает воркер) — фиссуры и щели темнее, как на фото;
 * - «обёрнутый» диффуз (wrap lighting) — дешёвая имитация подповерхностного рассеяния: свет
 *   заходит за границу света и тени тёплым оттенком, ткань не выглядит пластиком.
 *
 * Шум — по координатам модели, а не экрана: при вращении узор «прилипает» к зубу. Мелкие октавы гаснут,
 * когда их период меньше пары пикселей (fwidth), иначе издалека они рябят.
 */
export type SurfaceKind = 'enamel' | 'tooth' | 'dentin' | 'pulp' | 'gum' | 'bone' | 'cementum' | 'plain'

export interface SurfaceOptions {
  kind: SurfaceKind
  /** Есть атрибут `ao` у всех сеток с этим материалом (их строит воркер). */
  ao?: boolean
  /** Сила подповерхностного рассеяния (0 — нет), 0,3–0,6 — эмаль и десна. */
  sss?: number
  /** Цвет света, «прошедшего» сквозь ткань. */
  sssColor?: string
}

const KIND_ID: Record<SurfaceKind, number> = { enamel: 1, tooth: 2, dentin: 3, pulp: 4, gum: 5, bone: 6, cementum: 7, plain: 0 }

const NOISE = /* glsl */ `
varying vec3 vSurfPos;
varying vec3 vSurfNrm;
#ifdef SURF_AO
varying float vSurfAo;
#endif
float sHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float sNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(sHash(i), sHash(i + vec3(1.0, 0.0, 0.0)), f.x), mix(sHash(i + vec3(0.0, 1.0, 0.0)), sHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
             mix(mix(sHash(i + vec3(0.0, 0.0, 1.0)), sHash(i + vec3(1.0, 0.0, 1.0)), f.x), mix(sHash(i + vec3(0.0, 1.0, 1.0)), sHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}
// Октава гаснет, если её период на экране меньше ~3 пикселей
float sFade(float freq, float pix) { return 1.0 - smoothstep(0.12, 0.35, freq * pix); }
float sHeight(vec3 p, float pix) {
  float h = 0.0;
  #if SURF_KIND == 1 || SURF_KIND == 2
    // Эмаль: пологие неровности + перикиматы (волны роста поперёк зуба) на коронке
    h += 0.0012 * sNoise(p * 24.0) * sFade(24.0, pix);
    h += 0.0004 * sNoise(p * 110.0) * sFade(110.0, pix);
    // Перикиматы заметны в пришеечной половине коронки, к краю стираются
    float band = smoothstep(0.02, 0.12, p.y) * (1.0 - smoothstep(0.35, 0.6, p.y));
    h += 0.00014 * sin(p.y * 210.0 + 3.0 * sNoise(p * 6.0)) * band * (0.6 + 0.8 * sNoise(p * 11.0)) * sFade(33.0, pix);
  #elif SURF_KIND == 5
    // Десна: «апельсиновая корка» — мелкие ямки
    h += 0.0022 * sNoise(p * 55.0) * sFade(55.0, pix);
    h += 0.0008 * sNoise(p * 150.0) * sFade(150.0, pix);
  #elif SURF_KIND == 6
    h += 0.0025 * sNoise(p * 45.0) * sFade(45.0, pix);
    h += 0.0008 * sNoise(p * 130.0) * sFade(130.0, pix);
  #elif SURF_KIND == 4 || SURF_KIND == 7
    h += 0.002 * sNoise(p * 30.0) * sFade(30.0, pix);
  #endif
  return h;
}
// Срез «четверть убрана»: грань на плоскости z = 0 или x = CUT_X
float sOnCut(vec3 p, vec3 n) {
  return max(step(0.97, abs(n.z)) * step(abs(p.z), 0.012), step(0.97, abs(n.x)) * step(abs(p.x - SURF_CUT_X), 0.012));
}
`

const COLOR = /* glsl */ `
#include <color_fragment>
{
  vec3 sp = vSurfPos;
  float pix = length(fwidth(sp));
  float cutFace = sOnCut(sp, vSurfNrm);
  #if SURF_KIND == 1
    // Эмаль: у шейки тоньше — просвечивает жёлтый дентин; на срезе — сероватая, полупрозрачная
    float neck = (1.0 - smoothstep(0.0, 0.42, sp.y)) * step(-0.04, sp.y);
    diffuseColor.rgb *= mix(vec3(1.0), vec3(0.95, 0.87, 0.72), neck * 0.7 * (1.0 - cutFace));
    diffuseColor.rgb *= mix(vec3(1.0), vec3(0.9, 0.93, 0.97), cutFace);
    diffuseColor.rgb *= 0.97 + 0.06 * sNoise(sp * 9.0);
  #elif SURF_KIND == 2
    diffuseColor.rgb *= 0.97 + 0.05 * sNoise(sp * 9.0);
  #elif SURF_KIND == 3
    // Дентин на срезе: канальцы — тонкие S-образные линии от пульпы к эмали (в корне — поперёк корня)
    vec2 q = abs(vSurfNrm.x) > abs(vSurfNrm.z) ? vec2(sp.z, sp.y) : vec2(sp.x, sp.y);
    vec2 c = q - vec2(abs(vSurfNrm.x) > abs(vSurfNrm.z) ? 0.0 : (q.x < 0.0 ? -0.18 : 0.18), 0.2);
    float r = length(c);
    float crownPhase = atan(c.y, c.x) * 44.0 + 1.6 * sin(r * 16.0) + 1.5 * sNoise(sp * 22.0);
    float rootPhase = q.y * 120.0 + 2.0 * sin(q.x * 25.0) + 1.5 * sNoise(sp * 22.0);
    float inCrown = smoothstep(-0.12, 0.12, sp.y);
    float lineC = pow(0.5 + 0.5 * sin(crownPhase), 6.0) * (1.0 - smoothstep(0.7, 1.5, fwidth(crownPhase)));
    float lineR = pow(0.5 + 0.5 * sin(rootPhase), 6.0) * (1.0 - smoothstep(0.7, 1.5, fwidth(rootPhase)));
    float tub = mix(lineR, lineC, inCrown);
    diffuseColor.rgb *= 1.0 - 0.15 * tub * cutFace;
    // Ближе к пульпе дентин темнее и насыщеннее
    diffuseColor.rgb *= mix(vec3(1.0), vec3(0.93, 0.86, 0.74), (1.0 - smoothstep(0.1, 0.38, r)) * inCrown * 0.8);
    diffuseColor.rgb *= 0.96 + 0.08 * sNoise(sp * 12.0);
  #elif SURF_KIND == 4
    // Пульпа: пятнистая, с сосудистой сеткой потемнее
    float vessels = smoothstep(0.55, 0.75, sNoise(sp * 26.0) * 0.6 + sNoise(sp * 70.0) * 0.4);
    diffuseColor.rgb *= (0.9 + 0.2 * sNoise(sp * 14.0)) * (1.0 - 0.25 * vessels);
  #elif SURF_KIND == 5
    // Десна: розовая неоднородная, у края светлее
    diffuseColor.rgb *= 0.95 + 0.07 * sNoise(sp * 14.0) + 0.03 * sNoise(sp * 60.0) * sFade(60.0, pix);
  #elif SURF_KIND == 6 || SURF_KIND == 7
    diffuseColor.rgb *= 0.94 + 0.1 * sNoise(sp * 20.0);
  #endif
}
`

const BUMP = /* glsl */ `
#include <normal_fragment_maps>
#if SURF_KIND != 0 && SURF_KIND != 3
{
  float pix = length(fwidth(vSurfPos));
  // На плоскости среза рельефа нет — это распил
  float hb = sHeight(vSurfPos, pix) * SURF_RELIEF * (1.0 - sOnCut(vSurfPos, vSurfNrm));
  vec3 dpx = dFdx(-vViewPosition);
  vec3 dpy = dFdy(-vViewPosition);
  vec3 r1 = cross(dpy, normal);
  vec3 r2 = cross(normal, dpx);
  float det = dot(dpx, r1);
  vec3 grad = sign(det) * (dFdx(hb) * r1 + dFdy(hb) * r2);
  normal = normalize(abs(det) * normal - grad);
}
#endif
`

const AO = /* glsl */ `
#include <aomap_fragment>
#ifdef SURF_AO
{
  float occl = vSurfAo;
  reflectedLight.indirectDiffuse *= occl;
  reflectedLight.indirectSpecular *= occl * occl;
  reflectedLight.directDiffuse *= mix(1.0, occl, 0.6);
  reflectedLight.directSpecular *= mix(1.0, occl, 0.7);
  #ifdef USE_CLEARCOAT
    clearcoatSpecularIndirect *= occl * occl;
    clearcoatSpecularDirect *= mix(1.0, occl, 0.7);
  #endif
}
#endif
`

/** Обёрнутый диффуз: часть света за терминатором, тёплым цветом «из глубины». */
function lightsChunk(): string {
  const src = THREE.ShaderChunk.lights_physical_pars_fragment
  const a = 'vec3 irradiance = dotNL * directLight.color;'
  const b = 'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );'
  if (!src.includes(a)) return src
  let out = src.replace(a, `${a}
	#ifdef SURF_SSS
		float wrapNL = saturate( ( dot( geometryNormal, directLight.direction ) + SURF_SSS ) / ( 1.0 + SURF_SSS ) );
		vec3 sssIrradiance = max( wrapNL - dotNL, 0.0 ) * directLight.color * surfSssColor;
	#endif`)
  if (out.includes(b)) {
    out = out.replace(b, `${b}
	#ifdef SURF_SSS
		reflectedLight.directDiffuse += sssIrradiance * BRDF_Lambert( material.diffuseColor );
	#endif`)
  } else {
    // Другая версия three.js: без рассеяния, но шейдер собирается
    out = out.replace(/#ifdef SURF_SSS[\s\S]*?#endif/, '')
  }
  return out
}

/** Подключить «живую» поверхность к материалу. Повторный вызов на клоне — так же (onBeforeCompile не копируется). */
export function applySurface<M extends THREE.MeshPhysicalMaterial>(mat: M, opts: SurfaceOptions, relief = 1): M {
  mat.userData.surface = opts
  const sssColor = new THREE.Color(opts.sssColor ?? '#ffb59a')
  mat.onBeforeCompile = (shader) => {
    shader.defines ??= {}
    shader.defines.SURF_KIND = KIND_ID[opts.kind]
    shader.defines.SURF_RELIEF = relief.toFixed(3)
    shader.defines.SURF_CUT_X = CUT_X.toFixed(4)
    if (opts.ao) shader.defines.SURF_AO = ''
    if (opts.sss) {
      shader.defines.SURF_SSS = opts.sss.toFixed(3)
      shader.uniforms.surfSssColor = { value: sssColor }
    }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
varying vec3 vSurfPos;
varying vec3 vSurfNrm;
#ifdef SURF_AO
attribute float ao;
varying float vSurfAo;
#endif`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vSurfPos = transformed;
vSurfNrm = objectNormal;
#ifdef SURF_AO
vSurfAo = ao;
#endif`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
${NOISE}
#ifdef SURF_SSS
uniform vec3 surfSssColor;
#endif`)
      .replace('#include <lights_physical_pars_fragment>', lightsChunk())
      .replace('#include <color_fragment>', COLOR)
      .replace('#include <normal_fragment_maps>', BUMP)
      .replace('#include <aomap_fragment>', AO)
  }
  mat.customProgramCacheKey = () => `surf:${opts.kind}:${opts.ao ? 1 : 0}:${opts.sss ?? 0}:${relief}`
  mat.needsUpdate = true
  return mat
}

/** Клон материала вместе с «живой» поверхностью (подсветка выбранного зуба). */
export function cloneSurface<M extends THREE.MeshPhysicalMaterial>(mat: M): M {
  const copy = mat.clone() as M
  const opts = mat.userData.surface as SurfaceOptions | undefined
  if (opts) applySurface(copy, opts)
  return copy
}
