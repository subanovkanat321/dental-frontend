import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp, medTab, openMedicalTab } from '../test/fixtures'
import { server } from '../test/server'

type Step = Schemas['TreatmentStepView']

/**
 * Печать плана (шаг 4А): зубная формула обеих челюстей с состоянием и зубами в плане, «По этапам / По зубам», врач и
 * срок этапа, «С ценами» и «📤 Пациенту» — ссылка на план в WhatsApp. Пациент вымышленный.
 */
const PLAN: Step[] = [
  { id: 1, tooth: 46, title: 'Имплантация', priceSom: 40000, stage: 1, doctorName: 'Дастан Т.', dueOn: '2026-01-10', overdue: true },
  { id: 2, tooth: 36, title: 'Пломба', priceSom: 4000, stage: 1 },
  { id: 3, tooth: 46, title: 'Коронка', priceSom: 15000, stage: 2 },
  { id: 4, title: 'Профчистка', priceSom: 2500, stage: 2, doneAt: '2026-10-20T05:00:00Z' },
]

function backend() {
  const calls: unknown[] = []
  const patient = { id: 2, fullName: 'Айгуль Т.', phone: '996700333444', telegram: false }
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments', () => HttpResponse.json([])),
    http.get('*/api/patients/recent', () => HttpResponse.json([patient])),
    http.get('*/api/appointments/by-patient/2', () => HttpResponse.json({ patient, done: 1, noShow: 0, cancelled: 0, upcoming: [], past: [] })),
    http.get('*/api/appointments/debts', () => HttpResponse.json([])),
    http.get('*/api/patients/2/teeth', () => HttpResponse.json([
      { number: 36, state: 'CARIES' }, { number: 46, state: 'MISSING' }, { number: 16, state: 'CROWN' },
    ] satisfies Schemas['ToothView'][])),
    http.get('*/api/patients/2/files', () => HttpResponse.json([])),
    http.get('*/api/patients/2/plan', () => HttpResponse.json(PLAN)),
    http.get('*/api/service-types', () => HttpResponse.json([])),
    http.get('*/api/patients/2/plan/offers', () => HttpResponse.json([])),
    http.post('*/api/patients/2/plan/offers', async ({ request }) => {
      const body = await request.json() as Schemas['PlanOffersSendRequest']
      calls.push(body)
      return HttpResponse.json({
        offer: { id: 5, sentAt: new Date().toISOString(), channel: 'WHATSAPP', totalSom: 59000, validUntil: '2026-12-20', active: true },
        text: '🦷 Ваш план лечения\n\nОткрыть план и согласиться: https://tish.example/plan#x', url: 'https://tish.example/plan#x',
      } satisfies Schemas['PlanOffersSent'])
    }),
  )
  return calls
}

beforeEach(() => {
  vi.spyOn(window, 'print').mockImplementation(() => {})
  vi.spyOn(window, 'open').mockImplementation(() => null)
})
afterEach(() => {
  vi.restoreAllMocks()
  window.location.hash = ''
})

async function openPrint() {
  window.location.hash = '/patients'
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Айгуль Т.' }))
  await openMedicalTab()
  await screen.findByRole('heading', { name: 'Медкарта · Айгуль Т.' })
  await medTab('План лечения')
  await userEvent.click(await screen.findByRole('button', { name: 'Печать: план лечения' }))
  return screen.findByRole('dialog', { name: 'Печать: План лечения' })
}

test('лист плана: формула обеих челюстей с состояниями и зубами в плане, врач и срок, по этапам и по зубам', async () => {
  backend()
  const sheet = await openPrint()
  const chart = await within(sheet).findByRole('region', { name: 'Зубная формула' })
  expect(within(chart).getByRole('group', { name: 'Верхняя челюсть' })).toBeInTheDocument()
  expect(within(chart).getByRole('group', { name: 'Нижняя челюсть' })).toBeInTheDocument()
  expect(within(chart).getByLabelText('36 · Кариес · в плане')).toBeInTheDocument()
  expect(within(chart).getByLabelText('46 · Удалён · в плане')).toBeInTheDocument()
  expect(within(chart).getByLabelText('16 · Коронка')).toBeInTheDocument()
  expect(chart).toHaveTextContent('в плане лечения')

  const table = within(sheet).getByRole('table', { name: 'Этапы плана' })
  expect(within(table).getAllByRole('row')[0]).toHaveTextContent('Врач, срок')
  expect(table).toHaveTextContent(/Имплантация\s*Дастан Т\. · до 10 янв · просрочен/)
  expect(table).toHaveTextContent('Этап 2')

  await userEvent.click(within(sheet).getByRole('button', { name: 'По зубам' }))
  const groups = within(table).getAllByRole('rowheader').map((h) => h.textContent)
  expect(groups).toEqual(['Зуб 36', 'Зуб 46', 'Вся полость рта'])
  expect(table).toHaveTextContent(/Итого по зубу 46\s*55[\s ]000 сом/)
})

test('«С ценами» снять — экземпляр пациенту без цен; «📤 Пациенту» — ссылка на план в WhatsApp', async () => {
  const calls = backend()
  const sheet = await openPrint()
  expect(sheet).toHaveTextContent(/Итого: 61[\s ]500 сом/)
  await userEvent.click(within(sheet).getByRole('checkbox', { name: 'С ценами' }))
  expect(within(within(sheet).getByRole('table', { name: 'Этапы плана' })).getAllByRole('row')[0]).not.toHaveTextContent('Цена')
  expect(sheet).not.toHaveTextContent('Итого:')

  await userEvent.click(within(sheet).getByRole('button', { name: '📤 Пациенту' }))
  const send = await screen.findByRole('dialog', { name: 'Отправить план пациенту' })
  expect(within(send).queryByRole('button', { name: 'В Telegram-бот' })).not.toBeInTheDocument()
  await userEvent.click(within(send).getByRole('button', { name: 'В WhatsApp' }))
  expect(await within(send).findByRole('status')).toHaveTextContent('Открыли WhatsApp')
  expect(calls).toEqual([{ channel: 'WHATSAPP' }])
  expect(window.open).toHaveBeenCalledWith(expect.stringContaining(encodeURIComponent('https://tish.example/plan#x')), '_blank', 'noopener')
})
