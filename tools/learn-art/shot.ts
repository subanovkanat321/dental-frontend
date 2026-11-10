/**
 * Страница кадров для презентаций «Для пациента»: один холст 3D-атласа без кнопок и подписей.
 * Её открывает scripts/learn-art.mjs (Playwright + vite dev) и управляет через window.shot:
 *
 *   shot.set({ view, mode, stage, wisdom, learn, pos, target, fov }) — сцена и камера (learn — сцена презентаций,
 *                                                              src/atlas/engine/learnScene.ts);
 *   shot.replay()                                              — ролик режима с начала;
 *   await shot.advance(ms)                                     — сдвинуть время сцены;
 *   await shot.capture()                                       — PNG холста (с прозрачным фоном) и где на нём метки частей.
 *
 * Время страницы ведёт скрипт: performance.now подменён, время идёт только по shot.advance(ms), а кадр
 * рисуется только в capture(). Кадр зависит лишь от t ролика, а не от скорости машины (WebGL без
 * видеокарты рисует кадр секундами), и движок не «снижает качество» из-за медленных кадров.
 * page.clock Playwright не подошёл: с ним зависает page.screenshot. Снимок — canvas.toDataURL сразу
 * после отрисовки, в той же задаче (буфер ещё цел).
 *
 * В сборку CRM страница не входит: её нет во входах vite.config.ts, открывается только через vite dev.
 */
import { MODE_LABELS, type AtlasMode, type AtlasView, type PartId, type WisdomPosition } from '../../src/atlas/content'
import { createAtlasEngine, type AtlasEngine, type ScreenPoint } from '../../src/atlas/engine/engine'
import { createLearnScene } from '../../src/atlas/engine/learnScene'
import { LEARN_ANCHORS, type LearnId } from '../../src/atlas/geometry/learnModel'

type Vec = [number, number, number]
/** Точка подписи: часть атласа или подпись сцены презентаций (tartar, clot, germ…). */
type Anchor = [PartId | string, Vec]

export interface ShotState {
  view?: AtlasView
  mode?: AtlasMode
  stage?: number
  wisdom?: WisdomPosition
  pos?: Vec
  target?: Vec
  fov?: number
  /** Сцена презентаций (состояния сверх режимов атласа, src/atlas/engine/learnScene.ts); null — обратно к атласу. */
  learn?: LearnId | null
  /** Свои точки частей: часть в ролике ещё не на месте (коронка над зубом) — точка там, где она в этот момент. */
  extra?: Partial<Record<PartId, Vec>>
}

/** Точка метки на кадре: доли ширины и высоты (0..1) и видна ли она с этой стороны. */
export type ShotPoint = { x: number; y: number; visible: boolean }

declare global {
  interface Window {
    shot: {
      loading(): boolean
      error(): string
      set(s: ShotState): void
      replay(): void
      advance(ms: number): Promise<void>
      capture(): Promise<{ png: string; points: Partial<Record<string, ShotPoint>> }>
    }
  }
}

// Своё время: до создания движка (он запоминает t0 = performance.now()). Кадр движка не идёт сам по
// requestAnimationFrame, а ждёт снимка: capture() рисует его один раз с нашим временем и сразу читает холст.
// Программный WebGL рисует кадр секунды (тени), лишние кадры между снимками — лишние минуты.
let clock = 0
let pending: FrameRequestCallback | null = null
const canvas = document.getElementById('gl') as HTMLCanvasElement
performance.now = () => clock
window.requestAnimationFrame = (cb) => {
  pending = cb
  return 1
}
window.cancelAnimationFrame = () => { pending = null }
/**
 * Метка кадра для движка — «как на быстром устройстве», 60 кадров в секунду. Время сцены движок берёт
 * из performance.now (clock), а по меткам кадров он судит о скорости: с настоящим шагом ролика (42 мс)
 * через 90 кадров он решил бы, что устройство слабое, и уменьшил холст вдвое посреди ролика.
 */
let frameTs = 0
/** Нарисовать кадр движка на текущее время. */
function draw(): void {
  const cb = pending
  pending = null
  frameTs += 1000 / 60
  cb?.(frameTs)
}

/** Метки всех частей, что есть в режиме: свои точки режима и общие точки здорового зуба (десна, кость, корень). */
function anchorsOf(mode: AtlasMode): [PartId, Vec][] {
  const out = new Map<PartId, Vec>()
  for (const l of [...MODE_LABELS.healthy, ...MODE_LABELS[mode]]) out.set(l.part, [...l.at])
  if (mode === 'implant') for (const p of ['enamel', 'dentin', 'pulp', 'vessels', 'canal', 'cementum', 'pdl'] as PartId[]) out.delete(p)
  return [...out]
}

let loading = true
let error = ''
let last: ScreenPoint[] = []
let anchors: Anchor[] = anchorsOf('healthy')
let pose: [Vec, Vec, number | undefined] | null = null
let view: AtlasView = 'tooth'

const engine: AtlasEngine = createAtlasEngine(canvas, {
  onFrame: (points) => { last = points },
  onLoading: (l) => { loading = l },
  onPickTooth: () => undefined,
  onPickPart: () => undefined,
  onError: (m) => { error = m },
})
engine.setAnchors(anchors.map(([, at]) => at))

window.shot = {
  loading: () => loading,
  error: () => error,
  set(s) {
    // Тот же вид заново не включаем: смена вида досылает «загрузка кончилась» от прежнего режима, пока сетки
    // нового ещё строятся, — скрипт снял бы кадр раньше времени
    if (s.view && s.view !== view) {
      view = s.view
      engine.setView(s.view)
    }
    if (s.learn !== undefined) {
      const id = s.learn
      engine.setCustom(id ? (m) => createLearnScene(m, id) : null)
      anchors = id ? (Object.entries(LEARN_ANCHORS[id]) as Anchor[]) : anchorsOf('healthy')
    }
    if (s.mode) {
      loading = true
      engine.setMode(s.mode)
      anchors = anchorsOf(s.mode)
    }
    if (s.extra) {
      const map = new Map(anchors)
      for (const [part, at] of Object.entries(s.extra)) map.set(part, at)
      anchors = [...map]
    }
    engine.setAnchors(anchors.map(([, at]) => at))
    if (s.stage != null) engine.setCariesStage(s.stage)
    if (s.wisdom) engine.setWisdom(s.wisdom)
    if (s.pos && s.target) {
      pose = [s.pos, s.target, s.fov]
      engine.setCameraPose(...pose)
    }
  },
  replay: () => engine.replay(),
  advance(ms) {
    clock += ms
    // Пусть промисы движка (сетки из Web Worker, смена режима) успеют выполниться
    return new Promise((resolve) => setTimeout(resolve, 0))
  },
  async capture() {
    // Тени движок пересчитывает, только пока сцена «в движении»; поза камеры заново — и тени этого кадра свежие
    if (pose) engine.setCameraPose(...pose)
    draw()
    // Тени и сглаживание считаются в этом же кадре; холст читаем сразу — буфер ещё не очищен
    const png = canvas.toDataURL('image/png')
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1
    const points: Partial<Record<string, ShotPoint>> = {}
    anchors.forEach(([part], i) => {
      const p = last[i]
      if (p) points[part] = { x: p.x / w, y: p.y / h, visible: p.visible }
    })
    return { png, points }
  },
}
