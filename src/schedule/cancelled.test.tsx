import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import { addDays, slotInstant, timeOf, todayIn } from '../lib/time'
import { appointment, me, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { cancelledText, cancelledWhen } from './cancelled'

/**
 * «Было 4 пациента, вижу 2»: отменённые не пропадают молча — внизу дня «Отменено: N ›», раскрыть — кто и
 * когда отменил, нажать — карточка со строкой «Отменён: …» и «Восстановить».
 */
afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

function screenWidth(phone: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes(phone ? 'max-width' : 'min-width'), media: query, addEventListener() {}, removeEventListener() {}, onchange: null,
    addListener() {}, removeListener() {}, dispatchEvent: () => false,
  }))
}

const today = todayIn()
const cancelledNow = new Date(Date.now() - 5 * 60_000).toISOString()
const cancelledYesterday = slotInstant(addDays(today, -1), 18 * 60 + 5)

const byPatient = appointment(12, 1, '11:00', 'Асель Т.', { status: 'CANCELLED', cancelledBy: 'пациент в боте', cancelledAt: cancelledNow })
const byStaff = appointment(13, 1, '15:00', 'Нурлан К.', { status: 'CANCELLED', cancelledBy: 'Айгерим Садыкова', cancelledAt: cancelledYesterday })

function backend(list: ReturnType<typeof appointment>[]) {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments', ({ request }) => {
      const url = new URL(request.url)
      return HttpResponse.json(url.searchParams.get('date') === today && url.searchParams.get('doctorId') === '1' ? list : [])
    }),
    http.get('*/api/appointments/counts', () => HttpResponse.json([])),
    http.get('*/api/slots', () => HttpResponse.json({ workingDay: true, workStart: '09:00:00', workEnd: '18:00:00', breaks: [], free: [] })),
  )
}

test('кто и когда отменил — словами', () => {
  expect(cancelledText(byPatient)).toBe(`отменил пациент в боте · ${timeOf(cancelledNow)}`)
  expect(cancelledText(byStaff)).toBe('отменил(а) Айгерим Садыкова · вчера 18:05')
  expect(cancelledText(appointment(14, 1, '16:00', 'Старая', { status: 'CANCELLED' }))).toBe('отменена')
  expect(cancelledWhen(cancelledNow, { sayToday: true })).toBe(`сегодня ${timeOf(cancelledNow)}`)
})

test('телефон: внизу дня «Отменено: 2 ›» — раскрыть, кто отменил; нажать — карточка «Отменён: …» и «Восстановить»', async () => {
  screenWidth(true)
  backend([appointment(10, 1, '10:00', 'Бакыт М.'), byPatient, byStaff])
  localStorage.setItem('crm.schedule.view', '1')
  renderApp()
  expect(await screen.findByRole('button', { name: /10:00–10:30, Бакыт М\./ })).toBeInTheDocument()
  // Отменённые — не строками дня
  expect(screen.queryByRole('button', { name: /11:00–11:30, Асель Т\./ })).not.toBeInTheDocument()
  const toggle = screen.getByRole('button', { name: /Отменено: 2/ })
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByRole('list', { name: 'Отменённые записи' })).not.toBeInTheDocument()

  await userEvent.click(toggle)
  expect(toggle).toHaveAttribute('aria-expanded', 'true')
  const list = screen.getByRole('list', { name: 'Отменённые записи' })
  const rows = within(list).getAllByRole('button')
  expect(rows.map((r) => r.textContent)).toEqual([
    `11:00Асель Т.отменил пациент в боте · ${timeOf(cancelledNow)}`,
    '15:00Нурлан К.отменил(а) Айгерим Садыкова · вчера 18:05',
  ])

  server.use(http.get('*/api/appointments/12', () => HttpResponse.json(byPatient)))
  await userEvent.click(rows[0]!)
  const panel = await screen.findByRole('complementary', { name: 'Карточка приёма' })
  expect(within(panel).getByText(`Отменён: пациент в боте, сегодня ${timeOf(cancelledNow)}`)).toBeInTheDocument()
  expect(within(panel).getByRole('button', { name: 'Восстановить' })).toBeInTheDocument()
})

test('телефон: в дне только отменённые — «записей нет», но «Отменено: 1» видно', async () => {
  screenWidth(true)
  backend([byPatient])
  localStorage.setItem('crm.schedule.view', '1')
  renderApp()
  expect(await screen.findByText('На этот день записей нет')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Отменено: 1/ })).toBeInTheDocument()
})

test('компьютер: под сеткой дня «Отменено: 1 ›», раскрыть — кто отменил', async () => {
  screenWidth(false)
  backend([appointment(10, 1, '10:00', 'Бакыт М.'), byStaff])
  renderApp()
  const column = await screen.findByRole('group', { name: 'Айгерим Садыкова' })
  expect(await within(column).findByRole('button', { name: /10:00–10:30, Бакыт М\./ })).toBeInTheDocument()
  expect(within(column).queryByRole('button', { name: /Нурлан К\./ })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: /Отменено: 1/ }))
  expect(within(screen.getByRole('list', { name: 'Отменённые записи' })).getByRole('button'))
    .toHaveTextContent('15:00Нурлан К. · Айгерим Садыковаотменил(а) Айгерим Садыкова · вчера 18:05') // «Все врачи» — с именем врача
})

test('карточка старой отмены (до записи «кто») — без строки «Отменён:», «Восстановить» есть', async () => {
  screenWidth(false)
  const old = appointment(14, 1, '16:00', 'Старая О.', { status: 'CANCELLED' })
  backend([old])
  server.use(http.get('*/api/appointments/14', () => HttpResponse.json(old)))
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: /Отменено: 1/ }))
  await userEvent.click(within(screen.getByRole('list', { name: 'Отменённые записи' })).getByRole('button'))
  const panel = await screen.findByRole('complementary', { name: 'Карточка приёма' })
  expect(within(panel).queryByText(/^Отменён:/)).not.toBeInTheDocument()
  expect(within(panel).getByRole('button', { name: 'Восстановить' })).toBeInTheDocument()
})
