import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { appointment, me, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { choose } from '../test/select'

type Code = Schemas['PromoCodesCode']
type Report = Schemas['PromoReportControllerPromoReport']

/** Вымышленные промокоды клиники. */
const CODES: Code[] = [
  { id: 1, code: 'ZUBY10', description: 'Instagram, ноябрь', discountPercent: 10, active: true, appointments: 4 },
  { id: 2, code: 'LETO', active: false, appointments: 0 },
]

const REPORT: Report = {
  money: true,
  rows: [
    { promoCodeId: 1, code: 'ZUBY10', description: 'Instagram, ноябрь', active: true, bookings: 4, visits: 3, newPatients: 2, revenueSom: 12500 },
    { promoCodeId: 2, code: 'LETO', active: false, bookings: 0, visits: 0, newPatients: 0, revenueSom: 0 },
  ],
}

afterEach(() => {
  window.location.hash = ''
})

test('«Промокоды»: отчёт по коду, новый промокод, правка и ссылки с кодом', async () => {
  window.location.hash = '/settings/promo'
  let list: Code[] = CODES.map((c) => ({ ...c }))
  let created: unknown = null
  let updated: unknown = null
  const periods: string[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json({ ...me, clinic: { ...me.clinic, code: 'abc123' } })),
    http.get('*/web/config', () => HttpResponse.json({ botUsername: 'tish_test_bot' })),
    http.get('*/api/promo-codes', () => HttpResponse.json(list)),
    http.get('*/api/appointments/promo-codes', ({ request }) => {
      const q = new URL(request.url).searchParams
      periods.push(`${q.get('from')}..${q.get('to')}`)
      return HttpResponse.json(REPORT)
    }),
    http.post('*/api/promo-codes', async ({ request }) => {
      created = await request.json()
      list = [{ id: 3, active: true, appointments: 0, ...(created as Schemas['PromoCodesRequest']) }, ...list]
      return HttpResponse.json(list, { status: 201 })
    }),
    http.put('*/api/promo-codes/:id', async ({ request }) => {
      updated = await request.json()
      list = list.map((c) => (c.id === 1 ? { ...c, ...(updated as Schemas['PromoCodesRequest']) } : c))
      return HttpResponse.json(list)
    }),
  )
  const user = userEvent.setup()
  renderApp()
  const table = await screen.findByRole('table', { name: 'Промокоды' })
  const zuby = within(table).getByRole('button', { name: '🎟 ZUBY10' }).closest('tr')!
  expect(zuby).toHaveTextContent('Instagram, ноябрь · −10%')
  expect(await within(zuby).findByText('12 500 сом', { normalizer: (s) => s.replace(/\s/g, ' ') })).toBeInTheDocument()
  expect(within(zuby).getAllByRole('cell').map((c) => c.textContent).slice(1, 4)).toEqual(['4', '3', '2'])
  expect(within(table).getByText('🎟 LETO').closest('tr')).toHaveTextContent('выключен')
  expect(within(table).getByRole('columnheader', { name: 'Оплачено' })).toBeInTheDocument()

  // Период отчёта — переключатель
  await user.click(screen.getByRole('button', { name: '90 дней' }))
  await vi.waitFor(() => expect(new Set(periods).size).toBe(2))

  await user.click(screen.getByRole('button', { name: '+ Промокод' }))
  const panel = await screen.findByRole('complementary', { name: 'Новый промокод' })
  await user.type(within(panel).getByRole('textbox', { name: 'Промокод' }), 'osen5')
  expect(within(panel).getByRole('textbox', { name: 'Промокод' })).toHaveValue('OSEN5')
  await user.type(within(panel).getByRole('textbox', { name: /Где опубликован/ }), 'Листовки')
  await user.type(within(panel).getByRole('spinbutton', { name: 'Скидка, %' }), '5')
  await user.click(within(panel).getByRole('button', { name: 'Добавить' }))
  expect(await within(table).findByRole('button', { name: '🎟 OSEN5' })).toBeInTheDocument()
  expect(created).toEqual({ code: 'OSEN5', description: 'Листовки', discountText: '', active: true, discountPercent: 5 })

  await user.click(within(table).getByRole('button', { name: '🎟 ZUBY10' }))
  const edit = await screen.findByRole('complementary', { name: 'Промокод' })
  // Использованный не удаляется — только выключается; ссылки с кодом — бот и страница клиники
  expect(within(edit).queryByRole('button', { name: 'Удалить промокод' })).toBeNull()
  const links = within(edit).getByRole('region', { name: 'Ссылки с промокодом' })
  expect(await within(links).findByRole('link', { name: 'https://t.me/tish_test_bot?start=c_abc123-ZUBY10' })).toBeInTheDocument()
  expect(within(links).getByRole('link', { name: /\/c\/abc123\?promo=ZUBY10$/ })).toBeInTheDocument()
  await user.click(within(edit).getByRole('checkbox', { name: /Принимать от пациентов/ }))
  await user.click(within(edit).getByRole('button', { name: 'Сохранить' }))
  expect(await within(edit).findByRole('status')).toHaveTextContent('Промокод сохранён')
  expect(updated).toMatchObject({ code: 'ZUBY10', active: false, discountPercent: 10 })
})

test('«Промокоды»: регистратура видит коды и числа людей, без оплат и без правки', async () => {
  window.location.hash = '/settings/promo'
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json({ ...me, admin: false, reception: true, doctorId: undefined })),
    http.get('*/api/promo-codes', () => HttpResponse.json(CODES)),
    http.get('*/api/appointments/promo-codes', () => HttpResponse.json({ money: false, rows: REPORT.rows!.map((r) => ({ ...r, revenueSom: undefined })) })),
  )
  renderApp()
  const table = await screen.findByRole('table', { name: 'Промокоды' })
  expect(within(table).getByText('🎟 ZUBY10')).toBeInTheDocument()
  expect(within(table).queryByRole('button')).toBeNull()
  expect(within(table).queryByRole('columnheader', { name: 'Оплачено' })).toBeNull()
  expect(screen.queryByRole('button', { name: '+ Промокод' })).toBeNull()
  expect(screen.getByText(/Промокоды заводят врачи и руководитель/)).toBeInTheDocument()
})

test('«Касса → Аналитика»: промокоды за период — записи, пришли, новые, оплачено', async () => {
  window.location.hash = '/cash'
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments/debts', () => HttpResponse.json([])),
    http.get('*/api/appointments/sources', () => HttpResponse.json({ newPatients: [], firstVisits: 0, repeatVisits: 0 })),
    http.get('*/api/appointments/stats', () => HttpResponse.json([])),
    http.get('*/api/appointments/promo-codes', () => HttpResponse.json(REPORT)),
  )
  const user = userEvent.setup()
  renderApp()
  await user.click(await screen.findByRole('tab', { name: 'Аналитика' }))
  const chart = await screen.findByRole('region', { name: 'Промокоды' })
  const table = await within(chart).findByRole('table', { name: 'Промокоды за период' })
  // Код без записей за период не показываем
  expect(within(table).queryByText('LETO')).toBeNull()
  const row = within(table).getByText('ZUBY10').closest('tr')!
  expect(within(row).getAllByRole('cell').map((c) => c.textContent?.replace(/\s/g, ' '))).toEqual(['ZUBY10 · Instagram, ноябрь', '4', '3', '2', '12 500 сом'])
})

test('карточка приёма: промокод, который пациент назвал по телефону', async () => {
  let a = appointment(10, 1, '15:00', 'Бакыт М.')
  let sent: unknown = null
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments', ({ request }) => HttpResponse.json(new URL(request.url).searchParams.get('doctorId') === '1' ? [a] : [])),
    http.get('*/api/promo-codes', () => HttpResponse.json(CODES)),
    http.put('*/api/appointments/:id/promo-code', async ({ request }) => {
      sent = await request.json()
      a = { ...a, promoCode: (sent as { promoCode: string }).promoCode || undefined }
      return HttpResponse.json(a)
    }),
  )
  const user = userEvent.setup()
  renderApp()
  await user.click(await screen.findByRole('button', { name: /Бакыт М\./ }))
  const panel = screen.getByRole('complementary', { name: 'Карточка приёма' })
  await user.click(within(panel).getByRole('button', { name: /^Ещё.*промокод/ }))
  await user.click(within(panel).getByRole('button', { name: '＋ Промокод' }))
  const form = within(panel).getByRole('form', { name: 'Промокод записи' })
  const field = within(form).getByLabelText('Промокод')
  // Выключенный код не предлагается
  await user.click(field)
  expect(screen.queryByRole('option', { name: /LETO/ })).toBeNull()
  await user.keyboard('{Escape}')
  await choose(field, 'ZUBY10')
  await user.click(within(form).getByRole('button', { name: 'Сохранить' }))
  expect(await within(panel).findByText('🎟 ZUBY10')).toBeInTheDocument()
  expect(sent).toEqual({ promoCode: 'ZUBY10' })
})
