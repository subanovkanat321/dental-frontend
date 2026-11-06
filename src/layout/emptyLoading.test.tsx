import { act, render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'

import { addDays, emptyDayText, todayIn } from '../lib/time'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { EmptyState } from './EmptyState'
import { Loading, LOADING_DELAY_MS, Spinner } from './Loading'

/** Пустые состояния (полупрозрачный Тишка + фраза) и «Загрузка…» со спиннером через 300 мс. */
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  localStorage.clear()
})

test('«Загрузка…» появляется только после задержки — быстрый ответ не мигает', () => {
  vi.useFakeTimers()
  const { unmount } = render(<Loading />)
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  act(() => { vi.advanceTimersByTime(LOADING_DELAY_MS - 10) })
  expect(screen.queryByText('Загрузка…')).not.toBeInTheDocument()
  act(() => { vi.advanceTimersByTime(20) })
  const status = screen.getByRole('status')
  expect(status).toHaveTextContent('Загрузка…')
  expect(status).toHaveAttribute('aria-live', 'polite')
  unmount()
})

test('ответ пришёл раньше задержки — спиннер так и не показался', () => {
  vi.useFakeTimers()
  const { rerender } = render(<div>{<Loading text="Готовим 3D-модель…" />}</div>)
  act(() => { vi.advanceTimersByTime(100) })
  rerender(<div>Готово</div>)
  act(() => { vi.advanceTimersByTime(1000) })
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(screen.queryByText('Готовим 3D-модель…')).not.toBeInTheDocument()
})

test('спиннер в кнопке не меняет её имя', () => {
  render(<button type="button" disabled><Spinner />Сохраняем…</button>)
  expect(screen.getByRole('button', { name: 'Сохраняем…' })).toBeInTheDocument()
})

test('EmptyState: Тишка — картинка для глаз (aria-hidden), текст и действие — для всех', () => {
  const { container } = render(<EmptyState title="Пациентов пока нет" action={<button type="button">Добавить</button>}>Они появятся с первой записью.</EmptyState>)
  const mark = container.querySelector('svg.empty-mark')
  expect(mark).toHaveAttribute('aria-hidden', 'true')
  expect(screen.getByText('Пациентов пока нет')).toBeInTheDocument()
  expect(screen.getByText('Они появятся с первой записью.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Добавить' })).toBeInTheDocument()
})

test('пустой день словами: сегодня, завтра, дата; прошедший — «не было»', () => {
  const today = '2026-11-06'
  expect(emptyDayText(today, today)).toBe('На сегодня записей нет')
  expect(emptyDayText(addDays(today, 1), today)).toBe('На завтра записей нет')
  expect(emptyDayText('2026-11-12', today)).toBe('На 12 ноября записей нет')
  expect(emptyDayText(addDays(today, -1), today)).toBe('Вчера записей не было')
  expect(emptyDayText('2026-11-03', today)).toBe('3 ноября записей не было')
})

test('компьютер: в дне ни одной записи — Тишка и «На сегодня записей нет» над сеткой', async () => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('min-width'), media: query, addEventListener() {}, removeEventListener() {}, onchange: null,
    addListener() {}, removeListener() {}, dispatchEvent: () => false,
  }))
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments', () => HttpResponse.json([])),
    http.get('*/api/appointments/counts', () => HttpResponse.json([])),
    http.get('*/api/slots', () => HttpResponse.json({ workingDay: true, workStart: '09:00:00', workEnd: '18:00:00', breaks: [], free: [] })),
  )
  renderApp()
  const titles = await screen.findAllByText(emptyDayText(todayIn()))
  expect(titles[0]!.closest('.empty-state')?.querySelector('svg[aria-hidden="true"]')).not.toBeNull()
})
