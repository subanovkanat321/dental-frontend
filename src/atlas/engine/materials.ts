import * as THREE from 'three'

/**
 * Материалы тканей. MeshPhysicalMaterial — «физический» материал three.js: шероховатость, лак
 * (clearcoat — как влажная эмаль), «бархат» (sheen — мягкие ткани). Цвета подобраны как в атласе:
 * эмаль — белая с лёгким глянцем, дентин — тёплый жёлтый, пульпа — красная.
 */
export function createMaterials() {
  const phys = (p: THREE.MeshPhysicalMaterialParameters) => new THREE.MeshPhysicalMaterial(p)
  const spongyMap = trabecularTexture()
  const m = {
    enamel: phys({ color: '#f3efe6', roughness: 0.28, clearcoat: 0.7, clearcoatRoughness: 0.18, sheen: 0.2, sheenColor: new THREE.Color('#ffffff') }),
    dentin: phys({ color: '#e7c98e', roughness: 0.55, clearcoat: 0.15 }),
    pulp: phys({ color: '#c43d3f', roughness: 0.45, sheen: 0.6, sheenColor: new THREE.Color('#ff9a9a'), clearcoat: 0.3 }),
    cementum: phys({ color: '#d4ad62', roughness: 0.7 }),
    pdl: phys({ color: '#d0716f', roughness: 0.65, sheen: 0.4, sheenColor: new THREE.Color('#ffc0c0'), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    cortical: phys({ color: '#ebe1cc', roughness: 0.6, clearcoat: 0.1 }),
    spongy: phys({ color: '#ffffff', map: spongyMap, roughness: 0.85 }),
    gum: phys({ color: '#e07f86', roughness: 0.42, clearcoat: 0.45, clearcoatRoughness: 0.3, sheen: 0.5, sheenColor: new THREE.Color('#ffd0d4') }),
    cariesSpot: phys({ color: '#fbfaf5', roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    caries: phys({ color: '#4b2c17', roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    gutta: phys({ color: '#e7774f', roughness: 0.5, clearcoat: 0.3, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    filling: phys({ color: '#cfe0ea', roughness: 0.3, clearcoat: 0.8, emissive: new THREE.Color('#3aa0ff'), emissiveIntensity: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    ceramic: phys({ color: '#f8f5ee', roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.08 }),
    titanium: phys({ color: '#c3c8ce', metalness: 1, roughness: 0.32 }),
    titaniumDark: phys({ color: '#9aa1a9', metalness: 1, roughness: 0.4 }),
    steel: phys({ color: '#d9dde2', metalness: 1, roughness: 0.22 }),
    handle: phys({ color: '#f2c230', roughness: 0.4, clearcoat: 0.5 }),
    artery: phys({ color: '#e0262b', roughness: 0.35, clearcoat: 0.6 }),
    vein: phys({ color: '#2f5fd0', roughness: 0.35, clearcoat: 0.6 }),
    nerve: phys({ color: '#f4d35e', roughness: 0.4, clearcoat: 0.4 }),
    toothJaw: phys({ color: '#ffffff', vertexColors: true, roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.2 }),
    gumJaw: phys({ color: '#de7c84', roughness: 0.4, clearcoat: 0.45, clearcoatRoughness: 0.3, sheen: 0.5, sheenColor: new THREE.Color('#ffd0d4'), side: THREE.DoubleSide }),
    boneGlass: phys({ color: '#f4e2bf', roughness: 0.6, transparent: true, opacity: 0.62, depthWrite: false }),
  }
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
