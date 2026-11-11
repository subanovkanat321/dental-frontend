import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { api, unwrap, type Schemas } from '../api/client'
import { useBack } from '../lib/back'
import type { Page } from '../lib/route'
import { telegram } from '../lib/telegram'
import { matches, useMedia } from '../lib/useMedia'
import { SUB_HINT_KEY } from '../layout/section'
import { TOUR_EVENT, TOUR_KEY, useFirstScreensBusy } from './state'
import { tourSteps, type TourStep } from './steps'
import './tour.css'

type Me = Schemas['BookingViewsMe']

/** Пауза перед автозапуском: плашка «Заполните профиль» успеет сказать, что она есть. */
const START_DELAY_MS = 700

/** Сколько ждать элемент шага (раздел мог ещё догружаться), прежде чем пропустить шаг. */
const FIND_TIMEOUT_MS = 2500

/**
 * Тур при первом входе сотрудника: 4–6 подсказок по главным местам (tour/steps.ts). Один раз на
 * человека — отметку помнит сервер (GET/PUT /api/me/tour, V192), на любом устройстве. Сам начинается
 * только в «Расписании» и только когда нет других первых экранов (плашка профиля сама ждёт тура —
 * tour/state.ts). «Пройти тур ещё раз» в «Помощи» запускает его снова (событие TOUR_EVENT).
 *
 * Команде платформы без своей клиники тур не показываем: разделов клиники у неё нет. В Telegram Mini App
 * — показываем: там то же нижнее меню, что на телефоне.
 */
export function TourHost({ me, page }: { me: Me; page: Page }) {
  const staff = Boolean(me.doctor)
  const client = useQueryClient()
  const state = useQuery({ queryKey: TOUR_KEY, queryFn: () => unwrap(api.GET('/api/me/tour')), enabled: staff, staleTime: Infinity, retry: false })
  const mark = useMutation({
    mutationFn: () => unwrap(api.PUT('/api/me/tour')),
    onSuccess: (r) => client.setQueryData(TOUR_KEY, r),
  })
  const busy = useFirstScreensBusy()
  const [running, setRunning] = useState(false)
  // Закрыли в этом сеансе — сами не начинаем снова, даже если отметка не дошла до сервера
  const closed = useRef(false)
  const unseen = staff && state.isSuccess && !state.data.seenAt
  useEffect(() => {
    if (!unseen || busy || running || closed.current || page !== 'schedule') return
    const t = window.setTimeout(() => setRunning(true), START_DELAY_MS)
    return () => window.clearTimeout(t)
  }, [unseen, busy, running, page])
  useEffect(() => {
    if (!staff) return
    const onStart = () => setRunning(true)
    window.addEventListener(TOUR_EVENT, onStart)
    return () => window.removeEventListener(TOUR_EVENT, onStart)
  }, [staff])
  const phone = useMedia('(max-width: 760px)')
  const seenAt = state.data?.seenAt
  const { mutate } = mark
  const done = useCallback(() => {
    setRunning(false)
    closed.current = true
    // Прошёл или пропустил — одинаково «видел»; повторный тур из «Помощи» отметку уже не шлёт
    if (!seenAt) mutate()
  }, [seenAt, mutate])
  if (!running) return null
  return <Tour steps={tourSteps(me, phone, Boolean(telegram()))} page={page} onDone={done} />
}

function hideSubHint() {
  try {
    localStorage.setItem(SUB_HINT_KEY, 'seen')
  } catch {
    // приватный режим — подсказка просто покажется
  }
}

type Box = { top: number; left: number; width: number; height: number }

/** Элемент на экране: не в скрытом разделе и не спрятан стилями (на телефоне у бокового меню свои кнопки). */
function visible(el: Element): boolean {
  if (el.closest('[hidden]')) return false
  const check = (el as HTMLElement & { checkVisibility?: () => boolean }).checkVisibility
  return typeof check === 'function' ? check.call(el) : true
}

/** Элементы шага: по первому видимому на каждое значение `data-tour`. */
function targetsOf(step: TourStep): HTMLElement[] {
  return step.target.flatMap((t) => {
    const el = [...document.querySelectorAll<HTMLElement>(`[data-tour="${t}"]`)].find(visible)
    return el ? [el] : []
  })
}

function boxOf(els: HTMLElement[]): Box | null {
  if (!els.length) return null
  const rects = els.map((e) => e.getBoundingClientRect())
  const top = Math.min(...rects.map((r) => r.top))
  const left = Math.min(...rects.map((r) => r.left))
  const bottom = Math.max(...rects.map((r) => r.bottom))
  const right = Math.max(...rects.map((r) => r.right))
  return { top, left, width: right - left, height: bottom - top }
}

const PAD = 6
const MARGIN = 12
const GAP = 14

type Place = { top: number; left: number; side: 'below' | 'above' | 'right'; arrow: number }

/**
 * Где пузырь: у бокового меню (компьютер) — справа от элемента; иначе под ним, а нет места — над ним
 * (нижнее меню телефона). Всегда целиком в окне: по краям не меньше 12px.
 */
function placeOf(box: Box, w: number, h: number): Place {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const clampY = (y: number) => Math.max(MARGIN, Math.min(y, vh - h - MARGIN))
  const clampX = (x: number) => Math.max(MARGIN, Math.min(x, vw - w - MARGIN))
  const cx = box.left + box.width / 2
  const cy = box.top + box.height / 2
  const besideMenu = vw > 760 && box.left + box.width < 320 && box.left + box.width + PAD + GAP + w <= vw - MARGIN
  if (besideMenu) {
    const top = clampY(cy - h / 2)
    return { top, left: box.left + box.width + PAD + GAP, side: 'right', arrow: Math.max(16, Math.min(cy - top, h - 16)) }
  }
  // Широкий элемент (полоса вкладок) — пузырь к его началу, а не в середину пустой полосы
  const ax = box.width > w * 1.5 ? box.left + Math.min(box.width / 4, 160) : cx
  const left = clampX(ax - w / 2)
  const arrow = Math.max(18, Math.min(ax - left, w - 18))
  const below = box.top + box.height + PAD + GAP
  if (below + h <= vh - MARGIN) return { top: below, left, side: 'below', arrow }
  const above = box.top - PAD - GAP - h
  if (above >= MARGIN) return { top: above, left, side: 'above', arrow }
  // Элемент почти во весь экран — пузырь внизу окна поверх него
  return { top: vh - h - MARGIN, left, side: 'above', arrow: -1 }
}

/**
 * Сам тур: затемнение с «окном» вокруг элемента (рамка со скруглением), рядом пузырь — заголовок,
 * 1–2 строки, «Дальше» / «Пропустить», «2 из 5». Окно и пузырь следят за прокруткой и размером окна.
 * Клавиатура: Esc — пропустить, Enter / → — дальше, ← — назад; фокус — в пузыре. Шаг, чей элемент не
 * нашёлся, пропускается; ушли в другой раздел ради шага — в конце возвращаемся, где были.
 */
export function Tour({ steps: all, page, onDone }: {
  steps: TourStep[]
  page: Page
  onDone: () => void
}) {
  const [steps, setSteps] = useState(all)
  const [index, setIndex] = useState(0)
  // Где элемент шага; от прошлого шага не годится — пока ищем новый, окна нет
  const [found, setFound] = useState<{ step: TourStep; box: Box } | null>(null)
  const [place, setPlace] = useState<Place | null>(null)
  const pop = useRef<HTMLDivElement>(null)
  const primary = useRef<HTMLButtonElement>(null)
  const startHash = useRef(window.location.hash)
  const returnFocus = useRef<Element | null>(document.activeElement)
  const step = steps[index]
  const box = found && found.step === step ? found.box : null
  const hasBox = box != null
  const last = index === steps.length - 1

  const finish = useCallback(() => {
    // Тур уводил в другой раздел (вкладки — в «Пациентах») — вернуть туда, где человек был
    if (window.location.hash !== startHash.current) window.location.hash = startHash.current || '/schedule'
    if (returnFocus.current instanceof HTMLElement) returnFocus.current.focus({ preventScroll: true })
    onDone()
  }, [onDone])
  const next = useCallback(() => {
    if (last) finish()
    else setIndex((i) => i + 1)
  }, [last, finish])
  const back = useCallback(() => setIndex((i) => Math.max(0, i - 1)), [])
  // «Назад» Telegram и свайп от края — пропустить тур. Записи в history не кладём (url: true): тур сам
  // меняет раздел в адресе, и popstate от этого перехода закрыл бы его
  useBack(finish, { url: true })

  // Шаг: открыть нужный раздел и найти элемент (раздел может догружаться). Не нашёлся — шаг убираем
  useEffect(() => {
    if (!step) return
    if (step.page && step.page !== page) {
      // Тур сам расскажет про вкладки — пузырь-подсказка SubTabs поверх него не нужен
      if (step.id === 'tabs') hideSubHint()
      // Как переход из меню (App: раздел — в адресе #/раздел)
      window.location.hash = `/${step.page}`
      return // раздел сменится — эффект перезапустится с новым page
    }
    const started = Date.now()
    let timer: number | undefined
    const find = () => {
      const els = targetsOf(step)
      if (els.length) {
        els[0]!.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: matches('(prefers-reduced-motion: reduce)') ? 'auto' : 'smooth' })
        setFound({ step, box: boxOf(els)! })
        return
      }
      if (Date.now() - started < FIND_TIMEOUT_MS) {
        timer = window.setTimeout(find, 100)
        return
      }
      // Не нашёлся — шаг убираем: следующий встаёт на его место (счётчик «из N» уменьшится)
      const left = steps.filter((s) => s !== step)
      // Это был последний шаг — тур окончен
      if (index >= left.length) {
        finish()
        return
      }
      setSteps(left)
    }
    find()
    return () => window.clearTimeout(timer)
  }, [step, steps, index, page, finish])

  // Следим за элементом: прокрутка, поворот телефона, размер окна, догрузка раздела
  useEffect(() => {
    if (!step) return
    let frame = 0
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const b = boxOf(targetsOf(step))
        if (b) setFound((p) => (p && p.step === step && p.box.top === b.top && p.box.left === b.left && p.box.width === b.width && p.box.height === b.height ? p : { step, box: b }))
      })
    }
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null
    observer?.observe(document.body)
    for (const el of targetsOf(step)) observer?.observe(el)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
      observer?.disconnect()
    }
  }, [step, hasBox])

  // Пузырь — по месту элемента и своему размеру
  useLayoutEffect(() => {
    const el = pop.current
    if (!box || !el) return
    setPlace(placeOf(box, el.offsetWidth, el.offsetHeight))
  }, [box, index])

  // Новый шаг — фокус на «Дальше»: Enter сразу листает, Tab — к «Пропустить»
  useEffect(() => {
    if (hasBox) primary.current?.focus({ preventScroll: true })
  }, [hasBox, index])

  // Клавиатура: перехватываем раньше разделов (их Esc закрыл бы карточку под туром)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inPop = e.target instanceof Node && pop.current?.contains(e.target)
      if (e.key === 'Escape') finish()
      else if (e.key === 'ArrowRight') next()
      else if (e.key === 'ArrowLeft') back()
      else if (e.key === 'Enter' && !(inPop && e.target instanceof HTMLButtonElement)) next()
      else if (e.key === 'Tab') {
        // Фокус не уходит из пузыря под затемнение
        const buttons = [...(pop.current?.querySelectorAll<HTMLElement>('button') ?? [])]
        if (!buttons.length) return
        const i = buttons.indexOf(document.activeElement as HTMLElement)
        const to = e.shiftKey ? (i <= 0 ? buttons.length - 1 : i - 1) : (i === buttons.length - 1 ? 0 : i + 1)
        buttons[to]!.focus()
      } else if (!(e.key === 'Enter' || e.key === ' ')) return
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [finish, next, back])

  if (!step) return null
  const hole = box && {
    top: Math.max(4, box.top - PAD),
    left: Math.max(4, box.left - PAD),
    width: Math.min(box.width + 2 * PAD, window.innerWidth - Math.max(4, box.left - PAD) - 4),
    height: Math.min(box.height + 2 * PAD, window.innerHeight - Math.max(4, box.top - PAD) - 4),
  }
  const count = `${index + 1} из ${steps.length}`
  return createPortal(
    <div className="tour" data-tour-step={step.id}>
      {hole ? <div className="tour-hole" style={hole} /> : <div className="tour-dim" />}
      <div ref={pop} className="tour-pop" role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-text"
        data-side={place?.side} hidden={!box}
        style={place ? { top: place.top, left: place.left, visibility: 'visible' } : { visibility: 'hidden' }}>
        {place && place.arrow >= 0 && <span className="tour-arrow" aria-hidden="true" style={place.side === 'right' ? { top: place.arrow } : { left: place.arrow }} />}
        <p className="tour-count">{count}</p>
        <h2 id="tour-title">{step.title}</h2>
        <p id="tour-text">{step.text}</p>
        <div className="tour-actions">
          {!last && <button type="button" className="tour-skip" onClick={finish}>Пропустить</button>}
          {index > 0 && <button type="button" className="btn small" onClick={back}>Назад</button>}
          <button ref={primary} type="button" className="btn primary small" onClick={next}>{last ? 'Готово' : 'Дальше'}</button>
        </div>
      </div>
      {/* Читалке экрана — новый шаг вслух */}
      <p className="sr-only" aria-live="polite">{box ? `Подсказка ${count}: ${step.title}` : ''}</p>
    </div>,
    document.body,
  )
}
