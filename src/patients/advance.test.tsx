import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { appointment, me, openPay, renderApp } from '../test/fixtures'
import { server } from '../test/server'

type Me = Schemas['BookingViewsMe']
type Patient = Schemas['PatientView']
type Advance = Schemas['AdvancesView']

const reception: Me = { ...me, admin: false, reception: true, doctorId: undefined, fullName: 'Жылдыз' }

/** Вымышленные пациенты; аванс на сервере — как его считает Advances (остаток = внесено − возвращено − оплачено). */
function patientBackend(patient: Patient, who: Me, start: Advance) {
  let current = start
  const sent: { path: string; body: unknown }[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(who)),
    http.get('*/api/patients/recent', () => HttpResponse.json([patient])),
    http.get('*/api/appointments', () => HttpResponse.json([])),
    http.get('*/api/patients/:id/family', () => new HttpResponse(null, { status: 204 })),
    http.get('*/api/patient-tags', () => HttpResponse.json([])),
    http.get('*/api/appointments/by-patient/:id', () => HttpResponse.json({ patient, done: 0, noShow: 0, cancelled: 0, upcoming: [], past: [] })),
    http.get('*/api/patients/:id/advance', () => HttpResponse.json(current)),
    http.post('*/api/patients/:id/advance', async ({ request }) => {
      const body = (await request.json()) as { amountSom: number; method: string; comment?: string }
      sent.push({ path: 'in', body })
      current = { ...current, balanceSom: current.balanceSom + body.amountSom,
        entries: [{ at: '2026-11-20T06:00:00Z', kind: 'IN', deltaSom: body.amountSom, method: 'CASH', comment: body.comment, patientId: patient.id, by: 'Жылдыз' }, ...(current.entries ?? [])] }
      return HttpResponse.json(current)
    }),
    http.post('*/api/patients/:id/advance/refund', async ({ request }) => {
      const body = (await request.json()) as { amountSom: number; reason: string }
      sent.push({ path: 'refund', body })
      current = { ...current, balanceSom: current.balanceSom - body.amountSom }
      return HttpResponse.json(current)
    }),
  )
  return sent
}

async function openCard(name: string) {
  window.location.hash = '/patients'
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name }))
  return screen.findByRole('complementary', { name: 'Карточка пациента' })
}

const PATIENT: Patient = { id: 21, fullName: 'Вымышленная Айгуль', phone: '996700330021', telegram: false }

test('регистратура вносит аванс: остаток в шапке, форма «＋ Внести аванс», история', async () => {
  const sent = patientBackend(PATIENT, reception, { patientId: 21, balanceSom: 0, members: [], entries: [] })
  const card = await openCard('Вымышленная Айгуль')
  // Аванса нет — строки денег нет
  await within(card).findByRole('tab', { name: 'Деньги' })
  expect(within(card).queryByText(/аванс \d/)).not.toBeInTheDocument()
  await userEvent.click(within(card).getByRole('tab', { name: 'Деньги' }))
  await userEvent.click(await within(card).findByRole('button', { name: '＋ Внести аванс' }))
  const form = within(card).getByRole('form', { name: 'Внести аванс' })
  await userEvent.type(within(form).getByLabelText('Сумма аванса, сом'), '20000')
  await userEvent.click(within(form).getByRole('button', { name: 'Перевод' }))
  await userEvent.type(within(form).getByLabelText(/Комментарий/), 'На брекеты')
  await userEvent.click(within(form).getByRole('button', { name: /^Внести 20\s000 сом/ }))

  expect(await within(card).findByRole('heading', { name: /Аванс: 20\s000 сом/ })).toBeInTheDocument()
  expect(within(card).getByRole('list', { name: 'История аванса' })).toHaveTextContent(/Внесли наличными · На брекеты/)
  expect(await within(card).findByRole('button', { name: /аванс 20\s000 сом — открыть «Деньги»/ })).toBeInTheDocument()
  // Вернуть — только руководитель
  expect(within(card).queryByRole('button', { name: 'Вернуть аванс' })).not.toBeInTheDocument()
  expect(sent).toEqual([{ path: 'in', body: { amountSom: 20000, method: 'TRANSFER', comment: 'На брекеты' } }])
})

test('семья: в шапке «аванс семьи», руководитель возвращает аванс только с причиной', async () => {
  const sent = patientBackend(PATIENT, me, {
    patientId: 21, balanceSom: 15000, familyId: 4, familyName: 'Семья Вымышленных', members: ['Тимур Вымышленный'],
    entries: [
      { at: '2026-11-20T07:00:00Z', kind: 'SPEND', deltaSom: -5000, patientId: 22, patient: 'Тимур В.', appointmentStartAt: '2026-11-20T04:00:00Z' },
      { at: '2026-11-19T07:00:00Z', kind: 'IN', deltaSom: 20000, method: 'CASH', patientId: 21, patient: 'Айгуль В.', by: 'Жылдыз' },
    ],
  })
  const card = await openCard('Вымышленная Айгуль')
  const line = await within(card).findByRole('button', { name: /аванс семьи 15\s000 сом — открыть «Деньги»/ })
  await userEvent.click(line)
  expect(within(card).getByRole('tab', { name: 'Деньги' })).toHaveAttribute('aria-selected', 'true')
  expect(within(card).getByText(/Общий счёт «Семья Вымышленных» — ещё Тимур Вымышленный/)).toBeInTheDocument()
  expect(within(card).getByRole('list', { name: 'История аванса' })).toHaveTextContent(/Оплата приёма 20\.11 · Тимур В\./)

  await userEvent.click(within(card).getByRole('button', { name: 'Вернуть аванс' }))
  const form = within(card).getByRole('form', { name: 'Вернуть аванс' })
  const amount = within(form).getByLabelText(/Сколько вернуть/)
  expect(amount).toHaveValue('15000')
  await userEvent.clear(amount)
  await userEvent.type(amount, '5000')
  // Без причины кнопка не нажимается
  expect(within(form).getByRole('button', { name: /^Вернуть 5\s000 сом/ })).toBeDisabled()
  await userEvent.type(within(form).getByLabelText('Причина возврата'), 'Переехали')
  await userEvent.click(within(form).getByRole('button', { name: /^Вернуть 5\s000 сом/ }))
  expect(await within(card).findByRole('heading', { name: /Аванс семьи: 10\s000 сом/ })).toBeInTheDocument()
  expect(sent).toEqual([{ path: 'refund', body: { amountSom: 5000, method: 'CASH', reason: 'Переехали' } }])
})

test('ассистент: аванс не запрашивается и не виден', async () => {
  let asked = 0
  patientBackend(PATIENT, { ...me, admin: false, doctorId: undefined, assistantOf: [1] }, { patientId: 21, balanceSom: 9000, members: [], entries: [] })
  server.use(http.get('*/api/patients/:id/advance', () => {
    asked++
    return HttpResponse.json({ status: 403 }, { status: 403 })
  }))
  const card = await openCard('Вымышленная Айгуль')
  await within(card).findByRole('tab', { name: 'Визиты' })
  expect(within(card).queryByText(/аванс/)).not.toBeInTheDocument()
  expect(asked).toBe(0)
})

/** Приём с оплатой на сервере: способ и части запоминаются, аванс уменьшается на оплату «С аванса». */
function payBackend(balance: number) {
  let current = appointment(10, 1, '10:00', 'Бакыт М.', { status: 'DONE', servicePriceSom: 5000, version: 1 })
  const sent: Record<string, unknown>[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(reception)),
    http.get('*/api/appointments', ({ request }) => HttpResponse.json(
      Number(new URL(request.url).searchParams.get('doctorId')) === current.doctorId ? [current] : [])),
    http.get('*/api/appointments/:id/payments', () => HttpResponse.json([])),
    http.get('*/api/service-types', () => HttpResponse.json([])),
    http.get('*/api/patients/:id/advance', () => HttpResponse.json({ patientId: 10, balanceSom: balance, members: [], entries: [] } satisfies Advance)),
    http.post('*/api/appointments/:id/payment', async ({ request }) => {
      const b = (await request.json()) as Record<string, unknown>
      sent.push(b)
      current = { ...current, paidSom: b.amountSom as number, paymentMethod: b.method as Schemas['AppointmentView']['paymentMethod'] }
      return HttpResponse.json(current)
    }),
  )
  return sent
}

afterEach(() => {
  window.location.hash = ''
})

async function apptCard() {
  await userEvent.click(await screen.findByRole('button', { name: /Бакыт М\./ }))
  return screen.getByRole('complementary', { name: 'Карточка приёма' })
}

test('оплата приёма «С аванса»: полностью — способ ADVANCE; больше остатка — подсказка без запроса', async () => {
  const sent = payBackend(4000)
  renderApp()
  const panel = await apptCard()
  const form = await openPay(panel)
  await userEvent.click(await within(form).findByRole('button', { name: /С аванса · 4\s000 сом/ }))
  await userEvent.click(within(form).getByRole('button', { name: /^Сохранить оплату · 5\s000 сом/ }))
  expect(within(form).getByRole('alert')).toHaveTextContent(/На авансе только 4\s000 сом/)
  expect(sent).toEqual([])

  // Часть с аванса, остальное наличными — «Разными способами»
  await userEvent.click(within(form).getByRole('button', { name: 'Разными способами' }))
  await userEvent.type(within(form).getByLabelText(/С аванса, сом/), '4000')
  await userEvent.type(within(form).getByLabelText('Наличными, сом'), '1000')
  await userEvent.click(within(form).getByRole('button', { name: /^Сохранить оплату · 5\s000 сом/ }))
  expect(await within(panel).findByText(/5\s000 сом/)).toBeInTheDocument()
  expect(sent).toEqual([{ amountSom: 5000, method: 'CASH', parts: [{ amountSom: 1000, method: 'CASH' }, { amountSom: 4000, method: 'ADVANCE' }] }])
})

test('оплата приёма: аванса нет — кнопки «С аванса» нет', async () => {
  payBackend(0)
  renderApp()
  const panel = await apptCard()
  const form = await openPay(panel)
  await within(form).findByRole('button', { name: 'Наличные' })
  expect(within(form).queryByRole('button', { name: /С аванса/ })).not.toBeInTheDocument()
})
