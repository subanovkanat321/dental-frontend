import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import { addDays, slotInstant, todayIn } from '../lib/time'
import { appointment, me, renderApp } from '../test/fixtures'
import { server } from '../test/server'

/** Широкий экран компьютера: min-width-запросы совпадают, телефонные (max-width) — нет. */
beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('min-width'), media: query, addEventListener() {}, removeEventListener() {}, onchange: null,
    addListener() {}, removeListener() {}, dispatchEvent: () => false,
  }))
})
afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

const tomorrow = addDays(todayIn(), 1)

function backend() {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments', ({ request }) => {
      const url = new URL(request.url)
      const doctorId = Number(url.searchParams.get('doctorId'))
      if (url.searchParams.get('date') !== tomorrow || doctorId !== 1) return HttpResponse.json([])
      return HttpResponse.json([appointment(10, 1, '10:00', 'Бакыт М.', { startAt: slotInstant(tomorrow, 600), endAt: slotInstant(tomorrow, 630), status: 'REQUESTED' })])
    }),
    http.get('*/api/slots', ({ request }) => {
      const url = new URL(request.url)
      const date = url.searchParams.get('date')!
      const doctorId = Number(url.searchParams.get('doctorId'))
      return HttpResponse.json({
        workingDay: true, workStart: '09:00:00', workEnd: '18:00:00', breaks: [],
        free: doctorId === 1 ? [{ start: slotInstant(date, 13 * 60), end: slotInstant(date, 18 * 60) }] : [],
      })
    }),
  )
}

test('компьютер: свободное окно в колонке врача — «Свободно 13:00–18:00», нажать — новая запись на 13:00', async () => {
  backend()
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Следующий день' }))
  const column = await screen.findByRole('group', { name: 'Айгерим Садыкова' })
  const free = await within(column).findByRole('button', { name: 'Свободно с 13:00 до 18:00, записать' })
  expect(free).toHaveTextContent('Свободно 13:00–18:00＋ записать')
  await userEvent.click(free)
  expect(await screen.findByRole('complementary', { name: 'Новая запись' })).toBeInTheDocument()
})

test('компьютер: сводка дня справа — первый приём, заявки, свободное время врачей', async () => {
  backend()
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Следующий день' }))
  const summary = await screen.findByRole('complementary', { name: 'Сводка дня' })
  expect(await within(summary).findByRole('button', { name: /10:00–10:30\s*Бакыт М\./ })).toBeInTheDocument()
  // Ряд «Требует внимания» — здесь столбиком, над сеткой его нет
  const attention = within(summary).getByRole('group', { name: 'Требует внимания' })
  expect(within(attention).getByRole('button', { name: /1 заявка из бота/ })).toBeInTheDocument()
  expect(screen.getAllByRole('group', { name: 'Требует внимания' })).toHaveLength(1)
  expect(within(summary).getByText('5 ч свободно')).toBeInTheDocument()
  await userEvent.click(within(summary).getByRole('button', { name: 'Записать к врачу Айгерим Садыкова на 13:00' }))
  // Карточка «Новая запись» встаёт на место сводки
  expect(await screen.findByRole('complementary', { name: 'Новая запись' })).toBeInTheDocument()
  expect(screen.queryByRole('complementary', { name: 'Сводка дня' })).not.toBeInTheDocument()
})

test('компьютер: «×» в сводке скрывает её, «Сводка дня» в шапке возвращает', async () => {
  localStorage.removeItem('crm.daySummary')
  backend()
  renderApp()
  const summary = await screen.findByRole('complementary', { name: 'Сводка дня' })
  await userEvent.click(within(summary).getByRole('button', { name: 'Скрыть сводку' }))
  expect(screen.queryByRole('complementary', { name: 'Сводка дня' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Сводка дня' }))
  expect(await screen.findByRole('complementary', { name: 'Сводка дня' })).toBeInTheDocument()
  localStorage.removeItem('crm.daySummary')
})

test('компьютер: часы врача в шапке колонки, значки ⭐ 💬 🧾 на карточке и легенда', async () => {
  const today = todayIn()
  // Пациенты вымышленные
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments', ({ request }) => {
      const doctorId = Number(new URL(request.url).searchParams.get('doctorId'))
      if (doctorId !== 1) return HttpResponse.json([])
      return HttpResponse.json([
        appointment(11, 1, '10:00', 'Айбек Т.', { startAt: slotInstant(today, 600), endAt: slotInstant(today, 660), firstVisit: true, comment: 'Болит справа' }),
        appointment(12, 1, '12:00', 'Мээрим П.', { startAt: slotInstant(today, 720), endAt: slotInstant(today, 780), status: 'DONE', chargeSom: 5000, paidSom: 2000, paymentMethod: 'CASH', debtSom: 3000 }),
      ])
    }),
    http.get('*/api/slots', () => HttpResponse.json({ workingDay: true, workStart: '09:00:00', workEnd: '18:00:00', breaks: [], free: [] })),
  )
  renderApp()
  const first = await screen.findByRole('button', { name: /^10:00–11:00, Айбек Т\./ })
  // Подписи чипов в широком блоке («⭐ Первый визит», в среднем — «⭐ Новый») рисует CSS из data-атрибутов
  expect(within(first).getByRole('img', { name: 'Первый визит' })).toHaveAttribute('data-short', 'Новый')
  expect(within(first).getByRole('img', { name: 'Первый визит' })).toHaveAttribute('data-long', 'Первый визит')
  expect(within(first).getByRole('img', { name: 'Комментарий: Болит справа' })).toHaveAttribute('data-long', 'Комментарий')
  // Часовой блок: комментарий в DOM есть, но показывается только в широком блоке (в одну строку с услугой)
  expect(within(first).getByText('Болит справа')).toHaveClass('wide-only')
  const debt = screen.getByRole('button', { name: /^12:00–13:00, Мээрим П\./ })
  expect(within(debt).getByRole('img', { name: /Долг 3\s000 сом/ })).toHaveAttribute('data-long', expect.stringMatching(/^Долг 3\s000 сом$/))
  expect(within(debt).queryByRole('img', { name: 'Первый визит' })).not.toBeInTheDocument()
  expect(screen.getAllByText('09:00–18:00').length).toBeGreaterThan(0)
  expect(screen.getByText(/⭐ первый визит · 💬 комментарий · 🧾 долг/)).toBeInTheDocument()
})
