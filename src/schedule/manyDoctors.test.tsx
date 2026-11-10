import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { slotInstant } from '../lib/time'
import { appointment, me, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { DOCTOR_HIDDEN_KEY, visibleDoctors } from './doctorVisibility'

/** Вымышленная клиника: врачей — сколько нужно тесту; входит админ-врач Айгерим (id 1). */
const NAMES = ['Айгерим Садыкова', 'Дастан Т.', 'Эрмек Н.', 'Жылдыз К.', 'Бакыт А.', 'Нурлан С.', 'Гульнара М.', 'Тимур Ж.', 'Асель Б.', 'Улан Р.']
const clinic = (n: number): Schemas['BookingViewsMe'] => ({
  ...me, doctors: NAMES.slice(0, n).map((fullName, i) => ({ id: i + 1, fullName, active: true })),
})

function screenSize(phone: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes(phone ? 'max-width' : 'min-width'), media: query, addEventListener() {}, removeEventListener() {}, onchange: null,
    addListener() {}, removeListener() {}, dispatchEvent: () => false,
  }))
}

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

/**
 * off — у кого сегодня выходной (/api/slots: workingDay=false); booked — у кого есть вымышленный приём.
 * У работающих — свободное окно поздно вечером: пустой день на телефоне иначе — Тишка без колонок.
 */
function backend(who: Schemas['BookingViewsMe'], { off = [], booked = [] }: { off?: number[]; booked?: number[] } = {}) {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(who)),
    http.get('*/api/appointments', ({ request }) => {
      const id = Number(new URL(request.url).searchParams.get('doctorId'))
      return HttpResponse.json(booked.includes(id) ? [appointment(100 + id, id, '10:00', `Пациент ${id}`)] : [])
    }),
    http.get('*/api/appointments/counts', () => HttpResponse.json([])),
    http.get('*/api/slots', ({ request }) => {
      const q = new URL(request.url).searchParams
      const date = q.get('date')!
      if (off.includes(Number(q.get('doctorId')))) return HttpResponse.json({ workingDay: false, breaks: [], free: [] } satisfies Schemas['SlotsView'])
      return HttpResponse.json({ workingDay: true, workStart: '09:00:00', workEnd: '18:00:00', breaks: [],
        free: [{ start: slotInstant(date, 23 * 60), end: slotInstant(date, 23 * 60 + 30) }] } satisfies Schemas['SlotsView'])
    }),
  )
}

/** Колонки сетки дня на компьютере — слева направо. */
const gridColumns = () => [...document.querySelectorAll('.grid-col')].map((c) => c.getAttribute('aria-label'))
/** Колонки «Все врачи» на телефоне — слева направо. */
const phoneColumns = () => [...document.querySelectorAll('section.doctor-day')].map((s) => s.getAttribute('aria-label'))

test('компьютер: скрытый в «Врачи в расписании» — не колонкой в «Все врачи», но открывается отдельно чипом', async () => {
  screenSize(false)
  backend(clinic(3))
  renderApp()
  await screen.findByRole('group', { name: 'Эрмек Н.' })
  const chips = screen.getByRole('group', { name: 'Чьё расписание' })
  await userEvent.click(within(chips).getByRole('button', { name: 'Врачи в расписании…' }))
  const dialog = screen.getByRole('dialog', { name: 'Врачи в расписании' })
  await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Показывать: Дастан Т.' }))
  await userEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }))

  expect(gridColumns()).toEqual(['Айгерим Садыкова', 'Эрмек Н.'])
  expect(screen.getByText(/показано 2 из 3/)).toBeInTheDocument()
  // Записей и врачей в заголовке — по всем
  expect(screen.getByText(/врачей 3/)).toBeInTheDocument()
  // На устройстве — только id скрытых
  expect(JSON.parse(localStorage.getItem(DOCTOR_HIDDEN_KEY)!)).toEqual([2])

  // Чип скрытого врача на месте — его день открывается
  await userEvent.click(within(chips).getByRole('button', { name: /Дастан Т\./ }))
  expect(gridColumns()).toEqual(['Дастан Т.'])
  await userEvent.click(within(chips).getByRole('button', { name: /Все врачи/ }))
  expect(gridColumns()).toEqual(['Айгерим Садыкова', 'Эрмек Н.'])
})

test('телефон: скрытый — не колонкой в «Все врачи», но есть в выборе врача', async () => {
  screenSize(true)
  localStorage.setItem(DOCTOR_HIDDEN_KEY, '[3]')
  localStorage.setItem('crm.schedule.view', 'all')
  backend(clinic(3))
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: /^Чьё расписание: Айгерим Садыкова \(я\)/ }))
  await userEvent.click(within(screen.getByRole('listbox', { name: 'Чьё расписание' })).getByRole('option', { name: /Все врачи/ }))
  await screen.findByRole('region', { name: 'Дастан Т.' })
  expect(phoneColumns()).toEqual(['Айгерим Садыкова', 'Дастан Т.'])
  expect(screen.getByText('Показано 2 из 3')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Чьё расписание: Все врачи, показано 2 из 3' })).toHaveTextContent('Врачи: 2 из 3')

  await userEvent.click(screen.getByRole('button', { name: /^Чьё расписание: Все врачи/ }))
  await userEvent.click(within(screen.getByRole('listbox', { name: 'Чьё расписание' })).getByRole('option', { name: /Эрмек Н\./ }))
  expect(await screen.findByRole('button', { name: /^Чьё расписание: Эрмек Н\./ })).toBeInTheDocument()
})

test('новый врач (его нет в сохранённом выборе) — показан', async () => {
  screenSize(false)
  // Скрыли Дастана, когда врачей было трое; теперь пришёл четвёртый — Жылдыз
  localStorage.setItem(DOCTOR_HIDDEN_KEY, '[2]')
  backend(clinic(4))
  renderApp()
  await screen.findByRole('group', { name: 'Жылдыз К.' })
  expect(gridColumns()).toEqual(['Айгерим Садыкова', 'Эрмек Н.', 'Жылдыз К.'])
})

test('нельзя снять последнюю галочку; все скрыты в старом выборе — показаны все', async () => {
  expect(visibleDoctors([{ id: 1 }, { id: 2 }], [1, 2]).map((d) => d.id)).toEqual([1, 2])
  screenSize(false)
  backend(clinic(3))
  renderApp()
  await screen.findByRole('group', { name: 'Эрмек Н.' })
  await userEvent.click(screen.getByRole('button', { name: 'Врачи в расписании…' }))
  const dialog = screen.getByRole('dialog', { name: 'Врачи в расписании' })
  await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Показывать: Айгерим Садыкова' }))
  await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Показывать: Дастан Т.' }))
  const last = within(dialog).getByRole('checkbox', { name: 'Показывать: Эрмек Н.' })
  expect(last).toBeChecked()
  expect(last).toBeDisabled()
  await userEvent.click(last)
  expect(last).toBeChecked()
  // Вернули галочку — последняя снова снимается
  await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Показывать: Дастан Т.' }))
  expect(last).toBeEnabled()
  await userEvent.click(within(dialog).getByRole('button', { name: 'Как было' }))
  expect(localStorage.getItem(DOCTOR_HIDDEN_KEY)).toBeNull()
  expect(gridColumns()).toEqual(['Айгерим Садыкова', 'Дастан Т.', 'Эрмек Н.'])
})

test('компьютер: выходной без приёмов — колонки нет, с приёмом — есть; «показать» возвращает до смены дня', async () => {
  screenSize(false)
  // Выходной у Дастана (без приёмов) и у Эрмека (у него приём — колонка остаётся)
  backend(clinic(4), { off: [2, 3], booked: [3] })
  renderApp()
  await screen.findByText('Выходной: Дастан')
  expect(gridColumns()).toEqual(['Айгерим Садыкова', 'Эрмек Н.', 'Жылдыз К.'])
  expect(screen.getByText(/показано 3 из 4/)).toBeInTheDocument()

  await userEvent.click(screen.getByRole('button', { name: 'Показать колонки: Дастан' }))
  expect(gridColumns()).toEqual(['Айгерим Садыкова', 'Дастан Т.', 'Эрмек Н.', 'Жылдыз К.'])
  expect(screen.queryByText('Выходной: Дастан')).not.toBeInTheDocument()

  // Другой день — снова без выходных колонок
  await userEvent.click(screen.getByRole('button', { name: 'Следующий день' }))
  await screen.findByText('Выходной: Дастан')
  expect(gridColumns()).toEqual(['Айгерим Садыкова', 'Эрмек Н.', 'Жылдыз К.'])
})

test('выходной у всех — колонки остаются, как раньше (с пометкой «Выходной»)', async () => {
  screenSize(false)
  backend(clinic(2), { off: [1, 2] })
  renderApp()
  await screen.findByRole('group', { name: 'Дастан Т.' })
  await vi.waitFor(() => expect(document.querySelectorAll('.grid-off')).toHaveLength(2))
  expect(gridColumns()).toEqual(['Айгерим Садыкова', 'Дастан Т.'])
  expect(screen.queryByRole('button', { name: /^Показать колонки/ })).not.toBeInTheDocument()
})

test('телефон: выходной без приёмов — колонки нет, «показать» возвращает', async () => {
  screenSize(true)
  localStorage.setItem('crm.schedule.view', 'all')
  backend(clinic(3), { off: [2] })
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: /^Чьё расписание: Айгерим Садыкова \(я\)/ }))
  await userEvent.click(within(screen.getByRole('listbox', { name: 'Чьё расписание' })).getByRole('option', { name: /Все врачи/ }))
  await screen.findByRole('region', { name: 'Эрмек Н.' })
  await vi.waitFor(() => expect(phoneColumns()).toEqual(['Айгерим Садыкова', 'Эрмек Н.']))
  await userEvent.click(screen.getByRole('button', { name: 'Показать колонки: Дастан' }))
  expect(phoneColumns()).toEqual(['Айгерим Садыкова', 'Дастан Т.', 'Эрмек Н.'])
})

test('компьютер: больше 6 врачей — одна кнопка «Все врачи ▾» вместо ряда чипов; до 6 — чипы', async () => {
  screenSize(false)
  localStorage.setItem(DOCTOR_HIDDEN_KEY, '[9, 10]')
  backend(clinic(10))
  const { unmount } = renderApp()
  await screen.findByRole('group', { name: 'Тимур Ж.' })
  expect(screen.queryByRole('group', { name: 'Чьё расписание' })).not.toBeInTheDocument()
  const button = screen.getByRole('button', { name: 'Чьё расписание: Все врачи, показано 8 из 10' })
  expect(button).toHaveTextContent('Врачи: 8 из 10')
  await userEvent.click(button)
  const options = within(screen.getByRole('listbox', { name: 'Чьё расписание' })).getAllByRole('option')
  // Все десять (и скрытые) + «Все врачи»
  expect(options).toHaveLength(11)
  await userEvent.click(options.find((o) => o.textContent?.includes('Улан Р.'))!)
  expect(gridColumns()).toEqual(['Улан Р.'])
  unmount()

  localStorage.clear()
  backend(clinic(6))
  renderApp()
  await screen.findByRole('group', { name: 'Нурлан С.' })
  expect(within(screen.getByRole('group', { name: 'Чьё расписание' })).getAllByRole('button')).toHaveLength(8) // «Все врачи», 6 врачей, ⇅
})
