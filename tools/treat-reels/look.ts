import * as THREE from 'three'

/**
 * Добавки к «живой» поверхности атласа (src/atlas/engine/surface.ts) — только для рилсов, атлас не меняется.
 * surface.ts уже вставил в шейдер шум sNoise и координаты модели vSurfPos; здесь поверх него:
 *
 * - wet: мокрая поверхность — лак (clearcoat) с разной резкостью бликов пятнами: слюна и вода лежат
 *   неровно, где-то зеркальный блик, где-то размытый;
 * - enamel: эмаль не «гладкий пластик» — бугры к кончикам светлее и голубее (там эмаль толще и
 *   просвечивает), на краях силуэта — лёгкий голубой ореол, едва заметные продольные микротрещинки
 *   (ламеллы эмали) на щёчной стороне, мягкие пятна тона;
 * - gum: десна с сосудистой сеткой (тонкие более красные прожилки) и влажная.
 */
export type Look = 'enamel' | 'gum' | 'wet'

const ENAMEL_COLOR = /* glsl */ `
{
  vec3 lp = vSurfPos;
  // Пятна тона: крупные мягкие, ±3 %
  diffuseColor.rgb *= 0.97 + 0.06 * sNoise(lp * 4.0 + 3.1);
  // Ламеллы: тонкие почти вертикальные линии на боковых поверхностях коронки
  float side = smoothstep(0.25, 0.45, abs(lp.z)) * smoothstep(0.02, 0.15, lp.y) * (1.0 - smoothstep(0.5, 0.68, lp.y));
  float lx = lp.x * 9.0 + 0.6 * sNoise(vec3(lp.y * 3.0, lp.z * 2.0, 1.7));
  float line = pow(1.0 - abs(fract(lx) - 0.5) * 2.0, 60.0) * step(0.62, sNoise(vec3(floor(lx), 3.3, lp.z > 0.0 ? 1.0 : 2.0)));
  float aa = 1.0 - smoothstep(0.6, 1.4, fwidth(lx) * 60.0);
  diffuseColor.rgb *= 1.0 - 0.07 * line * side * aa;
}
`

const ENAMEL_TRANSLUCENT = /* glsl */ `
{
  vec3 lp = vSurfPos;
  float facing = abs(dot(normal, normalize(vViewPosition)));
  float tip = smoothstep(0.6, 0.82, lp.y);
  float rim = (1.0 - facing) * step(0.15, lp.y);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.84, 0.91, 1.02), clamp(tip * 0.55 + rim * 0.35, 0.0, 0.6));
}
`

const GUM_COLOR = /* glsl */ `
{
  vec3 lp = vSurfPos;
  // Прожилки: «гребни» шума (|n − 0,5| мал) — тонкие извилистые линии
  float n1 = abs(sNoise(lp * vec3(9.0, 16.0, 9.0)) - 0.5);
  float n2 = abs(sNoise(lp * vec3(22.0, 34.0, 22.0) + 5.0) - 0.5);
  float vessel = (1.0 - smoothstep(0.0, 0.05, n1)) * 0.7 + (1.0 - smoothstep(0.0, 0.035, n2)) * 0.4;
  float deep = smoothstep(-0.15, -0.6, lp.y);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.92, 0.62, 0.66), vessel * (0.25 + 0.5 * deep));
  diffuseColor.rgb *= 0.95 + 0.1 * sNoise(lp * 7.0);
}
`

const WET = /* glsl */ `
#include <lights_physical_fragment>
#ifdef USE_CLEARCOAT
{
  float wn = sNoise(vSurfPos * 7.0 + 11.0) * 0.65 + sNoise(vSurfPos * 23.0) * 0.35;
  material.clearcoatRoughness = clamp(mix(0.02, 0.22, smoothstep(0.35, 0.75, wn)), 0.0, 1.0);
  material.clearcoat *= mix(0.75, 1.0, smoothstep(0.2, 0.6, wn));
}
#endif
`

/** Подключить добавки к материалу, на котором уже стоит applySurface (onBeforeCompile — цепочкой). */
export function addLook<M extends THREE.MeshPhysicalMaterial>(mat: M, looks: Look[]): M {
  const prev = mat.onBeforeCompile.bind(mat)
  const prevKey = mat.customProgramCacheKey.bind(mat)
  mat.onBeforeCompile = (shader, renderer) => {
    prev(shader, renderer)
    let fs = shader.fragmentShader
    if (looks.includes('enamel')) {
      fs = fs.replace('#include <emissivemap_fragment>', `${ENAMEL_TRANSLUCENT}\n#include <emissivemap_fragment>`)
      // После цветового блока surface.ts (он заканчивается перед картой шероховатости)
      fs = fs.replace('#include <roughnessmap_fragment>', `${ENAMEL_COLOR}\n#include <roughnessmap_fragment>`)
    }
    if (looks.includes('gum')) fs = fs.replace('#include <roughnessmap_fragment>', `${GUM_COLOR}\n#include <roughnessmap_fragment>`)
    if (looks.includes('wet')) fs = fs.replace('#include <lights_physical_fragment>', WET)
    shader.fragmentShader = fs
  }
  mat.customProgramCacheKey = () => `${prevKey()}|look:${looks.join(',')}`
  mat.needsUpdate = true
  return mat
}
