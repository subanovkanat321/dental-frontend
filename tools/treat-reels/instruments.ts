import * as THREE from 'three'

/**
 * Инструменты стоматолога — простые тела three.js (цилиндры, «токарные» профили), но в реальных размерах
 * (единица ≈ 9 мм) и с реальными материалами: сталь отражает окружение, пластик матовый. Начало координат
 * группы — рабочий кончик, ручка уходит вдоль локальной оси +y: сцена ставит кончик к зубу и
 * поворачивает ось ручки куда нужно.
 */
export type ToolName = 'bur' | 'syringe' | 'air' | 'brush' | 'lamp' | 'plug' | 'cup'

export interface Tool {
  group: THREE.Group
  /** Вращающаяся часть (бор, резиновая чашка) — крутится вокруг своей оси y. */
  spin?: THREE.Object3D
  /** Свечение лампы: синий свет и диск на кончике. */
  glow?: { light: THREE.SpotLight; tip: THREE.MeshBasicMaterial; halo: THREE.SpriteMaterial }
}

function lathe(profile: [number, number][], segments = 40): THREE.LatheGeometry {
  return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segments)
}

/** Цилиндр вдоль оси от a до b (для изогнутых трубок из отрезков). */
function tube(points: THREE.Vector3[], r: number): THREE.TubeGeometry {
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 48, r, 20, false)
}

/** Шероховатость «алмазного напыления»: шумовые вершины. Детерминированно. */
function grit(geo: THREE.BufferGeometry, amp: number, seed = 1): THREE.BufferGeometry {
  const p = geo.getAttribute('position') as THREE.BufferAttribute
  const n = geo.getAttribute('normal') as THREE.BufferAttribute
  let s = seed
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647)
  for (let i = 0; i < p.count; i++) {
    const k = (rnd() - 0.5) * amp
    p.setXYZ(i, p.getX(i) + n.getX(i) * k, p.getY(i) + n.getY(i) * k, p.getZ(i) + n.getZ(i) * k)
  }
  geo.computeVertexNormals()
  return geo
}

export function createTools(): Record<ToolName, Tool> {
  const steel = new THREE.MeshPhysicalMaterial({ color: '#e2e6ea', metalness: 1, roughness: 0.18 })
  const satin = new THREE.MeshPhysicalMaterial({ color: '#d0d5db', metalness: 1, roughness: 0.3 })
  const diamond = new THREE.MeshPhysicalMaterial({ color: '#cbb98f', metalness: 0.8, roughness: 0.5 })
  const ring = new THREE.MeshPhysicalMaterial({ color: '#2a63d8', roughness: 0.4, clearcoat: 0.6 })
  const dark = new THREE.MeshPhysicalMaterial({ color: '#2b2f33', roughness: 0.35, clearcoat: 0.7 })

  // ── Турбинный наконечник с алмазным бором ──
  const bur = new THREE.Group()
  const burSpin = new THREE.Group()
  const working = grit(lathe([[0, 0], [0.022, 0.005], [0.034, 0.025], [0.036, 0.36], [0.03, 0.4], [0, 0.4]], 28), 0.01, 3)
  burSpin.add(new THREE.Mesh(working, diamond))
  const neck = new THREE.Mesh(lathe([[0.03, 0.39], [0.035, 0.5], [0.075, 0.6], [0.08, 1.45], [0, 1.45]], 28), steel)
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.083, 0.083, 0.08, 28), ring)
  band.position.y = 0.75
  burSpin.add(neck, band)
  const head = new THREE.Mesh(lathe([[0, 1.32], [0.4, 1.33], [0.5, 1.4], [0.52, 1.9], [0.45, 2.0], [0, 2.02]], 48), satin)
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.03, 24), dark)
  cap.position.y = 1.32
  // Корпус: от головки вбок и чуть вверх (к руке врача)
  const body = new THREE.Mesh(tube([new THREE.Vector3(0, 1.66, 0), new THREE.Vector3(0.9, 1.75, 0), new THREE.Vector3(2.4, 2.2, 0), new THREE.Vector3(6, 3.4, 0)], 0.33), satin)
  bur.add(burSpin, head, cap, body)

  // ── Шприц с гелем протравки (синий) ──
  const etch = new THREE.Group()
  const needle = new THREE.Mesh(tube([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.25, 0), new THREE.Vector3(0.1, 0.55, 0), new THREE.Vector3(0.35, 0.85, 0)], 0.035), steel)
  const hub = new THREE.Mesh(lathe([[0.04, 0], [0.1, 0.05], [0.12, 0.35], [0, 0.36]], 24), new THREE.MeshPhysicalMaterial({ color: '#d9dde4', roughness: 0.4, transparent: true, opacity: 0.9 }))
  hub.position.set(0.35, 0.82, 0)
  hub.rotation.z = -0.7
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 3, 32), new THREE.MeshPhysicalMaterial({ color: '#2b7fe0', roughness: 0.2, clearcoat: 1, transparent: true, opacity: 0.85 }))
  barrel.position.set(0.35 + Math.sin(0.7) * 1.8, 0.82 + Math.cos(0.7) * 1.8, 0)
  barrel.rotation.z = -0.7
  etch.add(needle, hub, barrel)

  // ── Пистолет «вода-воздух» ──
  const air = new THREE.Group()
  air.add(new THREE.Mesh(tube([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.35, 0), new THREE.Vector3(0.25, 0.8, 0), new THREE.Vector3(1.2, 1.6, 0), new THREE.Vector3(3, 2.6, 0)], 0.06), steel))
  const airTip = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.06, 0.06, 20), dark)
  airTip.position.y = 0.01
  air.add(airTip)

  // ── Микробраш для бонда: пластиковая палочка с ворсистым шариком ──
  const brush = new THREE.Group()
  brush.add(new THREE.Mesh(tube([new THREE.Vector3(0, 0.05, 0), new THREE.Vector3(0, 0.4, 0), new THREE.Vector3(0.15, 0.9, 0), new THREE.Vector3(0.7, 2.6, 0)], 0.035), new THREE.MeshPhysicalMaterial({ color: '#7cc644', roughness: 0.45 })))
  const fluff = new THREE.Mesh(grit(new THREE.SphereGeometry(0.075, 40, 28), 0.03, 7), new THREE.MeshPhysicalMaterial({ color: '#f4efe4', roughness: 0.9, sheen: 1, sheenColor: new THREE.Color('#ffffff') }))
  fluff.position.y = 0.05
  brush.add(fluff)

  // ── Полимеризационная лампа: световод с синим диском на конце, оранжевый защитный щиток ──
  const lamp = new THREE.Group()
  const guide = new THREE.Mesh(lathe([[0, 0], [0.3, 0], [0.32, 0.04], [0.32, 3.5], [0, 3.5]], 48), dark)
  const tipMat = new THREE.MeshBasicMaterial({ color: '#9fc4ff', transparent: true, opacity: 1 })
  const tip = new THREE.Mesh(new THREE.CircleGeometry(0.29, 48), tipMat)
  tip.rotation.x = Math.PI / 2
  tip.position.y = -0.002
  const shield = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 0.03, 48), new THREE.MeshPhysicalMaterial({ color: '#ff8a1e', roughness: 0.15, transparent: true, opacity: 0.55, clearcoat: 1 }))
  shield.position.y = 1.4
  const light = new THREE.SpotLight('#1f3cff', 0, 6, 0.65, 0.6, 1.2)
  light.position.set(0, -0.05, 0)
  light.target.position.set(0, -2, 0)
  const haloMat = new THREE.SpriteMaterial({ map: haloTexture(), color: '#6c9dff', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })
  const halo = new THREE.Sprite(haloMat)
  halo.scale.set(2.2, 2.2, 1)
  halo.position.y = -0.1
  lamp.add(guide, tip, shield, light, light.target, halo)

  // ── Штопфер (гладилка) для композита ──
  const plug = new THREE.Group()
  plug.add(new THREE.Mesh(new THREE.SphereGeometry(0.06, 24, 16), steel))
  plug.add(new THREE.Mesh(tube([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.35, 0), new THREE.Vector3(0.12, 0.8, 0), new THREE.Vector3(0.5, 1.4, 0)], 0.04), steel))
  const handle = new THREE.Mesh(lathe([[0.04, 0], [0.13, 0.25], [0.15, 3], [0, 3]], 32), satin)
  handle.position.set(0.5, 1.4, 0)
  handle.rotation.z = -0.56
  plug.add(handle)

  // ── Угловой наконечник с резиновой полировочной чашкой ──
  const cup = new THREE.Group()
  const cupSpin = new THREE.Group()
  const rubber = new THREE.MeshPhysicalMaterial({ color: '#aeb6c4', roughness: 0.8, sheen: 0.4, sheenColor: new THREE.Color('#ffffff'), side: THREE.DoubleSide })
  const cupGeo = lathe([[0.1, 0.0], [0.16, 0.0], [0.15, 0.08], [0.11, 0.24], [0.05, 0.3], [0, 0.3]], 36)
  cupSpin.add(new THREE.Mesh(grit(cupGeo, 0.006, 11), rubber))
  const cHead = new THREE.Mesh(lathe([[0, 0.3], [0.15, 0.31], [0.18, 0.35], [0.185, 0.6], [0.13, 0.65], [0, 0.66]], 40), satin)
  const cBody = new THREE.Mesh(tube([new THREE.Vector3(0, 0.48, 0), new THREE.Vector3(0.5, 0.52, 0), new THREE.Vector3(1.6, 1.1, 0), new THREE.Vector3(5, 2.7, 0)], 0.13), satin)
  cup.add(cupSpin, cHead, cBody)

  const all: Record<ToolName, Tool> = {
    bur: { group: bur, spin: burSpin },
    syringe: { group: etch },
    air: { group: air },
    brush: { group: brush },
    lamp: { group: lamp, glow: { light, tip: tipMat, halo: haloMat } },
    plug: { group: plug },
    cup: { group: cup, spin: cupSpin },
  }
  for (const t of Object.values(all)) {
    t.group.traverse((o) => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true } })
    t.group.visible = false
  }
  // Свечение не отбрасывает тень
  tip.castShadow = false
  return all
}

/** Мягкое круглое пятно (ореол лампы, капли, брызги). */
export function haloTexture(): THREE.Texture {
  const size = 128
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(0.25, 'rgba(255,255,255,0.55)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, size, size)
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}
