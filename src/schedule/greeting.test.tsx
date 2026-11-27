import { act, render, screen } from '@testing-library/react'

import { Greeting, GREETING_MS } from './Greeting'

beforeEach(() => localStorage.clear())
afterEach(() => vi.useRealTimers())

// 03:00Z = 09:00 по Бишкеку
const at = (iso: string) => new Date(iso)

test('утро по Бишкеку: имя — первое слово, записи врача и первая', () => {
  render(<Greeting name="Нурболот Тестов" doctorId={1} now={at('2026-11-27T03:00:00Z')} appointments={[
    { startAt: '2026-11-27T04:00:00Z', doctorId: 1 }, { startAt: '2026-11-27T06:00:00Z', doctorId: 1 },
    { startAt: '2026-11-27T05:00:00Z', doctorId: 2 }, { startAt: '2026-11-27T07:00:00Z', doctorId: 1, status: 'CANCELLED' },
  ]} />)
  expect(screen.getByText(/👋/).closest('p')).toHaveTextContent('Доброе утро, Нурболот 👋 · сегодня 2 записи, первая в 10:00')
})

test('днём — «следующая», вечером — «Добрый вечер», без записей — «пока нет»', () => {
  const { unmount } = render(<Greeting name="Айгерим" now={at('2026-11-27T07:30:00Z')} appointments={[
    { startAt: '2026-11-27T04:00:00Z' }, { startAt: '2026-11-27T09:00:00Z' }]} />)
  expect(screen.getByText(/👋/).closest('p')).toHaveTextContent('Добрый день, Айгерим 👋 · сегодня 2 записи, следующая в 15:00')
  unmount()
  localStorage.clear()
  render(<Greeting name="Айгерим" now={at('2026-11-27T12:00:00Z')} appointments={[]} />)
  expect(screen.getByText(/👋/).closest('p')).toHaveTextContent('Добрый вечер, Айгерим 👋 · сегодня записей пока нет')
})

test('ночью по Бишкеку приветствия нет', () => {
  const { container } = render(<Greeting name="Айгерим" now={at('2026-11-27T19:00:00Z')} appointments={[]} />)
  expect(container).toBeEmptyDOMElement()
})

test('один раз в день: висит несколько секунд и уходит; второй вход за день — без приветствия', () => {
  vi.useFakeTimers()
  const now = at('2026-11-27T03:00:00Z')
  const first = render(<Greeting name="Айгерим" now={now} appointments={[]} />)
  expect(screen.getByText(/👋/)).toBeInTheDocument()
  act(() => { vi.advanceTimersByTime(GREETING_MS + 700) })
  expect(screen.queryByText(/👋/)).toBeNull()
  first.unmount()
  const again = render(<Greeting name="Айгерим" now={now} appointments={[]} />)
  expect(again.container).toBeEmptyDOMElement()
  again.unmount()
  // назавтра — снова
  render(<Greeting name="Айгерим" now={at('2026-11-28T03:00:00Z')} appointments={[]} />)
  expect(screen.getByText(/👋/)).toBeInTheDocument()
})
