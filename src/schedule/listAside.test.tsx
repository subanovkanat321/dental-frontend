import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import { addDays, dayTitle, slotInstant, todayIn } from '../lib/time'
import { appointment, me, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { MODE_KEY } from './viewMode'

/** Ноутбук: «Список» одного врача; wide — от 1280px (панель «Сегодня»), иначе — уже. Телефонные (max-width) не совпадают. */
function screenOf(wide: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('min-width') && (wide || !query.includes('1280')), media: query, addEventListener() {}, removeEventListener() {},
    onchange: null, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  }))
}

beforeEach(() => {
  localStorage.setItem(MODE_KEY, 'list')
  localStorage.setItem('crm.schedule.view.v2', '1')
})
afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

/** Сегодня у врача 1 — заявка из бота (или ничего, empty); завтра — один приём в 11:00. */
function backend({ empty = false } = {}) {
  const today = todayIn()
  const tomorrow = addDays(today, 1)
  const request = appointment(10, 1, '10:00', 'Бакыт Тестов', { status: 'REQUESTED' })
  const next = { ...appointment(11, 1, '11:00', 'Айжан Тестова', { serviceName: 'Осмотр' }), startAt: slotInstant(tomorrow, 11 * 60), endAt: slotInstant(tomorrow, 11 * 60 + 30) }
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments', ({ request: r }) => {
      const url = new URL(r.url)
      if (url.searchParams.get('doctorId') !== '1') return HttpResponse.json([])
      const date = url.searchParams.get('date')
      return HttpResponse.json(date === today && !empty ? [request] : date === tomorrow ? [next] : [])
    }),
    // Только /api/appointments/{id}: «to-pay», «revenue» и прочие — дальше, к общему фальшивому бэкенду
    http.get('*/api/appointments/:id', ({ params }) => (/^\d+$/.test(String(params.id)) ? HttpResponse.json(Number(params.id) === 10 ? request : next) : undefined)),
    http.get('*/api/slots', ({ request: r }) => {
      const date = new URL(r.url).searchParams.get('date') ?? today
      return HttpResponse.json({ workingDay: true, workStart: '09:00:00', workEnd: '18:00:00', breaks: [], free: [{ start: slotInstant(date, 13 * 60), end: slotInstant(date, 18 * 60) }] })
    }),
  )
}

test('ноутбук от 1280px, «Список» одного врача: справа панель «Сегодня» — «Требует внимания» оттуда, а не строкой над списком', async () => {
  screenOf(true)
  backend()
  renderApp()
  const aside = await screen.findByRole('complementary', { name: 'Сегодня' })
  expect(within(aside).getByRole('heading', { name: 'Следующий пациент' })).toBeInTheDocument()
  expect(within(aside).getByRole('heading', { name: 'Требует внимания' })).toBeInTheDocument()
  // Плашки «Требует внимания» — только в панели: строки над списком нет (одни и те же плашки дважды — шум)
  expect(screen.getAllByRole('group', { name: 'Требует внимания' })).toHaveLength(1)
  expect(document.querySelector('.list-cols.with-aside')).not.toBeNull()
  // Заявка из бота — нажать, откроется карточка приёма (панель уступает ей место)
  await userEvent.click(await within(aside).findByRole('button', { name: /1 заявка из бота — подтвердить/ }))
  expect(await screen.findByRole('heading', { name: /10:00–10:30/ })).toBeInTheDocument()
  expect(screen.queryByRole('complementary', { name: 'Сегодня' })).not.toBeInTheDocument()
})

test('пустой день: в списке — «＋ Новая запись» и «Открыть завтра»; завтра в панели — «Первый приём», нажать — карточка', async () => {
  screenOf(true)
  backend({ empty: true })
  renderApp()
  const open = await screen.findByRole('button', { name: 'Открыть завтра ›' })
  // Шапка и пустой день — две «Новые записи»; залитая (главная) — одна, в шапке
  expect(screen.getAllByRole('button', { name: '＋ Новая запись' })).toHaveLength(2)
  expect(document.querySelectorAll('.btn.primary')).toHaveLength(1)
  await userEvent.click(open)
  expect(await screen.findByRole('heading', { name: new RegExp(dayTitle(addDays(todayIn(), 1))) })).toBeInTheDocument()
  const aside = await screen.findByRole('complementary', { name: 'Этот день' })
  expect(within(aside).getByRole('heading', { name: 'Первый приём' })).toBeInTheDocument()
  await userEvent.click(await within(aside).findByRole('button', { name: /Айжан Тестова/ }))
  expect(await screen.findByRole('heading', { name: /11:00–11:30/ })).toBeInTheDocument()
})

test('месяц в панели: нажать на день — он открывается в списке', async () => {
  screenOf(true)
  backend()
  renderApp()
  const aside = await screen.findByRole('complementary', { name: 'Сегодня' })
  const today = todayIn()
  const target = `${today.slice(0, 8)}${today.endsWith('-15') ? '16' : '15'}`
  const day = [...aside.querySelectorAll<HTMLButtonElement>('.doc-cal-day:not(.other)')].find((b) => b.querySelector('.doc-cal-num')?.textContent === String(Number(target.slice(8))))!
  await userEvent.click(day)
  expect(await screen.findByRole('heading', { name: new RegExp(dayTitle(target)) })).toBeInTheDocument()
})

test('ноутбук уже 1280px — панели нет, «Требует внимания» строкой над списком, как было; «Все врачи» — тоже без панели', async () => {
  screenOf(false)
  backend()
  const { unmount } = renderApp()
  expect(await screen.findByRole('button', { name: /1 заявка/ })).toBeInTheDocument()
  expect(screen.queryByRole('complementary', { name: 'Сегодня' })).not.toBeInTheDocument()
  expect(document.querySelector('.schedule.list-one')).not.toBeNull()
  unmount()

  screenOf(true)
  localStorage.setItem('crm.schedule.view.v2', 'all')
  renderApp()
  expect(await screen.findByRole('button', { name: /1 заявка/ })).toBeInTheDocument()
  expect(screen.queryByRole('complementary', { name: 'Сегодня' })).not.toBeInTheDocument()
  expect(document.querySelector('.schedule.list-one')).toBeNull()
})
