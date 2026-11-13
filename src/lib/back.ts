import { useEffect, useRef } from 'react'
import { flushSync } from 'react-dom'

import { useSectionActive } from './section'

import { telegram } from './telegram'

/**
 * Единый «Назад» для всего приложения. Вложенных экранов много: карточка приёма, пункт «Настроек»,
 * в нём карточка врача, лист выбора, календарь, зубы на весь экран… Каждый открытый слой кладёт
 * свой шаг назад в стопку (useBack), и «назад» любым способом закрывает верхний:
 *
 * - стрелка Telegram (BackButton; на Android туда же приходит системная кнопка «Назад»);
 * - история браузера: слой кладёт запись в history (pushState с маркером `tishBack` — глубиной).
 *   «Назад» телефона Android, свайп от края в Safari, кнопка браузера — это history.back(): на
 *   popstate закрываются слои глубже новой записи. Закрыли слой своей ✕ — его запись убираем
 *   (history.back()), чтобы не копились пустые шаги и «Назад» не уводил с сайта раньше времени;
 * - свайп от левого края там, где системного жеста нет (lib/edgeSwipe.ts: PWA и Telegram на iPhone).
 *
 * Слой с адресом (`url: true`: пункт «Настроек» #/settings/…, атлас #/atlas) в history не пишет —
 * его шаг и так в адресе; он только в стопке для Telegram и свайпа.
 * В Telegram history не трогаем: «назад» там — его стрелка.
 */
type Layer = {
  run: () => void
  /** Пишет ли слой свою запись в history */
  history: boolean
  /** Глубина его записи (history.state.tishBack); null — записи пока (или уже) нет */
  depth: number | null
}

const stack: Layer[] = []

/** Тесты: история браузера выключена (иначе отложенные history.back() одного теста перелетают в другой). */
let historyOn = import.meta.env.MODE !== 'test'

/** Мы сами идём назад (убираем запись закрытого слоя): ждём popstate, новых записей пока не кладём */
let navigating = false
let navTimer: ReturnType<typeof setTimeout> | undefined
/** Записи, чьи слои закрыли не через «назад» (✕, Esc): на них не останавливаемся */
const released = new Set<number>()
let scheduled = false
let listening = false
/** Что сделать, когда закрытые слои уберут свои записи из истории (whenHistorySettled) */
const settled: (() => void)[] = []

function historyMode(): boolean {
  return historyOn && !telegram() && typeof window.history?.pushState === 'function'
}

/** Глубина текущей записи истории: 0 — запись не наша (страница, раздел #/…). */
function current(): number {
  const state = window.history.state as { tishBack?: unknown } | null
  return state && typeof state === 'object' && typeof state.tishBack === 'number' ? state.tishBack : 0
}

function stopNavigating() {
  navigating = false
  clearTimeout(navTimer)
}

function goBack() {
  navigating = true
  clearTimeout(navTimer)
  // popstate не пришёл (браузер отказал) — не зависаем
  navTimer = setTimeout(() => {
    stopNavigating()
    schedule()
    setTimeout(flushSettled, 0)
  }, 1000)
  try {
    window.history.back()
  } catch {
    stopNavigating()
  }
}

function schedule() {
  if (scheduled) return
  scheduled = true
  // После коммита React: открыли и тут же закрыли (StrictMode, смена карточки) — один пересчёт
  queueMicrotask(() => {
    scheduled = false
    syncHistory()
  })
}

/** Привести историю к стопке: у каждого открытого слоя — своя запись, лишних сверху нет. */
function syncHistory() {
  if (navigating || !historyMode()) return
  listen()
  const top = current()
  if (released.has(top)) {
    goBack()
    return
  }
  for (const layer of stack) {
    if (!layer.history || layer.depth != null) continue
    const at = current()
    // Вернулись «назад» на запись слоя, который снова на экране (раздел снова открыт) — занимаем её
    if (at > 0 && !stack.some((l) => l.depth === at)) {
      layer.depth = at
      continue
    }
    const depth = at + 1
    try {
      const state = (window.history.state ?? {}) as object
      window.history.pushState({ ...state, tishBack: depth }, '')
    } catch {
      // Safari ограничивает частоту pushState — без записи слой закроется ✕ и стрелкой
      return
    }
    released.delete(depth)
    layer.depth = depth
  }
}

function onPopState() {
  const depth = current()
  for (const d of [...released]) if (d > depth) released.delete(d)
  if (navigating) {
    stopNavigating()
    syncHistory()
    flushSettled()
    return
  }
  // «Назад» телефона или браузера: закрыть слои, чьи записи остались впереди
  const closing = stack.filter((l) => l.depth != null && l.depth > depth).reverse()
  for (const layer of closing) {
    layer.depth = null
    // Сразу, а не после отрисовки: остался открытым (ответили «не выходить») — вернём ему запись
    flushSync(() => layer.run())
  }
  schedule()
}

function listen() {
  if (listening) return
  listening = true
  window.addEventListener('popstate', onPopState)
}

function add(layer: Layer) {
  stack.push(layer)
  syncTelegram()
  if (layer.history) schedule()
}

function remove(layer: Layer) {
  const i = stack.indexOf(layer)
  if (i >= 0) stack.splice(i, 1)
  syncTelegram()
  if (layer.depth != null && historyMode()) {
    // Закрыли ✕ (запись слоя ещё в истории) — убираем её. Ушли в другой раздел через адрес
    // (текущая запись — уже не наша) — запись остаётся: «назад» вернёт раздел с этим слоем
    if (layer.depth <= current()) released.add(layer.depth)
    layer.depth = null
  }
  schedule()
}

let wiredTo: object | null = null

function syncTelegram() {
  const back = telegram()?.BackButton
  if (!back) return
  if (wiredTo !== back) {
    back.onClick(closeTopLayer)
    wiredTo = back
  }
  if (stack.length) back.show()
  else back.hide()
}

/**
 * Пока экран открыт — «назад» (Telegram, телефон, браузер, свайп от края) выполняет onBack.
 * null — экран без шага назад. `url: true` — экран уже записан в адресе (#/settings/…).
 */
export function useBack(onBack: (() => void) | null, options?: { url?: boolean }): void {
  const handler = useRef(onBack)
  useEffect(() => {
    handler.current = onBack
  })
  const visible = useSectionActive()
  const active = onBack != null && visible
  const history = !options?.url
  useEffect(() => {
    if (!active) return
    const layer: Layer = { run: () => handler.current?.(), history, depth: null }
    add(layer)
    return () => remove(layer)
  }, [active, history])
}

function flushSettled() {
  // Ещё идём назад — подождём popstate; сейчас решаем, идти ли (микрозадача syncHistory) — заглянем чуть позже
  if (navigating) return
  if (scheduled) {
    setTimeout(flushSettled, 0)
    return
  }
  for (const fn of settled.splice(0)) fn()
}

/**
 * Сделать `fn` (переход по адресу), когда только что закрытый слой уберёт свою запись из истории.
 * Лист подразделов: выбрали пункт — лист закрывается, и его запись (`tishBack`) снимается шагом назад.
 * Перейти сразу нельзя: переход заменой адреса (`location.replace`) лёг бы на запись листа, а Safari
 * при замене только хэша оставляет у записи её state — `tishBack` листа; закрытие листа потом считает
 * запись своей, делает history.back() — и возвращает на прежний подраздел («лист закрылся, а я там же»).
 * Без истории (Telegram, тесты) — сразу.
 */
export function whenHistorySettled(fn: () => void): void {
  if (!historyMode()) {
    fn()
    return
  }
  settled.push(fn)
  // После отрисовки: слой уберут эффекты React, его шаг назад запустит syncHistory (микрозадача)
  setTimeout(flushSettled, 0)
}

/** Закрыть верхний слой (стрелка Telegram, свайп от края). false — закрывать нечего. */
export function closeTopLayer(): boolean {
  const top = stack.at(-1)
  if (!top) return false
  top.run()
  return true
}

/** Сколько шагов назад сейчас в стопке. */
export function backDepth(): number {
  return stack.length
}

/** Только для тестов: включить запись слоёв в history браузера. */
export function enableBackHistory(on: boolean): void {
  historyOn = on
  stopNavigating()
  released.clear()
}
