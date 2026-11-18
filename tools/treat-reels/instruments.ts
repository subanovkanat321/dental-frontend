import * as THREE from 'three'

/**
 * Инструменты стоматолога — простые тела three.js (цилиндры, «токарные» профили), но в реальных размерах
 * (единица ≈ 9 мм) и с реальными материалами: сталь отражает окружение, пластик матовый. Начало координат
 * группы — рабочий кончик, ручка уходит вдоль локальной оси +y: сцена ставит кончик к зубу и
 * поворачивает ось ручки куда нужно.
 */
export type ToolName = 'bur' | 'syringe' | 'air' | 'brush' | 'lamp' | 'plug' | 'cup' | 'file' | 'irrig' | 'scanner' | 'idrill' | 'driver' | 'scaler' | 'airflow'
  | 'ball' | 'cannula' | 'mbrush' | 'spatula'

export interface Tool {
  group: THREE.Group
  /** Вращающаяся часть (бор, резиновая чашка) — крутится вокруг своей оси y. */
  spin?: THREE.Object3D
  /** Свечение лампы: синий свет и диск на кончике. */
  glow?: { light: THREE.SpotLight; tip: THREE.MeshBasicMaterial; halo: THREE.SpriteMaterial }
  /** Откуда летят брызги (по оси от кончика). */
  nozzle?: number
  /** Свечение (окно сканера) — непрозрачность по дорожке <имя>Glow. */
  glowMat?: THREE.MeshBasicMaterial
  /** Части, которыми управляет процедура (капля бонда на кисточке, комок композита на гладилке). */
  parts?: Record<string, THREE.Object3D>
}

/** Закрутить сетку вокруг оси y: угол растёт с высотой (витой эндо-файл, сверло). */
function twist(geo: THREE.BufferGeometry, turnsPerUnit: number): THREE.BufferGeometry {
  const p = geo.getAttribute('position') as THREE.BufferAttribute
  for (let i = 0; i < p.count; i++) {
    const a = p.getY(i) * turnsPerUnit * Math.PI * 2
    const x = p.getX(i), z = p.getZ(i)
    p.setXYZ(i, x * Math.cos(a) - z * Math.sin(a), p.getY(i), x * Math.sin(a) + z * Math.cos(a))
  }
  geo.computeVertexNormals()
  return geo
}

/** Канавки сверла: радиус проседает по винтовой линии. */
function flutes(geo: THREE.BufferGeometry, pitch: number, depth: number): THREE.BufferGeometry {
  const p = geo.getAttribute('position') as THREE.BufferAttribute
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i)
    const a = Math.atan2(z, x)
    const k = 1 - depth * (0.5 + 0.5 * Math.sin(a * 2 + y * pitch)) ** 4
    p.setXYZ(i, x * k, y, z * k)
  }
  geo.computeVertexNormals()
  return geo
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

  // ── Эндо-файл (К-файл): витой стальной стержень квадратного сечения, резиновый стопор, цветная ручка ──
  const file = new THREE.Group()
  const fileSpin = new THREE.Group()
  const shaft = twist(new THREE.CylinderGeometry(0.018, 0.006, 2.4, 4, 120), 2.2)
  shaft.translate(0, 1.2, 0)
  fileSpin.add(new THREE.Mesh(shaft, steel))
  const stopper = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.03, 24), new THREE.MeshPhysicalMaterial({ color: '#ff8a2a', roughness: 0.6 }))
  stopper.position.y = 2.2
  const fHandle = new THREE.Mesh(lathe([[0.03, 2.38], [0.1, 2.45], [0.11, 3.0], [0.08, 3.08], [0, 3.1]], 6), new THREE.MeshPhysicalMaterial({ color: '#d63b3b', roughness: 0.45, clearcoat: 0.4 }))
  fileSpin.add(stopper, fHandle)
  file.add(fileSpin)

  // ── Шприц для промывки каналов: тонкая игла и прозрачный цилиндр с раствором ──
  const irrig = new THREE.Group()
  irrig.add(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.6, 16).translate(0, 0.8, 0), steel))
  const iBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 2.4, 32).translate(0, 2.9, 0), new THREE.MeshPhysicalMaterial({ color: '#e8f2ff', roughness: 0.08, transparent: true, opacity: 0.45, clearcoat: 1 }))
  const iHub = new THREE.Mesh(lathe([[0.03, 1.55], [0.09, 1.62], [0.1, 1.72], [0, 1.73]], 20), new THREE.MeshPhysicalMaterial({ color: '#3fa0e0', roughness: 0.4 }))
  irrig.add(iBarrel, iHub)

  // ── Внутриротовой сканер: белый корпус, окно снизу светит синими полосами ──
  const scanner = new THREE.Group()
  const sBody = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 3.2, 8, 24), new THREE.MeshPhysicalMaterial({ color: '#eef0f2', roughness: 0.35, clearcoat: 0.6 }))
  sBody.position.set(0, 1.6, -0.28)
  const sWindowMat = new THREE.MeshBasicMaterial({ color: '#5aa8ff', transparent: true, opacity: 0 })
  const sWindow = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.6), sWindowMat)
  sWindow.position.set(0, 0.25, 0.0)
  const sGlass = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.62), new THREE.MeshPhysicalMaterial({ color: '#1b2230', roughness: 0.05, clearcoat: 1 }))
  sGlass.position.set(0, 0.25, -0.005)
  scanner.add(sBody, sGlass, sWindow)

  // ── Сверло имплантолога: витое, в угловом наконечнике (как у полировки), с орошением ──
  const idrill = new THREE.Group()
  const idSpin = new THREE.Group()
  const bit = flutes(new THREE.CylinderGeometry(0.1, 0.1, 1.3, 32, 80), 18, 0.35)
  bit.translate(0, 0.75, 0)
  const bitTip = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.1, 32).rotateX(Math.PI), steel)
  bitTip.position.y = 0.05
  idSpin.add(new THREE.Mesh(bit, steel), bitTip)
  const depthMarks = new THREE.Mesh(new THREE.CylinderGeometry(0.102, 0.102, 0.03, 32), dark)
  depthMarks.position.y = 1.0
  idSpin.add(depthMarks)
  const idShank = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.5, 20).translate(0, 1.6, 0), steel)
  const idHead = new THREE.Mesh(lathe([[0, 1.8], [0.2, 1.81], [0.24, 1.85], [0.25, 2.2], [0.18, 2.26], [0, 2.27]], 40), satin)
  const idBody = new THREE.Mesh(tube([new THREE.Vector3(0, 2.0, 0), new THREE.Vector3(0.5, 2.05, 0), new THREE.Vector3(1.6, 2.6, 0), new THREE.Vector3(5, 4.2, 0)], 0.16), satin)
  idrill.add(idSpin, idShank, idHead, idBody)

  // ── Отвёртка-ключ для импланта: шестигранник в угловом наконечнике ──
  const driver = new THREE.Group()
  const drSpin = new THREE.Group()
  drSpin.add(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.9, 6).translate(0, 0.45, 0), steel))
  const drHead = new THREE.Mesh(lathe([[0, 0.9], [0.2, 0.91], [0.24, 0.95], [0.25, 1.3], [0.18, 1.36], [0, 1.37]], 40), satin)
  const drBody = new THREE.Mesh(tube([new THREE.Vector3(0, 1.1, 0), new THREE.Vector3(0.5, 1.15, 0), new THREE.Vector3(1.6, 1.7, 0), new THREE.Vector3(5, 3.3, 0)], 0.16), satin)
  driver.add(drSpin, drHead, drBody)

  // ── Ультразвуковой скейлер: тонкий изогнутый стальной кончик, вода у самого кончика ──
  const scaler = new THREE.Group()
  scaler.add(new THREE.Mesh(tube([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.03, 0.2, 0), new THREE.Vector3(0.14, 0.5, 0), new THREE.Vector3(0.12, 0.85, 0), new THREE.Vector3(0.05, 1.05, 0)], 0.022), steel))
  const scHand = new THREE.Mesh(lathe([[0.06, 1.0], [0.16, 1.15], [0.19, 1.4], [0.2, 4.2], [0, 4.2]], 32), new THREE.MeshPhysicalMaterial({ color: '#e9ecef', roughness: 0.35, clearcoat: 0.5 }))
  scHand.position.x = 0.05
  const scRing = new THREE.Mesh(new THREE.CylinderGeometry(0.195, 0.195, 0.06, 32), ring)
  scRing.position.set(0.05, 1.5, 0)
  scaler.add(scHand, scRing)

  // ── Air Flow: наконечник с соплом — порошок с водой под давлением ──
  const airflow = new THREE.Group()
  airflow.add(new THREE.Mesh(tube([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.25, 0), new THREE.Vector3(0.1, 0.55, 0), new THREE.Vector3(0.12, 0.8, 0)], 0.05), steel))
  const afHand = new THREE.Mesh(lathe([[0.07, 0.75], [0.17, 0.95], [0.2, 1.2], [0.21, 4], [0, 4]], 32), new THREE.MeshPhysicalMaterial({ color: '#f2f3f5', roughness: 0.3, clearcoat: 0.6 }))
  afHand.position.x = 0.12
  const afRing = new THREE.Mesh(new THREE.CylinderGeometry(0.205, 0.205, 0.07, 32), new THREE.MeshPhysicalMaterial({ color: '#12a99b', roughness: 0.4, clearcoat: 0.6 }))
  afRing.position.set(0.12, 1.35, 0)
  airflow.add(afHand, afRing)

  // ── Инструменты ролика «Спасаем зуб» (зуб в разрезе, макро): хром с отражениями, как на студийной съёмке ──
  // Шлифованный хром: анизотропия — блики вытянуты поперёк оси, как у настоящего наконечника
  const chrome = new THREE.MeshPhysicalMaterial({ color: '#eef1f4', metalness: 1, roughness: 0.12, envMapIntensity: 1.6 })
  const brushed = new THREE.MeshPhysicalMaterial({ color: '#cfd4da', metalness: 1, roughness: 0.34, envMapIntensity: 1.5 })
  const carbide = new THREE.MeshPhysicalMaterial({ color: '#b9bec4', metalness: 1, roughness: 0.22, envMapIntensity: 1.6 })

  // Турбинный наконечник с шаровидным бором: головка-«стакан» из шлифованного хрома, кольцо форсунок спрея
  const ball = new THREE.Group()
  const ballSpin = new THREE.Group()
  // Шаровидный бор с режущими лезвиями: на вращении — размытый блестящий шарик
  const ballHead = flutes(new THREE.SphereGeometry(0.062, 40, 28), 0, 0.12)
  ballHead.translate(0, 0.062, 0)
  ballSpin.add(new THREE.Mesh(ballHead, carbide))
  ballSpin.add(new THREE.Mesh(lathe([[0.02, 0.1], [0.026, 0.2], [0.034, 0.32], [0.08, 0.4], [0.08, 1.3], [0, 1.3]], 32), chrome))
  const bHead = new THREE.Mesh(lathe([[0, 1.24], [0.16, 1.24], [0.2, 1.27], [0.42, 1.3], [0.5, 1.36], [0.53, 1.5], [0.53, 2.05], [0.5, 2.12], [0, 2.14]], 64), brushed)
  const bNose = new THREE.Mesh(lathe([[0.085, 1.16], [0.14, 1.18], [0.17, 1.25], [0, 1.25]], 40), chrome)
  // Форсунки спрея — три тёмные точки на торце головки
  const jets = new THREE.Group()
  for (let i = 0; i < 3; i++) {
    const j = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.02, 12), dark)
    const a = (i / 3) * Math.PI * 2 + 0.5
    j.position.set(Math.cos(a) * 0.3, 1.29, Math.sin(a) * 0.3)
    jets.add(j)
  }
  const bNeck = new THREE.Mesh(tube([new THREE.Vector3(0, 1.75, 0), new THREE.Vector3(0.7, 1.8, 0), new THREE.Vector3(1.6, 2.1, 0), new THREE.Vector3(5, 3.4, 0)], 0.3), brushed)
  ball.add(ballSpin, bHead, bNose, jets, bNeck)

  // Шприц протравки: тонкая металлическая канюля отвесно, над ней прозрачный шприц с синим гелем
  const cannula = new THREE.Group()
  cannula.add(new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 1.5, 20, 1, true).translate(0, 0.75, 0), chrome))
  const cTip = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.007, 8, 20), dark)
  cTip.rotation.x = Math.PI / 2
  cannula.add(cTip)
  const cHub = new THREE.Mesh(lathe([[0.03, 1.45], [0.09, 1.55], [0.1, 1.8], [0.16, 1.85], [0, 1.86]], 32), new THREE.MeshPhysicalMaterial({ color: '#e9eef5', roughness: 0.15, transparent: true, opacity: 0.7, clearcoat: 1 }))
  const cBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 2.6, 40, 1, true).translate(0, 3.15, 0), new THREE.MeshPhysicalMaterial({ color: '#f2f6fb', roughness: 0.05, transparent: true, opacity: 0.35, clearcoat: 1, side: THREE.DoubleSide, depthWrite: false }))
  const cGel = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 2.3, 32).translate(0, 3.05, 0), new THREE.MeshPhysicalMaterial({ color: '#1d74f2', roughness: 0.2, clearcoat: 0.8, emissive: new THREE.Color('#0a2f80'), emissiveIntensity: 0.3 }))
  cannula.add(cHub, cGel, cBarrel)

  // Микробраш для бонда: белая палочка, ворс пропитан бондом, на кончике — золотистая капля
  const mbrush = new THREE.Group()
  mbrush.add(new THREE.Mesh(tube([new THREE.Vector3(0, 0.08, 0), new THREE.Vector3(0, 0.5, 0), new THREE.Vector3(0.02, 1.2, 0), new THREE.Vector3(0.05, 3.2, 0)], 0.04), new THREE.MeshPhysicalMaterial({ color: '#f4f4f2', roughness: 0.35, clearcoat: 0.6 })))
  const mFluff = new THREE.Mesh(grit(new THREE.CapsuleGeometry(0.05, 0.1, 10, 28), 0.018, 5), new THREE.MeshPhysicalMaterial({ color: '#f1dcaa', roughness: 0.6, sheen: 1, sheenColor: new THREE.Color('#fff1c9'), clearcoat: 0.6, clearcoatRoughness: 0.2 }))
  mFluff.position.y = 0.1
  const mDrop = new THREE.Mesh(new THREE.SphereGeometry(0.09, 40, 28), new THREE.MeshPhysicalMaterial({ color: '#e7a336', roughness: 0.02, clearcoat: 1, clearcoatRoughness: 0.02, transmission: 0, transparent: true, opacity: 0.88, specularIntensity: 1, emissive: new THREE.Color('#5a2a00'), emissiveIntensity: 0.4 }))
  mDrop.scale.set(1, 1.2, 1)
  mDrop.position.y = -0.02
  mbrush.add(mFluff, mDrop)

  // Гладилка для композита: синяя анодированная ручка, стальная шейка, плоская лопатка; на ней комок пасты
  const spatula = new THREE.Group()
  const blade = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 20), brushed)
  blade.scale.set(0.062, 0.13, 0.014)
  blade.position.y = 0.1
  const shankS = new THREE.Mesh(tube([new THREE.Vector3(0, 0.28, 0), new THREE.Vector3(0, 0.6, 0), new THREE.Vector3(0.06, 1.0, 0), new THREE.Vector3(0.12, 1.5, 0)], 0.035), brushed)
  const sHandle = new THREE.Mesh(lathe([[0.04, 0], [0.11, 0.2], [0.13, 0.5], [0.15, 3.2], [0, 3.2]], 40), new THREE.MeshPhysicalMaterial({ color: '#2f6fe0', metalness: 0.85, roughness: 0.3, clearcoat: 0.6, envMapIntensity: 1.3 }))
  sHandle.position.set(0.12, 1.45, 0)
  const sBlob = new THREE.Mesh(grit(new THREE.SphereGeometry(0.1, 48, 32), 0.01, 9), new THREE.MeshPhysicalMaterial({ color: '#efe3c8', roughness: 0.28, clearcoat: 0.7, clearcoatRoughness: 0.1, sheen: 0.3, sheenColor: new THREE.Color('#fff8ea') }))
  sBlob.scale.set(1, 0.85, 0.75)
  sBlob.position.set(0, 0.0, 0)
  spatula.add(blade, shankS, sHandle, sBlob)

  const all: Record<ToolName, Tool> = {
    bur: { group: bur, spin: burSpin },
    syringe: { group: etch },
    air: { group: air },
    brush: { group: brush },
    lamp: { group: lamp, glow: { light, tip: tipMat, halo: haloMat } },
    plug: { group: plug },
    cup: { group: cup, spin: cupSpin },
    file: { group: file, spin: fileSpin },
    irrig: { group: irrig },
    scanner: { group: scanner, glowMat: sWindowMat },
    idrill: { group: idrill, spin: idSpin, nozzle: 1.6 },
    driver: { group: driver, spin: drSpin },
    scaler: { group: scaler, nozzle: 0.02 },
    airflow: { group: airflow },
    ball: { group: ball, spin: ballSpin, nozzle: 1.28 },
    cannula: { group: cannula },
    mbrush: { group: mbrush, parts: { drop: mDrop, fluff: mFluff } },
    spatula: { group: spatula, parts: { blob: sBlob } },
  }
  for (const t of Object.values(all)) {
    t.group.traverse((o) => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true } })
    t.group.visible = false
  }
  // Свечение не отбрасывает тень
  tip.castShadow = false
  sWindow.castShadow = false
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
