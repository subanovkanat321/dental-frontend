import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp, medTab, openMedicalTab } from '../test/fixtures'
import { server } from '../test/server'
import { waitForSlow } from '../test/wait'

type Me = Schemas['BookingViewsMe']

const PLAN = [
  { id: 1, tooth: 36, title: 'Лечение каналов', priceSom: 8000, stage: 1 },
  { id: 2, title: 'Профчистка', priceSom: 2500, doneAt: '2026-10-20T05:00:00Z', stage: 1 },
] satisfies Schemas['TreatmentStepView'][]

/** Вымышленный пациент с планом лечения; у ассистента сервер присылает план без цен. */
function backend(who: Me, telegram: boolean) {
  const sent: string[] = []
  const plan = who.assistantOf?.length ? PLAN.map((s) => ({ ...s, priceSom: undefined })) : PLAN
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(who)),
    http.get('*/api/appointments', () => HttpResponse.json([])),
    http.get('*/api/patients/recent', () => HttpResponse.json([{ id: 2, fullName: 'Айгуль Т.', phone: '996700333444' }])),
    http.get('*/api/appointments/by-patient/2', () => HttpResponse.json({
      patient: { id: 2, fullName: 'Айгуль Т.', phone: '996700333444' }, done: 1, noShow: 0, cancelled: 0, upcoming: [], past: [],
    })),
    http.get('*/api/appointments/debts', () => HttpResponse.json([])),
    http.get('*/api/patients/2/teeth', () => HttpResponse.json([])),
    http.get('*/api/patients/2/files', () => HttpResponse.json([])),
    http.get('*/api/patients/2/plan', () => HttpResponse.json(plan)),
    http.get('*/api/patients/2/plan/message', () => HttpResponse.json(
      { text: '🦷 План лечения\n\n1. Зуб 36 — Лечение каналов', telegram } satisfies Schemas['PatientMessage'])),
    http.post('*/api/patients/2/plan/send', () => {
      sent.push('send')
      return new HttpResponse(null, { status: 204 })
    }),
  )
  return sent
}

async function openMedical() {
  window.location.hash = '/patients'
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Айгуль Т.' }))
  await openMedicalTab()
  await screen.findByRole('heading', { name: 'Медкарта · Айгуль Т.' })
  await medTab('План лечения')
}

beforeEach(() => {
  vi.spyOn(window, 'print').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  window.location.hash = ''
})

test('план лечения на печать: пациент, врач, этапы с ценой и статусом, итог, подписи, примечание', async () => {
  backend(me, true)
  await openMedical()
  await userEvent.click(await screen.findByRole('button', { name: 'Печать: план лечения' }))
  const sheet = await screen.findByRole('dialog', { name: 'Печать: План лечения' })
  expect(sheet).toHaveTextContent('Айгуль Т.')
  expect(sheet).toHaveTextContent('Айгерим Садыкова')
  const rows = within(within(sheet).getByRole('table', { name: 'Этапы плана' })).getAllByRole('row')
  expect(rows[0]).toHaveTextContent('Цена')
  expect(rows[1]).toHaveTextContent(/36Лечение каналов8\s000 сомв плане/)
  expect(rows[2]).toHaveTextContent(/сделано 20\.10\.2026/)
  expect(sheet).toHaveTextContent(/Итого: 10\s500 сом · осталось: 8\s000 сом/)
  expect(sheet).toHaveTextContent('Врач ____')
  expect(sheet).toHaveTextContent('Пациент ____')
  expect(sheet).toHaveTextContent('План может меняться по результатам лечения.')
  await userEvent.type(within(sheet).getByLabelText('Примечание на листе'), 'Следующий визит через неделю')
  expect(sheet).toHaveTextContent('Примечание: Следующий визит через неделю')
  await waitForSlow(() => expect(window.print).toHaveBeenCalled())
})

test('«🖨 План лечения»: этапы с итогом за этап, выполнено и осталось, долг за лечение, подписи с датой', async () => {
  backend(me, false)
  server.use(
    http.get('*/api/appointments/by-patient/2', () => HttpResponse.json({
      patient: { id: 2, fullName: 'Айгуль Т.', phone: '996700333444', birthDate: '1990-03-14' }, done: 1, noShow: 0, cancelled: 0, upcoming: [], past: [],
    })),
    http.get('*/api/patients/2/plan', () => HttpResponse.json([
      { id: 1, tooth: 36, title: 'Лечение каналов', priceSom: 8000, stage: 1 },
      { id: 2, title: 'Профчистка', priceSom: 2500, stage: 1, doneAt: '2026-10-20T05:00:00Z' },
      { id: 3, tooth: 36, title: 'Коронка', priceSom: 15000, stage: 2 },
    ] satisfies Schemas['TreatmentStepView'][])),
    http.get('*/api/appointments/debts', ({ request }) => HttpResponse.json(new URL(request.url).searchParams.get('patientId') === '2'
      ? [{ appointmentId: 7, patientId: 2, chargeSom: 2500, paidSom: 1000, debtSom: 1500, doctorId: 0 }] satisfies Schemas['PaymentQueryDebt'][] : [])),
  )
  await openMedical()
  await userEvent.click(await screen.findByRole('button', { name: 'Печать: план лечения' }))
  const sheet = await screen.findByRole('dialog', { name: 'Печать: План лечения' })
  expect(sheet).toHaveTextContent('Дата рождения14.03.1990')
  const table = within(sheet).getByRole('table', { name: 'Этапы плана' })
  expect(within(table).getByRole('rowheader', { name: 'Этап 1' })).toBeInTheDocument()
  expect(within(table).getByRole('rowheader', { name: 'Этап 2' })).toBeInTheDocument()
  expect(table).toHaveTextContent(/Итого за этап 110\s500 сом/)
  expect(table).toHaveTextContent(/336Коронка15\s000 сомв плане/)
  expect(sheet).toHaveTextContent(/Итого: 25\s500 сом · осталось: 23\s000 сом/)
  expect(sheet).toHaveTextContent(/Уже выполнено на 2\s500 сом/)
  expect(await within(sheet).findByText(/Осталось оплатить за проведённое лечение: 1\s500 сом/)).toBeInTheDocument()
  expect(sheet).toHaveTextContent('ознакомлен(а), согласен(на)')
  expect(sheet).toHaveTextContent('Дата «____»')
})

// Врач и админ отправляют план с ценами и «Согласен» (planOffer.test.tsx); у ассистента — прежний текст без цен
test('ассистент — «📤 Отправить пациенту» в Telegram', async () => {
  const sent = backend({ ...me, admin: false, doctorId: undefined, fullName: 'Асель', assistantOf: [1] }, true)
  await openMedical()
  await userEvent.click(await screen.findByRole('button', { name: 'Отправить пациенту в Telegram: план лечения' }))
  expect(await screen.findByText('Отправлено в Telegram')).toBeInTheDocument()
  expect(sent).toEqual(['send'])
})

test('ассистент печатает план без цен', async () => {
  backend({ ...me, admin: false, doctorId: undefined, fullName: 'Асель', assistantOf: [1] }, false)
  await openMedical()
  await userEvent.click(await screen.findByRole('button', { name: 'Печать: план лечения' }))
  const sheet = await screen.findByRole('dialog', { name: 'Печать: План лечения' })
  expect(within(sheet).getAllByRole('row')[0]).not.toHaveTextContent('Цена')
  expect(sheet).not.toHaveTextContent('сом')
  expect(sheet).toHaveTextContent('Врач ________')
})

test('история визитов: «📋 Памятка и квитанция» у состоявшегося приёма', async () => {
  backend(me, false)
  const visit = { id: 9, doctorId: 1, startAt: '2026-10-20T04:00:00Z', endAt: '2026-10-20T04:30:00Z', status: 'DONE', version: 1,
    paidSom: 1500, serviceName: 'Профчистка', patient: { id: 2, fullName: 'Айгуль Т.', phone: '996700333444', telegram: false }, source: 'DOCTOR', debtSom: 0, firstVisit: false } satisfies Schemas['AppointmentView']
  server.use(
    http.get('*/api/appointments/by-patient/2', () => HttpResponse.json({
      patient: { id: 2, fullName: 'Айгуль Т.', phone: '996700333444' }, done: 1, noShow: 0, cancelled: 0, upcoming: [], past: [visit],
    })),
    http.get('*/api/appointments/9/care-memo', () => HttpResponse.json(
      { memoId: 4, title: 'После чистки', body: '• 2 часа не ешьте.', text: 'Памятка', telegram: false, ky: false } satisfies Schemas['CareMemosAppointmentMemo'])),
  )
  window.location.hash = '/patients'
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Айгуль Т.' }))
  const card = await screen.findByRole('complementary', { name: 'Карточка пациента' })
  await userEvent.click(within(card).getByRole('button', { name: '📋 Памятка и квитанция' }))
  expect(await within(card).findByText('После чистки')).toBeInTheDocument()
  expect(await within(card).findByText('🧾 Квитанция об оплате')).toBeInTheDocument()
  expect(within(card).getByRole('button', { name: 'Отправить пациенту в WhatsApp: памятка «После чистки»' })).toBeEnabled()
})
