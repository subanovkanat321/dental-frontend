import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'

import { useBack } from './back'
import { edgeSwipeWanted, startEdgeSwipe } from './edgeSwipe'

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

function Card() {
  const [open, setOpen] = useState(true)
  useBack(open ? () => setOpen(false) : null)
  if (!open) return <p>Расписание</p>
  return (
    <aside aria-label="Карточка приёма" style={{ position: 'fixed' }}>
      <div data-testid="chips" style={{ overflowX: 'auto' }}>чипы</div>
    </aside>
  )
}

/** Палец: от (x, y) на dx, dy и отпустить. */
function swipe(el: Element, x: number, y: number, dx: number, dy = 0) {
  const at = (cx: number, cy: number) => [{ identifier: 1, clientX: cx, clientY: cy }]
  fireEvent.touchStart(el, { touches: at(x, y), changedTouches: at(x, y) })
  fireEvent.touchMove(el, { touches: at(x + dx / 2, y + dy / 2), changedTouches: at(x + dx / 2, y + dy / 2) })
  fireEvent.touchMove(el, { touches: at(x + dx, y + dy), changedTouches: at(x + dx, y + dy) })
  fireEvent.touchEnd(el, { touches: [], changedTouches: at(x + dx, y + dy) })
}

let stop: () => void
const nav = navigator as Navigator & { standalone?: boolean }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'requestAnimationFrame'] })
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(IPHONE)
  nav.standalone = true // значок на экране «Домой»
  stop = startEdgeSwipe()
})

afterEach(() => {
  stop()
  delete nav.standalone
  vi.restoreAllMocks()
  vi.useRealTimers()
})

async function settle() {
  await act(async () => { vi.advanceTimersByTime(400) })
}

test('PWA на iPhone: свайп от левого края на 100 px закрывает карточку', async () => {
  render(<Card />)
  swipe(screen.getByRole('complementary'), 5, 300, 100)
  await settle()
  expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
  expect(screen.getByText('Расписание')).toBeInTheDocument()
})

test('во время жеста карточка едет за пальцем; отпустили раньше порога — возвращается', async () => {
  render(<Card />)
  const card = screen.getByRole('complementary')
  const at = (cx: number) => [{ identifier: 1, clientX: cx, clientY: 300 }]
  fireEvent.touchStart(card, { touches: at(5), changedTouches: at(5) })
  fireEvent.touchMove(card, { touches: at(40), changedTouches: at(40) })
  expect(card.style.transform).toBe('translateX(35px)')
  expect(card.style.boxShadow).toContain('rgba(0, 0, 0,')
  fireEvent.touchEnd(card, { touches: [], changedTouches: at(40) })
  await settle()
  expect(screen.getByRole('complementary')).toBeInTheDocument()
  expect(card.style.transform).toBe('')
})

test('«меньше движения» в системе: карточка не едет, но жест закрывает', async () => {
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({ matches: q.includes('reduced-motion'), media: q })) as unknown as typeof window.matchMedia
  try {
    render(<Card />)
    const card = screen.getByRole('complementary')
    const at = (cx: number) => [{ identifier: 1, clientX: cx, clientY: 300 }]
    fireEvent.touchStart(card, { touches: at(5), changedTouches: at(5) })
    fireEvent.touchMove(card, { touches: at(60), changedTouches: at(60) })
    expect(card.style.transform).toBe('')
    fireEvent.touchMove(card, { touches: at(110), changedTouches: at(110) })
    fireEvent.touchEnd(card, { touches: [], changedTouches: at(110) })
    await settle()
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
  } finally {
    // @ts-expect-error — в jsdom matchMedia нет, вернуть как было
    delete window.matchMedia
  }
})

test('не от края, короткий или вертикальный жест — карточка остаётся', async () => {
  render(<Card />)
  const card = screen.getByRole('complementary')
  swipe(card, 60, 300, 100) // не от края
  swipe(card, 5, 300, 30) // короткий
  swipe(card, 5, 300, 20, 150) // вниз — это прокрутка
  await settle()
  expect(screen.getByRole('complementary')).toBeInTheDocument()
})

test('прокрутка вбок внутри (ряд чипов уже сдвинут) — не перехватываем', async () => {
  render(<Card />)
  const chips = screen.getByTestId('chips')
  Object.defineProperty(chips, 'scrollWidth', { value: 800 })
  Object.defineProperty(chips, 'clientWidth', { value: 300 })
  chips.scrollLeft = 120
  swipe(chips, 5, 300, 100)
  await settle()
  expect(screen.getByRole('complementary')).toBeInTheDocument()
})

test('в обычном Safari на iPhone жест не перехватываем: его делает сам браузер через историю', async () => {
  delete nav.standalone
  expect(edgeSwipeWanted()).toBe(false)
  render(<Card />)
  swipe(screen.getByRole('complementary'), 5, 300, 100)
  await settle()
  expect(screen.getByRole('complementary')).toBeInTheDocument()
})

test('Telegram: свайп от края — на iPhone, на Android — нет (там системная «Назад»)', () => {
  delete nav.standalone
  window.Telegram = { WebApp: { initData: 'test', platform: 'ios', ready() {}, expand() {} } }
  try {
    expect(edgeSwipeWanted()).toBe(true)
    window.Telegram.WebApp!.platform = 'android'
    expect(edgeSwipeWanted()).toBe(false)
  } finally {
    delete window.Telegram
  }
})

test('без открытых слоёв жест ничего не делает', async () => {
  render(<p>Расписание</p>)
  expect(() => swipe(screen.getByText('Расписание'), 5, 300, 100)).not.toThrow()
})
