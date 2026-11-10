import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'

import { ALL_FDI, isUpper } from '../fdi'
import { buildJawShapes, toothPlacement, shapeOf, JAW_GAP } from '../geometry/jawModel'
import { buildLearn, isSegment, type LearnGeoId, type LearnId, type LearnMat } from '../geometry/learnModel'
import type { MeshData } from '../geometry/mesher'
import type { CustomScene } from './engine'
import { gumGeometry } from './jawScene'
import type { Materials } from './materials'
import { applySurface, cloneSurface } from './surface'
import { buildVessels } from './toothScene'

/**
 * Сцены презентаций «Для пациента» в 3D-атласе: состояния зуба (learnModel), улыбка «до и после
 * отбеливания» и шкала оттенков. Те же материалы, свет и камера, что у атласа: движок показывает их через
 * setCustom. Только для служебной страницы кадров tools/learn-art — в сборку CRM не входит.
 *
 * Ролики (время t — секунды с replay): заживление лунки, нанесение герметика, отбеливание.
 */
export type { LearnId } from '../geometry/learnModel'

export function createLearnScene(m: Materials, id: LearnId): CustomScene {
  const root = new THREE.Group()
  const bag: { dispose(): void }[] = []
  let update: (t: number) => void = () => undefined
  let floorY: number | undefined

  if (id === 'whiten-split' || id === 'whiten') {
    update = smile(m, root, bag, id === 'whiten-split')
    // «Пол» далеко внизу — без тени под челюстью (в кадре улыбки она пятном у края)
    floorY = -50
  }
  else if (id === 'shades') {
    shadeGuide(m, root, bag)
    floorY = -0.95
  }
  else {
    const geo: LearnGeoId = id === 'socket-heal' ? 'socket' : id === 'sealant-apply' ? 'sealant' : id
    const meshes = buildLearn(geo)
    const mats = learnMaterials(m, id, bag)
    const byName = new Map<string, THREE.Mesh>()
    for (const { name, mat, mesh } of meshes) {
      const g = toGeometry(mesh)
      bag.push(g)
      const obj = new THREE.Mesh(g, mats(mat, name))
      obj.name = name
      obj.castShadow = true
      obj.receiveShadow = true
      // Налёт, кариес, пятно, камень — поверх тканей (совпадающие грани), рисуем позже
      if (['caries', 'spot', 'tartar', 'tartarDeep', 'plaque', 'sealant', 'filling', 'gutta', 'pdl', 'lesion', 'clot'].includes(mat)) obj.renderOrder = 1
      byName.set(name, obj)
      root.add(obj)
    }
    // Живой зуб в разрезе — с сосудами и нервом, как в атласе
    if (!isSegment(geo) && byName.has('pulp') && !['pulp-dead', 'abscess', 'kid', 'kid-caries', 'kid-deep'].includes(geo)) {
      const v = buildVessels(m, bag as unknown as THREE.BufferGeometry[])
      root.add(v)
    }
    floorY = isSegment(geo) ? -3.0 : undefined
    if (id === 'socket-heal') update = healClip(byName, bag)
    else if (id === 'sealant-apply') update = sealantClip(byName, root, bag)
  }
  return {
    root,
    floorY,
    update,
    dispose() {
      for (const d of bag) d.dispose()
    },
  }
}

const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)
const phase = (t: number, a: number, b: number) => ease((t - a) / (b - a))
const phys = (p: THREE.MeshPhysicalMaterialParameters) => new THREE.MeshPhysicalMaterial(p)

/** Материалы сцены: свои клоны там, где цвет или срез отличаются от атласа. */
function learnMaterials(m: Materials, id: LearnId, bag: { dispose(): void }[]): (mat: LearnMat, name: string) => THREE.Material {
  const own = <T extends THREE.Material>(x: T): T => { bag.push(x); return x }
  const dead = id === 'pulp-dead' || id === 'abscess'
  const crack = id === 'crack-line' ? 0.42 : id === 'crack-split' ? -1.35 : null
  const withCrack = (mat: THREE.MeshPhysicalMaterial) => (crack == null ? mat : own(addCrack(cloneSurface(mat), crack, id === 'crack-split')))
  const cache = new Map<string, THREE.Material>()
  const make = (mat: LearnMat, name: string): THREE.Material => {
    switch (mat) {
      case 'enamel': {
        if (dead) { const e = own(cloneSurface(m.enamel)); e.color.set('#ddd5c8'); return e }
        return withCrack(m.enamel)
      }
      case 'dentin': return withCrack(m.dentin)
      case 'cementum': return withCrack(m.cementum)
      case 'pulp': {
        if (dead) {
          // Погибшая пульпа: серо-бурая, без «живого» блеска
          const p = own(cloneSurface(m.pulp))
          p.color.set('#6f625c')
          p.sheen = 0
          p.clearcoat = 0.1
          return p
        }
        if (id === 'kid-deep') {
          const p = own(cloneSurface(m.pulp))
          p.emissive.set('#ff2a1a')
          p.emissiveIntensity = 0.35
          return p
        }
        return m.pulp
      }
      case 'pdl': return m.pdl
      case 'cortical': return m.cortical
      case 'spongy': return m.spongy
      case 'gum': {
        // Цвет по вершинам — воспаление у края (learnModel.tintGum)
        const g = own(cloneSurface(m.gum))
        g.vertexColors = true
        return g
      }
      case 'caries': return m.caries
      case 'tooth': return m.toothJaw
      case 'filling': {
        // У атласа у пломбы плоскость «наполнения» (ролик) — здесь пломба целиком
        const f = withCrack(own(cloneSurface(m.filling)))
        f.clippingPlanes = null
        return f
      }
      case 'gutta': { const g = own(cloneSurface(m.gutta)); g.clippingPlanes = null; return g }
      case 'spot':
        // Белое пятно — меловое, матовое, без блеска влажной эмали: на глянце его видно
        return own(applySurface(phys({ color: '#ffffff', roughness: 1, emissive: new THREE.Color('#f4f8ff'), emissiveIntensity: 0.38, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), { kind: 'plain', ao: true }))
      case 'tartar':
        return own(applySurface(phys({ color: '#dac58f', roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }), { kind: 'bone', ao: true }))
      case 'tartarDeep':
        return own(applySurface(phys({ color: '#7a5a38', roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }), { kind: 'bone', ao: true }))
      case 'plaque':
        return own(applySurface(phys({ color: '#eee2b6', roughness: 0.6, transparent: true, opacity: 0.88, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }), { kind: 'cementum', ao: true }))
      case 'lesion':
        return own(applySurface(phys({ color: '#7d2a27', roughness: 0.55, sheen: 0.3, sheenColor: new THREE.Color('#ff8a80'), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }), { kind: 'pulp', ao: true, sss: 0.4, sssColor: '#ff5040' }))
      case 'sealant':
        return own(applySurface(phys({ color: '#d8e8f2', roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.08, transparent: true, opacity: 0.8, emissive: new THREE.Color('#3aa0ff'), emissiveIntensity: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), { kind: 'plain', ao: true }))
      case 'clot':
        // Сгусток — тёмно-красный, влажный, без натурализма
        return own(applySurface(phys({ color: '#7a2526', roughness: 0.38, clearcoat: 0.6, clearcoatRoughness: 0.12, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }), { kind: 'pulp', ao: true, sss: 0.3, sssColor: '#ff3020' }))
      case 'newBone': { const b = own(cloneSurface(m.spongy)); b.color.set('#fff8ee'); return b }
      case 'kidEnamel': { const e = own(cloneSurface(m.enamel)); e.color.set('#f6f4ef'); return e }
      case 'germPulp': return own(applySurface(phys({ color: '#e7a3a0', roughness: 0.55, sheen: 0.4, sheenColor: new THREE.Color('#ffc0c0') }), { kind: 'pulp', ao: true, sss: 0.5, sssColor: '#ff7060' }))
      case 'follicle': return own(applySurface(phys({ color: '#d98d88', roughness: 0.6, sheen: 0.4, sheenColor: new THREE.Color('#ffc0c0'), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }), { kind: 'plain', ao: true }))
    }
    void name
    return m.dentin
  }
  return (mat, name) => {
    // У роликов у каждой анимированной сетки свой материал (плоскости среза)
    const key = ['clot', 'newBone', 'sealant'].includes(mat) || name === 'gumCap' ? `${mat}:${name}` : mat
    let x = cache.get(key)
    if (!x) { x = make(mat, name); cache.set(key, x) }
    return x
  }
}

/**
 * Трещина: тонкая тёмная линия по неровной вертикальной плоскости x ≈ 0,08 — на жевательной поверхности и на
 * срезе. lo — до какой глубины (у «уходит в корень» — до середины корня). Рисуем шейдером, а не сеткой: линия
 * в доли миллиметра на сетке 0,2 мм не получилась бы.
 */
function addCrack<M extends THREE.MeshPhysicalMaterial>(mat: M, lo: number, wide: boolean): M {
  const prev = mat.onBeforeCompile
  const prevKey = mat.customProgramCacheKey()
  mat.onBeforeCompile = (shader, renderer) => {
    prev.call(mat, shader, renderer)
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
{
  vec3 cp = vSurfPos;
  float cx = 0.08 + 0.03 * sin(cp.y * 11.0 + 1.3) + 0.018 * sin(cp.z * 17.0 + 0.4) + 0.014 * (sNoise(cp * 28.0) - 0.5);
  float d = abs(cp.x - cx);
  float w = ${wide ? '0.011' : '0.008'} * (0.5 + 0.7 * smoothstep(${lo.toFixed(2)}, 0.95, cp.y));
  float aa = max(fwidth(cp.x) * 1.3, 0.0008);
  float crackM = (1.0 - smoothstep(w, w + aa, d)) * smoothstep(${(lo - 0.06).toFixed(2)}, ${(lo + 0.06).toFixed(2)}, cp.y) * (1.0 - step(0.02, cp.z));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.13, 0.09), crackM * 0.92);
}`)
  }
  mat.customProgramCacheKey = () => `${prevKey}:crack:${lo}:${wide}`
  mat.needsUpdate = true
  return mat
}

/** Ролик «заживление лунки»: кость растёт снизу, сгусток светлеет и уходит, десна затягивает лунку с краёв. */
function healClip(by: Map<string, THREE.Mesh>, bag: { dispose(): void }[]): (t: number) => void {
  void bag
  const clot = by.get('clot'), bone = by.get('newBone'), cap = by.get('gumCap')
  const clotPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  const bonePlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0)
  const capA = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0)
  const capB = new THREE.Plane(new THREE.Vector3(1, 0, 0), 0)
  const clotMat = clot?.material as THREE.MeshPhysicalMaterial | undefined
  const set = (mesh: THREE.Mesh | undefined, planes: THREE.Plane[], inter = false) => {
    if (!mesh) return
    const mat = mesh.material as THREE.Material
    mat.clippingPlanes = planes
    mat.clipIntersection = inter
    mat.clipShadows = true
  }
  set(clot, [clotPlane])
  set(bone, [bonePlane])
  set(cap, [capA, capB], true)
  const dark = new THREE.Color('#7a2526'), granulation = new THREE.Color('#b6474a')
  return (t) => {
    // Уровень новой кости: от верхушек корней до гребня (−1,95 → 0,1), сгусток — только выше него
    const level = -1.95 + 2.05 * phase(t, 0.5, 2.9)
    bonePlane.constant = level
    clotPlane.constant = -level
    clotMat?.color.copy(dark).lerp(granulation, phase(t, 0.4, 2.0))
    // Десна затягивает отверстие с двух сторон к середине
    const close = phase(t, 1.6, 3.3)
    capA.constant = -0.7 + 0.72 * close
    capB.constant = -0.75 + 0.73 * close
    if (cap) cap.visible = close > 0.001
  }
}

/** Ролик «герметик»: жидкий материал заполняет фиссуры снизу вверх, лампа отверждает. */
function sealantClip(by: Map<string, THREE.Mesh>, root: THREE.Group, bag: { dispose(): void }[]): (t: number) => void {
  const s = by.get('sealant')
  const mat = s?.material as THREE.MeshPhysicalMaterial | undefined
  const plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0)
  if (mat) { mat.clippingPlanes = [plane]; mat.clipShadows = true }
  // Световод лампы: стальной стержень и синий конус света над зубом
  const body = new THREE.CylinderGeometry(0.1, 0.1, 1.0, 24)
  body.rotateZ(-0.5)
  body.translate(0.35, 1.75, 0.15)
  const glow = new THREE.ConeGeometry(0.42, 0.75, 32, 1, true)
  glow.translate(0, 1.2, -0.05)
  const glowMat = new THREE.MeshBasicMaterial({ color: '#4aa8ff', transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide })
  const steel = new THREE.MeshPhysicalMaterial({ color: '#d9dde2', metalness: 1, roughness: 0.22 })
  const lamp = new THREE.Group()
  lamp.add(new THREE.Mesh(body, steel), new THREE.Mesh(glow, glowMat))
  root.add(lamp)
  bag.push(body, glow, glowMat, steel)
  return (t) => {
    plane.constant = 0.62 + 0.45 * phase(t, 0.4, 2.4)
    const cure = t > 2.7 && t < 3.7
    lamp.visible = cure
    if (mat) mat.emissiveIntensity = cure ? 0.45 + 0.15 * Math.sin(t * 20) : 0
  }
}

// ——— Отбеливание: передние зубы в десне, вид спереди ———

/** Оттенок эмали «до» (желтоватый, ~A3,5) и «после» (светлый, ~B1) — множитель к цвету зуба по вершинам. */
const BEFORE = new THREE.Color('#efdcae')
const AFTER = new THREE.Color('#ffffff')

/**
 * Улыбка: верхние и нижние зубы до шестых, десна — как у челюсти атласа; рот закрыт (нижние подняты к
 * верхним). split — половина «до» (справа у пациента, на кадре слева), половина «после»; иначе ролик:
 * оттенок всех зубов меняется от «до» к «после».
 */
function smile(m: Materials, root: THREE.Group, bag: { dispose(): void }[], split: boolean): (t: number) => void {
  const shapes = new Map(buildJawShapes(0.022).map(([name, mesh]) => [name, toGeometry(mesh)]))
  for (const g of shapes.values()) bag.push(g)
  const before = cloneSurface(m.toothJaw)
  const after = cloneSurface(m.toothJaw)
  before.color.copy(BEFORE)
  after.color.copy(AFTER)
  bag.push(before, after)
  const lower = new THREE.Group()
  // Нижние зубы — к верхним: прикус с перекрытием резцов ~2 мм
  lower.position.y = 2 * JAW_GAP + 0.2
  root.add(lower)
  for (const fdi of ALL_FDI) {
    if (fdi % 10 > 6) continue
    const p = toothPlacement(fdi)
    const place = new THREE.Group()
    place.position.set(p.x, p.y, p.z)
    place.rotation.set(0, p.rotY, p.upper ? Math.PI : 0, 'YXZ')
    const flip = p.mirror ? -1 : 1
    const mat = split ? (p.x < 0 ? before : after) : before
    const mesh = new THREE.Mesh(shapes.get(shapeOf(fdi)), mat)
    mesh.rotation.set(p.torque, flip * p.twist, flip * p.tip, 'YXZ')
    mesh.scale.set(flip * p.scale, p.scale, p.scale)
    mesh.castShadow = mesh.receiveShadow = true
    place.add(mesh)
    ;(isUpper(fdi) ? root : lower).add(place)
  }
  for (const upper of [true, false]) {
    const g = gumGeometry(upper)
    bag.push(g)
    const gum = new THREE.Mesh(g, m.gumJaw)
    gum.receiveShadow = true
    ;(upper ? root : lower).add(gum)
  }
  return (t) => {
    if (split) return
    before.color.copy(BEFORE).lerp(AFTER, phase(t, 0.5, 3.0))
  }
}

// ——— Шкала оттенков (как VITA classical): образцы-«зубики» на держателе ———

/** Образцы от светлого к тёмному: подпись и цвет эмали. */
export const SHADES: readonly [string, string][] = [
  ['B1', '#fbf9f3'], ['A1', '#f7f2e6'], ['B2', '#f4ecd8'], ['A2', '#f2e8d2'], ['A3', '#ecdfc0'], ['A3.5', '#e5d4ae'], ['B4', '#e2cfa4'], ['A4', '#d8c497'],
]
/** Шаг образцов по x и их x — для меток кадра. */
export const SHADE_STEP = 0.62
export const shadeX = (i: number) => (i - (SHADES.length - 1) / 2) * SHADE_STEP

function shadeGuide(m: Materials, root: THREE.Group, bag: { dispose(): void }[]): void {
  // Коронка центрального резца (форма атласа) без корня — на стержне в держателе
  const tab = buildJawShapes(0.02).find(([n]) => n === 'incisorUpperCentral')![1]
  const geo = toGeometry(cropCrown(tab))
  bag.push(geo)
  const stemGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.5, 20)
  const metal = new THREE.MeshPhysicalMaterial({ color: '#c9ced4', metalness: 1, roughness: 0.3 })
  bag.push(stemGeo, metal)
  SHADES.forEach(([, hex], i) => {
    const c = new THREE.Color(hex)
    const mat = cloneSurface(m.toothJaw)
    mat.color.copy(c)
    bag.push(mat)
    const t = new THREE.Mesh(geo, mat)
    // Образец меньше зуба: ~0,65 центрального резца, тоньше
    t.scale.set(0.66, 0.66, 0.55)
    t.position.set(shadeX(i), 0, 0)
    t.castShadow = t.receiveShadow = true
    const stem = new THREE.Mesh(stemGeo, metal)
    stem.position.set(shadeX(i), -0.3, -0.02)
    stem.castShadow = true
    root.add(t, stem)
  })
  // Держатель — серый пластик, на нём подписи
  const w = SHADES.length * SHADE_STEP + 0.3
  const holderGeo = new RoundedBoxGeometry(w, 0.42, 0.34, 4, 0.08)
  holderGeo.translate(0, -0.72, -0.02)
  const tex = shadeLabels(w)
  const holderMat = new THREE.MeshPhysicalMaterial({ color: '#5b6268', roughness: 0.45, clearcoat: 0.4 })
  const labelGeo = new THREE.PlaneGeometry(w - 0.1, 0.3)
  labelGeo.translate(0, -0.72, 0.151)
  const labelMat = new THREE.MeshPhysicalMaterial({ map: tex, transparent: true, roughness: 0.6 })
  bag.push(holderGeo, holderMat, labelGeo, labelMat, tex)
  const holder = new THREE.Mesh(holderGeo, holderMat)
  holder.castShadow = holder.receiveShadow = true
  root.add(holder, new THREE.Mesh(labelGeo, labelMat))
}

/** Коронка формы резца: вершины ниже шейки отбрасываем (треугольники с ними — тоже). */
function cropCrown(mesh: MeshData): MeshData {
  const keep = new Int32Array(mesh.positions.length / 3).fill(-1)
  const pos: number[] = [], nrm: number[] = [], col: number[] = [], ao: number[] = []
  for (let v = 0; v < keep.length; v++) {
    if (mesh.positions[v * 3 + 1]! < -0.06) continue
    keep[v] = pos.length / 3
    for (let k = 0; k < 3; k++) { pos.push(mesh.positions[v * 3 + k]!); nrm.push(mesh.normals[v * 3 + k]!); col.push(mesh.colors![v * 3 + k]!) }
    ao.push(mesh.ao![v]!)
  }
  const idx: number[] = []
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const a = keep[mesh.indices[i]!]!, b = keep[mesh.indices[i + 1]!]!, c = keep[mesh.indices[i + 2]!]!
    if (a >= 0 && b >= 0 && c >= 0) idx.push(a, b, c)
  }
  return { positions: new Float32Array(pos), normals: new Float32Array(nrm), colors: new Float32Array(col), ao: new Float32Array(ao), indices: new Uint32Array(idx) }
}

/** Подписи образцов на держателе — белым по серому. */
function shadeLabels(w: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 2048
  canvas.height = Math.round(2048 * (0.3 / (w - 0.1)))
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#f2f4f5'
  ctx.font = `600 ${Math.round(canvas.height * 0.6)}px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  SHADES.forEach(([name], i) => ctx.fillText(name, ((shadeX(i) + (w - 0.1) / 2) / (w - 0.1)) * canvas.width, canvas.height / 2))
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return tex
}

function toGeometry(mesh: MeshData): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3))
  g.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3))
  if (mesh.uvs) g.setAttribute('uv', new THREE.BufferAttribute(mesh.uvs, 2))
  if (mesh.colors) g.setAttribute('color', new THREE.BufferAttribute(mesh.colors, 3))
  if (mesh.ao) g.setAttribute('ao', new THREE.BufferAttribute(mesh.ao, 1))
  g.setIndex(new THREE.BufferAttribute(mesh.indices, 1))
  g.computeBoundingSphere()
  return g
}
