import * as THREE from 'three'

import { applySurface } from './surface'

/**
 * Материалы тканей. MeshPhysicalMaterial — «физический» материал three.js: шероховатость, лак
 * (clearcoat — как влажная эмаль), «бархат» (sheen — мягкие ткани). Цвета подобраны как в атласе:
 * эмаль — белая с лёгким глянцем, дентин — тёплый жёлтый, пульпа — красная.
 */
export function createMaterials() {
  const phys = (p: THREE.MeshPhysicalMaterialParameters) => new THREE.MeshPhysicalMaterial(p)
  const spongyMap = trabecularTexture()
  const m = {
    // Эмаль: цвет слоновой кости (не «бумажный» белый), тонкий влажный лак сверху — блик острый,
    // сама эмаль под ним матовее; лёгкое рассеяние внутри — как у настоящей полупрозрачной эмали
    enamel: phys({ color: '#efe7d6', roughness: 0.42, clearcoat: 0.85, clearcoatRoughness: 0.09, specularIntensity: 0.7 }),
    dentin: phys({ color: '#e4c68f', roughness: 0.62, clearcoat: 0.08 }),
    pulp: phys({ color: '#b8423f', roughness: 0.5, sheen: 0.5, sheenColor: new THREE.Color('#ff9a9a'), clearcoat: 0.35, clearcoatRoughness: 0.2 }),
    cementum: phys({ color: '#d2b077', roughness: 0.75 }),
    pdl: phys({ color: '#c96f69', roughness: 0.65, sheen: 0.4, sheenColor: new THREE.Color('#ffc0c0'), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    cortical: phys({ color: '#e6dcc6', roughness: 0.66, clearcoat: 0.1 }),
    spongy: phys({ color: '#ffffff', map: spongyMap, roughness: 0.85 }),
    gum: phys({ color: '#e0868b', roughness: 0.5, clearcoat: 0.6, clearcoatRoughness: 0.14, sheen: 0.35, sheenColor: new THREE.Color('#ffc6cc') }),
    cariesSpot: phys({ color: '#f7f4ea', roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    caries: phys({ color: '#4b2c17', roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    gutta: phys({ color: '#e7774f', roughness: 0.5, clearcoat: 0.3, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    filling: phys({ color: '#e6e2d6', roughness: 0.32, clearcoat: 0.8, clearcoatRoughness: 0.1, emissive: new THREE.Color('#3aa0ff'), emissiveIntensity: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    ceramic: phys({ color: '#f1ebdd', roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.06 }),
    titanium: phys({ color: '#c3c8ce', metalness: 1, roughness: 0.32 }),
    titaniumDark: phys({ color: '#9aa1a9', metalness: 1, roughness: 0.4 }),
    steel: phys({ color: '#d9dde2', metalness: 1, roughness: 0.22 }),
    handle: phys({ color: '#f2c230', roughness: 0.4, clearcoat: 0.5 }),
    artery: phys({ color: '#d0302f', roughness: 0.35, clearcoat: 0.6 }),
    vein: phys({ color: '#3a5fb8', roughness: 0.35, clearcoat: 0.6 }),
    nerve: phys({ color: '#efd27a', roughness: 0.4, clearcoat: 0.4 }),
    // Зубы челюсти: цвет по вершинам (тёплая шейка, полупрозрачный режущий край — считает воркер)
    toothJaw: phys({ color: '#ffffff', vertexColors: true, roughness: 0.4, clearcoat: 0.85, clearcoatRoughness: 0.08, specularIntensity: 0.7 }),
    // Десна челюсти: цвет по вершинам (у края светлее, к переходной складке краснее), влажная
    gumJaw: phys({ color: '#ffffff', vertexColors: true, roughness: 0.5, clearcoat: 0.6, clearcoatRoughness: 0.14, sheen: 0.35, sheenColor: new THREE.Color('#ffc6cc'), side: THREE.DoubleSide }),
    // Кость «как на снимке»: полупрозрачная, со своим тёплым свечением — иначе на тёмном фоне она серая
    boneGlass: phys({ color: '#fff3dc', emissive: new THREE.Color('#e9d5ad'), emissiveIntensity: 0.7, roughness: 0.85, transparent: true, opacity: 0.72, depthWrite: false }),
  }
  // «Живая» поверхность (surface.ts). AO — только у сеток из воркера: у них есть атрибут ao
  applySurface(m.enamel, { kind: 'enamel', ao: true, sss: 0.45, sssColor: '#ffe2cc' })
  applySurface(m.toothJaw, { kind: 'tooth', ao: true, sss: 0.45, sssColor: '#ffe2cc' })
  applySurface(m.ceramic, { kind: 'tooth', ao: true, sss: 0.35, sssColor: '#ffd9b8' }, 0.4)
  applySurface(m.dentin, { kind: 'dentin', ao: true, sss: 0.3, sssColor: '#ffb070' })
  applySurface(m.pulp, { kind: 'pulp', ao: true, sss: 0.5, sssColor: '#ff6050' })
  applySurface(m.cementum, { kind: 'cementum', ao: true })
  applySurface(m.pdl, { kind: 'plain', ao: true })
  applySurface(m.cortical, { kind: 'bone', ao: true, sss: 0.25, sssColor: '#ffd6a8' })
  applySurface(m.spongy, { kind: 'plain', ao: true })
  applySurface(m.gum, { kind: 'gum', ao: true, sss: 0.6, sssColor: '#ff7a70' })
  applySurface(m.gumJaw, { kind: 'gum', sss: 0.6, sssColor: '#ff7a70' })
  for (const mat of [m.caries, m.cariesSpot, m.gutta, m.filling]) applySurface(mat, { kind: 'plain', ao: true })
  return {
    ...m,
    dispose() {
      for (const mat of Object.values(m)) mat.dispose()
      spongyMap.dispose()
    },
  }
}
export type Materials = ReturnType<typeof createMaterials>

/** Узор губчатой кости: светлые перекладины и розоватые «поры» — рисуем на canvas один раз. */
function trabecularTexture(): THREE.Texture {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.fillStyle = '#efdcb9'
    ctx.fillRect(0, 0, size, size)
    // Детерминированный «случай»: картинка одна и та же при каждом открытии
    let seed = 7
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (let i = 0; i < 120; i++) {
      const x = rnd() * size, y = rnd() * size, r = 6 + rnd() * 13
      const ry = r * (0.6 + rnd() * 0.6), rot = rnd() * Math.PI
      ctx.fillStyle = rnd() > 0.5 ? '#c4796c' : '#d49883'
      // Копии у краёв — чтобы узор повторялся без шва
      for (const [dx, dy] of [[0, 0], [size, 0], [-size, 0], [0, size], [0, -size]] as const) {
        ctx.beginPath()
        ctx.ellipse(x + dx, y + dy, r, ry, rot, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}
