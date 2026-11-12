import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'

const owner = { ...me, owner: true, platform: true }
const clinic = {
  id: 2, name: 'Улыбка Тест', code: 'c2', doctors: 2, staff: 1, patients: 30, appointments: 40, health: 'OK', billing: { state: 'FREE' }, bookedWeek: 0, selfBooked30: 0, noShow30: 0, done30: 0, unmarked: 0, hidden: false, listed: true, settingUp: false, demo: false
} satisfies Schemas['PlatformServiceClinicRow']

beforeEach(() => {
  window.location.hash = '/platform'
  server.use(
    http.get('*/web/config', () => HttpResponse.json({ botUsername: 'tish_test_bot' })),
    http.get('*/api/patient/me', () => HttpResponse.json(owner)),
    http.get('*/api/platform/clinics', () => HttpResponse.json([clinic])),
    http.get('*/api/platform/applications', () => HttpResponse.json([])),
    http.get('*/api/platform/agreements/statuses', () => HttpResponse.json({})),
    http.get('*/api/platform/pay-requests', () => HttpResponse.json([])),
    http.get('*/api/platform/clinics/:id/agreement', () => HttpResponse.json({ scans: [] })),
    http.get('*/api/platform/clinics/:id/plan', () => HttpResponse.json({
      billing: { state: 'FREE' }, doctors: 2, tariff: { name: 'Клиника', monthSom: 3490, yearSom: 34900 }, payments: [],
    } satisfies Schemas['ClinicPaymentsPlan'])),
  )
})
afterEach(() => {
  window.location.hash = ''
})

async function openStock() {
  const user = userEvent.setup()
  renderApp()
  await user.click(await screen.findByRole('button', { name: 'Улыбка Тест' }))
  const panel = await screen.findByRole('complementary', { name: 'Клиника на платформе' })
  const box = within(panel).getByRole('region', { name: 'Склад клиники' })
  await user.click(within(box).getByRole('button', { name: 'Очистить склад…' }))
  return { user, box }
}

test('владелец: очистить склад — сначала сколько удалится, кнопка активна только с названием клиники', async () => {
  let stock: Schemas['StockCleanupCounts'] = { supplies: 12, movements: 40, serviceNorms: 7 }
  let sent: unknown = null
  server.use(
    http.get('*/api/platform/clinics/2/stock', () => HttpResponse.json(stock)),
    http.delete('*/api/platform/clinics/2/stock', async ({ request }) => {
      sent = await request.json()
      const deleted = stock
      stock = { supplies: 0, movements: 0, serviceNorms: 0 }
      return HttpResponse.json(deleted satisfies Schemas['StockCleanupCounts'])
    }),
  )
  const { user, box } = await openStock()

  const dialog = await within(box).findByRole('group', { name: 'Подтверждение очистки склада' })
  expect(within(dialog).getByLabelText('Будет удалено')).toHaveTextContent('материалов — 12, движений — 40, норм списания в услугах — 7')
  expect(dialog).toHaveTextContent('Удалятся все материалы, остатки, история движений и нормы списания в услугах. Отменить нельзя.')
  const button = within(dialog).getByRole('button', { name: 'Очистить склад' })
  expect(button).toBeDisabled()

  const input = within(dialog).getByRole('textbox', { name: 'Впишите название: Улыбка Тест' })
  await user.type(input, 'Улыбка')
  expect(button).toBeDisabled()
  await user.clear(input)
  await user.type(input, ' улыбка тест ')
  expect(button).toBeEnabled()
  await user.click(button)

  expect(await within(box).findByRole('status')).toHaveTextContent('Склад очищен: удалено материалов 12')
  expect(sent).toEqual({ confirm: ' улыбка тест ' })
  expect(within(box).queryByRole('group', { name: 'Подтверждение очистки склада' })).not.toBeInTheDocument()
})

test('ошибка сервера — под полем; пустой склад — удалять нечего', async () => {
  server.use(
    http.get('*/api/platform/clinics/2/stock', () => HttpResponse.json({ supplies: 3, movements: 0, serviceNorms: 0 } satisfies Schemas['StockCleanupCounts'])),
    http.delete('*/api/platform/clinics/2/stock', () => HttpResponse.json({
      status: 422, title: 'Unprocessable Content', detail: 'Проверьте поля', errors: [{ field: 'confirm', message: 'Впишите название клиники точно: Улыбка Тест' }],
    }, { status: 422, headers: { 'Content-Type': 'application/problem+json' } })),
  )
  const { user, box } = await openStock()
  const dialog = await within(box).findByRole('group', { name: 'Подтверждение очистки склада' })
  await user.type(within(dialog).getByRole('textbox'), 'Улыбка Тест')
  await user.click(within(dialog).getByRole('button', { name: 'Очистить склад' }))
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('Впишите название клиники точно: Улыбка Тест')

  await user.click(within(dialog).getByRole('button', { name: 'Отмена' }))
  server.use(http.get('*/api/platform/clinics/2/stock', () => HttpResponse.json({ supplies: 0, movements: 0, serviceNorms: 0 } satisfies Schemas['StockCleanupCounts'])))
  await user.click(within(box).getByRole('button', { name: 'Очистить склад…' }))
  expect(await within(box).findByText('На складе пусто — удалять нечего.')).toBeInTheDocument()
})
