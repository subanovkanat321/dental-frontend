import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

import type { AtlasMode, AtlasView, PartId, WisdomPosition } from '../content'
import { CUT_X, type ToothGroup } from '../geometry/toothModel'
import type { MeshData } from '../geometry/mesher'
import type { GeometryRequest, GeometryResponse } from '../geometry/worker'
import { createJawScene, createWisdomScene, type JawScene, type WisdomScene } from './jawScene'
import { createMaterials, type Materials } from './materials'
import { createToothScene, TIMELINE } from './toothScene'

/** Точка метки на экране (в CSS-пикселях холста) и видна ли она с этой стороны. */
export interface ScreenPoint {
  x: number
  y: number
  visible: boolean
}

export interface EngineCallbacks {
  /** Каждый кадр: где метки и какой шаг ролика. Обновлять DOM напрямую, без setState. */
  onFrame(points: ScreenPoint[], step: number): void
  onLoading(loading: boolean): void
  onPickTooth(fdi: number): void
  onPickPart(part: PartId): void
  onError(message: string): void
}

/** Управление 3D-сценой из React. */
export interface AtlasEngine {
  setView(view: AtlasView): void
  setMode(mode: AtlasMode): void
  setCariesStage(stage: number): void
  setPart(part: PartId | null): void
  setTooth(fdi: number | null): void
  setWisdom(pos: WisdomPosition): void
  setRoots(show: boolean): void
  /** Точки меток (координаты модели). */
  setAnchors(points: readonly (readonly [number, number, number])[]): void
  replay(): void
  resetView(): void
  /**
   * Камера точно в позу, без подгонки под панели — для кадров слайдов (tools/learn-art). В CRM не вызывается:
   * там камеру ставит вид и пациент пальцем.
   */
  setCameraPose(pos: readonly [number, number, number], target: readonly [number, number, number], fov?: number): void
  /**
   * Своя сцена вместо зуба и челюстей — те же свет, материалы, тени и камера (кадры презентаций,
   * tools/learn-art). null — обратно к виду атласа. В CRM не вызывается.
   */
  setCustom(make: ((m: Materials) => CustomScene) | null): void
  dispose(): void
}

/** Своя сцена для setCustom: корень, кадр анимации (t — секунды с replay) и высота «пола» под тенью. */
export interface CustomScene {
  root: THREE.Object3D
  update(t: number): void
  floorY?: number
  dispose(): void
}

/**
 * Камера по видам: откуда смотрим, куда и насколько можно отодвинуть (max). `radius` — полуширина
 * модели с метками (в единицах сцены): по ней камера отъезжает, если модель не влезает по ширине
 * между легендой и описанием.
 */
/**
 * halfWidth — половина ширины сцены (с подписями слева): узкий экран (телефон стоя) — камера отходит,
 * чтобы влезло по ширине; иначе «Мудрости» (длинный блок кости) обрезалась слева.
 */
const CAMERAS: Record<AtlasView, { pos: [number, number, number]; target: [number, number, number]; max: number; radius: number; halfWidth?: number }> = {
  tooth: { pos: [2.75, 1.1, 5.0], target: [0.1, -0.68, 0], max: 11, radius: 1.45 },
  jaw: { pos: [0, 3.2, 12.4], target: [0, -0.1, -2.4], max: 18, radius: 3.7 },
  // Камера — прямо напротив центра кости (x = 0,5): раньше стояла правее, и сцена уезжала влево
  wisdom: { pos: [0.5, 0.6, 9.4], target: [0.5, -1.0, 0], max: 14, radius: 2.35, halfWidth: 3.2 },
}
/**
 * Ближе стартового вида — только на 15%: прокрутка тачпадом на ноутбуке — это зум, и модель раньше
 * разрасталась так, что вылезала за кадр (minDistance был ~0,4 от стартового). Стартовый вид и так
 * занимает почти всю высоту: при 0,75 коронка и низ кости уже обрезались (проверено скриншотами).
 */
const MIN_ZOOM = 0.85
/** Насколько стартовая камера дальше точки, куда смотрит. */
const startDistance = (c: (typeof CAMERAS)[AtlasView]) => Math.hypot(c.pos[0] - c.target[0], c.pos[1] - c.target[1], c.pos[2] - c.target[2])

/** Меш сцены «зуб» → часть атласа (нажали на ткань — открыли её описание). */
const MESH_PART: Record<string, PartId> = {
  enamel: 'enamel', enamelAccess: 'enamel', enamelPrep: 'enamel', dentin: 'dentin', dentinAccess: 'dentin', dentinPrep: 'dentin',
  dentinStump: 'stump', pulp: 'pulp', cementum: 'cementum', pdl: 'pdl', cortical: 'bone', spongy: 'bone', implantCortical: 'bone',
  implantSpongy: 'bone', gum: 'gum', implantGum: 'gum', caries0: 'caries', caries1: 'caries', caries2: 'caries', caries3: 'caries',
  gutta: 'gutta', filling: 'filling', crownCap: 'crown', implantCrown: 'crown',
}

export function createAtlasEngine(canvas: HTMLCanvasElement, cb: EngineCallbacks): AtlasEngine {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' })
  // Больше 2 — лишняя работа видеокарте без видимой разницы (4K-телевизор и так чёткий).
  // Слабое устройство (мало ядер или памяти) — сразу 1,5: на телефоне разница почти не видна
  let pixelRatio = Math.min(window.devicePixelRatio || 1, weakDevice() ? 1.5 : 2)
  renderer.setPixelRatio(pixelRatio)
  renderer.shadowMap.enabled = true
  // VSM — мягкие края теней (у PCF на десне были «ступеньки»)
  renderer.shadowMap.type = THREE.VSMShadowMap
  // Тени пересчитываем, только когда что-то движется (ролик, смена режима): в покое — экономия видеокарты
  renderer.shadowMap.autoUpdate = false
  // Нейтральная тональная кривая (Khronos PBR Neutral): цвета тканей как заданы, без «киношного»
  // пересвета ACES — у него белая эмаль выгорала в пластик, а розовая десна уходила в оранжевый
  renderer.toneMapping = THREE.NeutralToneMapping
  renderer.toneMappingExposure = 1.0
  renderer.localClippingEnabled = true

  const scene = new THREE.Scene()
  const pmrem = new THREE.PMREMGenerator(renderer)
  const room = new RoomEnvironment()
  const env = pmrem.fromScene(room, 0.04).texture
  scene.environment = env
  scene.environmentIntensity = 0.6

  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 100)
  const controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  // Двигать модель: два пальца на телефоне (вместе со щипком), правая кнопка или Shift+мышь на компьютере.
  // Далеко не уводим — см. clampPan; «Вернуть вид» ставит на место
  controls.enablePan = true
  controls.screenSpacePanning = true
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }
  controls.autoRotate = false
  controls.rotateSpeed = 0.7
  // Колесо и тачпад приближают плавнее (по умолчанию 1 — один жест тачпада и модель во весь экран)
  controls.zoomSpeed = 0.4

  // Свет как на фото в клинике: мягкий ключевой сверху-спереди с тенями, заполняющий с другой стороны
  // (тени не чёрные), холодный контровой сзади — отделяет край зуба от тёмного фона
  const key = new THREE.DirectionalLight('#fff6ec', 2.1)
  key.position.set(3.5, 6, 5)
  key.castShadow = true
  key.shadow.mapSize.set(2048, 2048)
  key.shadow.camera.left = key.shadow.camera.bottom = -4
  key.shadow.camera.right = key.shadow.camera.top = 4
  key.shadow.camera.near = 1
  key.shadow.camera.far = 25
  key.shadow.bias = -0.0004
  key.shadow.normalBias = 0.02
  key.shadow.radius = 6
  key.shadow.blurSamples = 8
  const fill = new THREE.DirectionalLight('#fff1e6', 0.55)
  fill.position.set(-4.5, 1.5, 4)
  const rim = new THREE.DirectionalLight('#a9ccff', 1.3)
  rim.position.set(-5, 3, -4)
  const hemi = new THREE.HemisphereLight('#e4edff', '#3a3330', 0.4)
  scene.add(key, fill, rim, hemi)
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.ShadowMaterial({ opacity: 0.28 }))
  floor.rotation.x = -Math.PI / 2
  floor.receiveShadow = true
  scene.add(floor)

  const materials = createMaterials()

  // Сетки — в Web Worker; ответы ждём по имени группы
  const worker = new Worker(new URL('../geometry/worker.ts', import.meta.url), { type: 'module' })
  const waiting = new Map<string, ((r: GeometryResponse) => void)[]>()
  worker.onmessage = (e: MessageEvent<GeometryResponse>) => {
    const list = waiting.get(e.data.group) ?? []
    waiting.delete(e.data.group)
    for (const resolve of list) resolve(e.data)
  }
  worker.onerror = (e) => cb.onError(e.message || 'Не удалось построить модель')
  let disposed = false
  const load = (group: ToothGroup | 'jaw') =>
    new Promise<Map<string, THREE.BufferGeometry>>((resolve, reject) => {
      const list = waiting.get(group) ?? []
      if (!list.length) worker.postMessage({ group } satisfies GeometryRequest)
      list.push((r) => {
        if ('error' in r) return reject(new Error(r.error))
        resolve(new Map(r.meshes.map(([name, mesh]) => [name, toGeometry(mesh)])))
      })
      waiting.set(group, list)
    })

  const tooth = createToothScene(materials, load)
  scene.add(tooth.root)
  let jaw: JawScene | null = null
  let wisdom: WisdomScene | null = null
  let jawShapes: Promise<Map<string, THREE.BufferGeometry>> | null = null
  const jawGeometry: THREE.BufferGeometry[] = []
  const shapes = () => (jawShapes ??= load('jaw').then((g) => { jawGeometry.push(...g.values()); return g }))

  let view: AtlasView = 'tooth'
  let mode: AtlasMode = 'healthy'
  let tooth_fdi: number | null = null
  let wisdomPos: WisdomPosition = 'vertical'
  let roots = false
  let anchors: readonly (readonly [number, number, number])[] = []
  let custom: CustomScene | null = null
  let customStart = 0
  const t0 = performance.now()
  const now = () => (performance.now() - t0) / 1000
  /** До какого времени сцена «в движении» — пересчитывать тени каждый кадр. */
  let busyUntil = 0
  const busy = (seconds: number) => { busyUntil = Math.max(busyUntil, now() + seconds) }

  const run = (p: Promise<unknown>) => p.catch((e: unknown) => { if (!disposed) cb.onError(e instanceof Error ? e.message : String(e)) })

  /**
   * Сколько ширины холста по краям закрывают легенда (слева) и описание (справа) — они поверх
   * холста. Модель по центру, поэтому важен больший из краёв. На телефоне легенды нет, а описание
   * внизу — 0: там модель и так подобрана (fov 42), отодвигать не надо.
   */
  function sideCover(): number {
    const stage = canvas.parentElement
    if (!stage) return 0
    const s = stage.getBoundingClientRect()
    let cover = 0
    for (const el of stage.querySelectorAll<HTMLElement>('.atlas-legend, .atlas-info')) {
      const r = el.getBoundingClientRect()
      if (!r.width || r.top > s.top + s.height / 2) continue
      cover = Math.max(cover, r.left - s.left < s.width / 2 ? r.right - s.left : s.right - r.left)
    }
    return cover
  }

  /**
   * Сколько пикселей снизу кадра закрывает панель описания (на телефоне она лежит поверх холста внизу).
   * Центр картинки сдвигаем вверх на половину — модель стоит посередине видимой части, а не под панелью.
   */
  function bottomCover(): number {
    const stage = canvas.parentElement
    if (!stage) return 0
    const s = stage.getBoundingClientRect()
    let cover = 0
    for (const el of stage.querySelectorAll<HTMLElement>('.atlas-info, .atlas-legend')) {
      const r = el.getBoundingClientRect()
      if (!r.width || r.top < s.top + s.height / 2) continue
      cover = Math.max(cover, s.bottom - r.top)
    }
    return Math.min(cover, s.height * 0.5)
  }

  let shift = 0
  function applyShift(w: number, h: number) {
    shift = Math.round(bottomCover() / 2)
    if (shift > 0) camera.setViewOffset(w, h, 0, shift, w, h)
    else camera.clearViewOffset()
  }

  /** Сдвиг (pan) — не дальше радиуса модели от её центра: модель не «улетает» за край. */
  function clampPan() {
    const c = CAMERAS[view]
    const home = new THREE.Vector3(...c.target)
    const away = controls.target.clone().sub(home)
    const limit = c.radius * 1.1
    if (away.length() <= limit) return
    const back = away.clone().setLength(away.length() - limit)
    controls.target.sub(back)
    camera.position.sub(back)
  }
  controls.addEventListener('change', clampPan)

  /**
   * На каком расстоянии камера видит модель целиком: не ближе стартового, а если кадр узкий (окно
   * уже, по бокам панели) — дальше, чтобы полуширина модели влезла между легендой и описанием.
   */
  function fitDistance(v: AtlasView): number {
    const c = CAMERAS[v]
    const d0 = startDistance(c)
    if (!width || !height) return d0
    let d = d0
    // По ширине: между легендой и описанием по бокам
    const cover = sideCover()
    if (cover) {
      const free = Math.max(width - 2 * cover - 24, width * 0.3) / width
      d = Math.max(d, c.radius / (Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect * free))
    }
    // По ширине всей сцены (узкий экран)
    if (c.halfWidth) d = Math.max(d, c.halfWidth / (Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect))
    // По высоте: над описанием снизу (телефон) — иначе высокий зуб уходил верхом за край кадра
    const bottom = bottomCover()
    if (bottom) {
      const free = Math.max(height - bottom - 16, height * 0.4) / height
      d = Math.max(d, c.radius / (Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * free))
    }
    return d
  }

  /** Расстояние «вид целиком» для текущего вида; от него — пределы зума. */
  let fitted = 0
  function applyFit(v: AtlasView, keepZoom: boolean) {
    const c = CAMERAS[v]
    const next = fitDistance(v)
    if (keepZoom && fitted) {
      // Окно поменяло размер: отодвинуть/приблизить камеру в той же пропорции — зум пользователя сохраняется
      const offset = camera.position.clone().sub(controls.target)
      camera.position.copy(controls.target).add(offset.multiplyScalar(next / fitted))
    } else {
      const dir = new THREE.Vector3(...c.pos).sub(new THREE.Vector3(...c.target)).normalize()
      camera.position.copy(controls.target).addScaledVector(dir, next)
    }
    fitted = next
    controls.minDistance = next * MIN_ZOOM
    controls.maxDistance = Math.max(c.max, next * 1.6)
  }

  function placeCamera(v: AtlasView) {
    const c = CAMERAS[v]
    controls.target.set(...c.target)
    applyFit(v, false)
    floor.position.y = v === 'tooth' ? -2.37 : -3.0
    // У челюсти «пола» нет: тень под ней выглядела пятном
    floor.visible = v === 'tooth'
    controls.update()
  }

  async function showView(v: AtlasView) {
    view = v
    settle(2.5)
    tooth.root.visible = v === 'tooth'
    if (jaw) jaw.root.visible = v === 'jaw'
    if (wisdom) wisdom.root.visible = v === 'wisdom'
    placeCamera(v)
    if (v === 'tooth') {
      cb.onLoading(!tooth.ready)
      await tooth.setMode(mode, now())
      busy((TIMELINE[mode]?.total ?? 0) + 0.5)
      cb.onLoading(false)
      // Остальные режимы — в фоне, чтобы переключение было мгновенным
      void run(tooth.prefetch())
      return
    }
    if ((v === 'jaw' && !jaw) || (v === 'wisdom' && !wisdom)) {
      cb.onLoading(true)
      const g = await shapes()
      if (disposed) return
      if (v === 'jaw' && !jaw) {
        jaw = createJawScene(materials, g)
        jaw.select(tooth_fdi)
        jaw.setRoots(roots)
        scene.add(jaw.root)
      }
      if (v === 'wisdom' && !wisdom) {
        wisdom = createWisdomScene(materials, g)
        wisdom.setPosition(wisdomPos, -10)
        scene.add(wisdom.root)
      }
      cb.onLoading(false)
    }
    busy(1.2)
    if (jaw) jaw.root.visible = view === 'jaw'
    if (wisdom) wisdom.root.visible = view === 'wisdom'
  }

  // Размер холста — по родителю; ResizeObserver ловит и поворот планшета, и полноэкранный режим
  let width = 0
  let height = 0
  const resize = () => {
    const parent = canvas.parentElement
    const w = parent?.clientWidth || canvas.clientWidth || 1
    const h = parent?.clientHeight || canvas.clientHeight || 1
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    // На узком экране (телефон стоя) — отодвинуть камеру, чтобы модель влезла
    camera.fov = w / h < 0.9 ? 42 : 30
    applyShift(w, h)
    camera.updateProjectionMatrix()
    width = w
    height = h
    // Кадр стал уже (или шире) — модель с панелями по бокам должна влезать: камеру отодвигаем
    if (fitted) {
      applyFit(view, true)
      controls.update()
    }
  }
  const observer = new ResizeObserver(resize)
  // Описание появилось, пропало или поменяло высоту (другой режим, стадия) — пересчитать сдвиг модели вверх
  const watchPanels = () => {
    for (const el of canvas.parentElement?.querySelectorAll<HTMLElement>('.atlas-info, .atlas-legend') ?? []) observer.observe(el)
  }
  const panels = new MutationObserver(() => { watchPanels(); resize() })
  if (canvas.parentElement) {
    observer.observe(canvas.parentElement)
    watchPanels()
    panels.observe(canvas.parentElement, { childList: true })
  }
  resize()

  // Нажатие (не поворот): на челюсти — выбрать зуб, на разрезе — ткань
  const raycaster = new THREE.Raycaster()
  let down: { x: number; y: number } | null = null
  const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY } }
  const onUp = (e: PointerEvent) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return
    down = null
    const r = canvas.getBoundingClientRect()
    raycaster.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera)
    if (view === 'jaw' && jaw) {
      const hit = raycaster.intersectObjects(jaw.teeth, false)[0]
      if (hit) cb.onPickTooth(hit.object.userData.fdi as number)
    } else if (view === 'tooth') {
      const hit = raycaster.intersectObjects(tooth.root.children.filter((o) => o.visible), true)[0]
      const part = hit && MESH_PART[hit.object.name]
      if (part) cb.onPickPart(part)
    }
  }
  canvas.addEventListener('pointerdown', onDown)
  canvas.addEventListener('pointerup', onUp)

  /**
   * Качество под устройство: если кадр стабильно дольше SLOW_FRAME_MS (меньше ~25 кадров в секунду),
   * сначала снижаем плотность пикселей (до 1), потом выключаем тени. Обратно не повышаем — чтобы
   * картинка не «мигала» качеством. Первые секунды после смены вида не считаем: там компиляция шейдеров.
   */
  let lastTs = 0, sum = 0, count = 0, settleUntil = 0
  function settle(seconds: number) {
    settleUntil = Math.max(settleUntil, performance.now() + seconds * 1000)
    sum = count = 0
  }
  function adapt(ts: number) {
    const dt = ts - lastTs
    lastTs = ts
    if (document.hidden || dt > 500 || ts < settleUntil) { sum = count = 0; return }
    sum += dt
    if (++count < 90) return
    const avg = sum / count
    sum = count = 0
    if (avg < SLOW_FRAME_MS) return
    if (pixelRatio > 1) {
      pixelRatio = Math.max(1, pixelRatio - 0.5)
      renderer.setPixelRatio(pixelRatio)
      resize()
    } else if (renderer.shadowMap.enabled) {
      renderer.shadowMap.enabled = false
      scene.traverse((o) => {
        const mat = (o as THREE.Mesh).material
        for (const m of Array.isArray(mat) ? mat : mat ? [mat] : []) m.needsUpdate = true
      })
    }
    settle(1.5)
  }

  const v3 = new THREE.Vector3()
  const toCam = new THREE.Vector3()
  const frame = (ts: number) => {
    adapt(ts)
    const t = now()
    controls.update()
    let step = 0
    if (custom) {
      tooth.root.visible = false
      if (jaw) jaw.root.visible = false
      if (wisdom) wisdom.root.visible = false
      custom.update(t - customStart)
    } else if (view === 'tooth') step = tooth.update(t)
    else if (view === 'jaw') jaw?.update(t)
    else wisdom?.update(t)
    if (t < busyUntil) renderer.shadowMap.needsUpdate = true
    renderer.render(scene, camera)
    // Метки: проекция на экран. На разрезе метка лежит на плоскости среза — с обратной стороны не видна
    const w = canvas.clientWidth, h = canvas.clientHeight
    const points = anchors.map(([x, y, z]) => {
      v3.set(x, y, z).project(camera)
      let visible = v3.z < 1
      if (view === 'tooth' && !custom) {
        toCam.set(camera.position.x - x, camera.position.y - y, camera.position.z - z)
        visible &&= Math.abs(x - CUT_X) < 0.01 ? toCam.x > 0 : toCam.z > 0
      }
      return { x: (v3.x * 0.5 + 0.5) * w, y: (-v3.y * 0.5 + 0.5) * h, visible }
    })
    cb.onFrame(points, step)
  }

  placeCamera('tooth')
  void run(showView('tooth'))
  renderer.setAnimationLoop(frame)

  return {
    setView: (v) => void run(showView(v)),
    setMode(next) {
      mode = next
      if (view === 'tooth') {
        cb.onLoading(true)
        void run(tooth.setMode(next, now()).then(() => {
          busy((TIMELINE[next]?.total ?? 0) + 0.5)
          cb.onLoading(false)
        }))
      }
    },
    setCariesStage(s) {
      tooth.setStage(s)
      busy(0.3)
    },
    setPart: (p) => tooth.setPart(p),
    setTooth(fdi) {
      tooth_fdi = fdi
      jaw?.select(fdi)
    },
    setWisdom(pos) {
      wisdomPos = pos
      wisdom?.setPosition(pos, now())
      busy(1.2)
    },
    setRoots(show) {
      roots = show
      jaw?.setRoots(show)
    },
    setAnchors(points) { anchors = points },
    replay() {
      customStart = now()
      tooth.replay(now())
      busy((TIMELINE[mode]?.total ?? 0) + 0.5)
    },
    resetView: () => placeCamera(view),
    setCameraPose(pos, target, fov) {
      // Точно в позу: пределы зума атласа (от «вида целиком») здесь не действуют — иначе камера отъезжала
      controls.minDistance = 0
      controls.maxDistance = Infinity
      controls.target.set(...target)
      camera.position.set(...pos)
      if (fov) camera.fov = fov
      camera.updateProjectionMatrix()
      controls.update()
      busy(0.3)
    },
    setCustom(make) {
      if (custom) { scene.remove(custom.root); custom.dispose() }
      custom = make ? make(materials) : null
      if (custom) {
        scene.add(custom.root)
        floor.position.y = custom.floorY ?? -2.37
        floor.visible = custom.floorY !== undefined || view === 'tooth'
        customStart = now()
      } else void run(showView(view))
      busy(0.5)
    },
    dispose() {
      disposed = true
      custom?.dispose()
      renderer.setAnimationLoop(null)
      observer.disconnect()
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointerup', onUp)
      worker.terminate()
      controls.dispose()
      panels.disconnect()
      tooth.dispose()
      jaw?.dispose()
      wisdom?.dispose()
      for (const g of jawGeometry) g.dispose()
      materials.dispose()
      floor.geometry.dispose()
      ;(floor.material as THREE.Material).dispose()
      env.dispose()
      pmrem.dispose()
      room.dispose()
      renderer.dispose()
      // Освободить контекст WebGL сразу: у браузера их лимит (~16), атлас могут открывать много раз
      renderer.forceContextLoss()
    },
  }
}

/** Кадр дольше этого (мс) в среднем — снижаем качество. 40 мс ≈ 25 кадров в секунду. */
const SLOW_FRAME_MS = 40

/** Слабое устройство по косвенным признакам: мало ядер процессора или памяти (телефоны попроще, ТВ-приставки). */
function weakDevice(): boolean {
  const nav = navigator as Navigator & { deviceMemory?: number }
  return (nav.hardwareConcurrency || 8) <= 4 || (nav.deviceMemory ?? 8) <= 3
}

function toGeometry(m: MeshData): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3))
  g.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3))
  if (m.uvs) g.setAttribute('uv', new THREE.BufferAttribute(m.uvs, 2))
  if (m.colors) g.setAttribute('color', new THREE.BufferAttribute(m.colors, 3))
  if (m.ao) g.setAttribute('ao', new THREE.BufferAttribute(m.ao, 1))
  g.setIndex(new THREE.BufferAttribute(m.indices, 1))
  g.computeBoundingSphere()
  return g
}
