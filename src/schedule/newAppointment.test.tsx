import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { addDays, shortDate, shortDay, todayIn } from '../lib/time'
import { appointment, me, renderApp } from '../test/fixtures'
import { server } from '../test/server'

type Appointment = Schemas['AppointmentView']

/**
 * «Новая запись» после UX-аудита 2026-11-20 (пакет 4): о выбранном пациенте — прямо в форме, врач по умолчанию —
 * лечащий, «Записать на следующий визит» — этап плана и ближайшее свободное время, кнопка с итогом прилипает к низу.
 * Пациенты вымышленные.
 */

const at = (date: string, time: string) => new Date(`${date}T${time}:00+06:00`).toISOString()

const services: Schemas['ServiceTypeView'][] = [
  { id: 5, name: 'Пломба', durationMinutes: 30, active: true },
  { id: 7, name: 'Коронка', durationMinutes: 60, active: true },
]

const allergy: Schemas['AnamnesisView'] = {
  items: [{ questionId: 1, code: 'ALLERGY', section: 'QUESTION', kind: 'CHECK_TEXT', title: 'Есть аллергия?', label: 'Аллергия', alert: true, yes: true, text: 'лидокаин' }],
}

afterEach(() => {
  window.location.hash = ''
  localStorage.clear()
})

test('из карточки пациента: уже записан на этот день, долг, ⚠ аллергия, когда был; врач — лечащий; итог на кнопке и переспрос', async () => {
  window.location.hash = '/patients'
  const today = todayIn()
  // Был у Дастана (врач 2) — он лечащий; на сегодня уже записан к Айгерим (врач 1)
  const visit: Appointment = { ...appointment(50, 2, '10:00', 'Айгуль Т.', { status: 'DONE', serviceName: 'Пломба' }), startAt: at(addDays(today, -14), '10:00') }
  const booked = appointment(51, 1, '15:00', 'Айгуль Т.')
  const created: unknown[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/patients/recent', () => HttpResponse.json([{ id: 2, fullName: 'Айгуль Т.', phone: '996700333444', telegram: false }])),
    http.get('*/api/appointments', () => HttpResponse.json([])),
    http.get('*/api/appointments/by-patient/2', () => HttpResponse.json({
      patient: { id: 2, fullName: 'Айгуль Т.', phone: '996700333444', telegram: false }, done: 1, noShow: 0, cancelled: 0, upcoming: [booked], past: [visit],
    } satisfies Schemas['PatientCard'])),
    http.get('*/api/appointments/debts', ({ request }) => HttpResponse.json(
      new URL(request.url).searchParams.get('patientId') === '2' ? [{ appointmentId: 50, debtSom: 1500, startAt: visit.startAt }] : [])),
    http.get('*/api/patients/2/anamnesis', () => HttpResponse.json(allergy)),
    http.get('*/api/patients/2/notes', () => HttpResponse.json([])),
    http.get('*/api/service-types', () => HttpResponse.json(services)),
    http.get('*/api/slots', () => HttpResponse.json({ workingDay: true, starts: [at(today, '16:00'), at(today, '17:00')] })),
    http.post('*/api/appointments', async ({ request }) => {
      const body = await request.json() as { doctorId: number; startAt: string }
      created.push(body)
      return HttpResponse.json(appointment(60, body.doctorId, '16:00', 'Айгуль Т.'))
    }),
  )
  const user = userEvent.setup()
  renderApp()
  await user.click(await screen.findByRole('button', { name: 'Айгуль Т.' }))
  const card = await screen.findByRole('complementary', { name: 'Карточка пациента' })
  await user.click(await within(card).findByRole('button', { name: '＋ Записать' }))

  const form = await screen.findByRole('complementary', { name: 'Новая запись' })
  const about = await within(form).findByLabelText('О пациенте')
  // Записан на сегодня — предупреждение до «Записать»
  expect(await within(about).findByRole('alert')).toHaveTextContent(`Уже записан на этот день: ${shortDate(booked.startAt, true)} · Айгерим Садыкова`)
  expect(await within(about).findByText(/Долг 1\s500 сом/)).toBeInTheDocument()
  expect(await within(about).findByRole('button', { name: /^Важно перед лечением: Аллергия: лидокаин/ })).toHaveClass('med-pill', 'danger')
  expect(about).toHaveTextContent(`Был ${shortDate(visit.startAt).replace(` ${today.slice(0, 4)}`, '')} · Дастан Т.`)
  // Врач по умолчанию — лечащий (последний состоявшийся приём), а не первый в списке
  await waitFor(() => expect(within(form).getByRole('combobox', { name: 'Врач' })).toHaveTextContent('Дастан Т.'))
  // Порядок полей: врач → день → время (сетка зависит от врача)
  const labels = [...form.querySelectorAll('.field > span, .field > legend')].map((l) => l.textContent)
  expect(labels.indexOf('Врач')).toBeLessThan(labels.indexOf('День'))
  expect(labels.indexOf('День')).toBeLessThan(labels.indexOf('Время'))
  // Подсказка «начните вводить…» и «(необязательно) — длительность подставится сама» больше не занимают строк
  expect(form).not.toHaveTextContent('длительность подставится сама')

  await user.click(await within(form).findByRole('button', { name: '16:00' }))
  // Кнопка называет итог и прилипает к низу панели
  const submit = within(form).getByRole('button', { name: `Записать · ${shortDay(today)}, 16:00` })
  expect(submit.closest('.new-appt-bar')).not.toBeNull()
  expect(form.querySelector('.new-appt-where')).toHaveTextContent(`16:00 · ${shortDay(today)} · Дастан Т.`)
  // Уже записан на этот день — переспрашиваем
  await user.click(submit)
  const ask = await screen.findByRole('alertdialog')
  expect(ask).toHaveTextContent('Айгуль Т. уже записан на этот день: 15:00. Записать ещё одну запись?')
  await user.click(within(ask).getByRole('button', { name: 'Записать ещё' }))
  await waitFor(() => expect(created).toEqual([expect.objectContaining({ doctorId: 2, startAt: at(today, '16:00') })]))
})

test('«Записать на следующий визит»: услуга и врач следующего этапа плана, время — ближайшее свободное через неделю', async () => {
  const today = todayIn()
  const week = addDays(today, 7)
  const done = appointment(10, 1, '10:00', 'Бакыт М.', { status: 'DONE', paidSom: 1000, paymentMethod: 'CASH', version: 1 })
  const plan: Schemas['TreatmentStepView'][] = [
    { id: 1, stage: 1, title: 'Пломба 36', serviceTypeId: 5, doneAt: done.startAt },
    { id: 2, stage: 2, title: 'Коронка 46', serviceTypeId: 7, doctorId: 2, doctorName: 'Дастан Т.' },
  ]
  const asked: string[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments', ({ request }) => HttpResponse.json(new URL(request.url).searchParams.get('doctorId') === '1' ? [done] : [])),
    http.get('*/api/appointments/by-patient/10', () => HttpResponse.json({
      patient: done.patient, done: 1, noShow: 0, cancelled: 0, upcoming: [], past: [done],
    } satisfies Schemas['PatientCard'])),
    http.get('*/api/patients/10/plan', () => HttpResponse.json(plan)),
    http.get('*/api/service-types', () => HttpResponse.json(services)),
    // У Дастана через неделю 10:00 занято: свободно 08:00 и 11:00 — ближе к 10:00 — 11:00
    http.get('*/api/slots', ({ request }) => {
      const q = new URL(request.url).searchParams
      asked.push(`${q.get('date')}|${q.get('doctorId')}|${q.get('duration')}`)
      const free = q.get('date') === week && q.get('doctorId') === '2' ? ['08:00', '11:00'] : []
      return HttpResponse.json({ workingDay: true, starts: free.map((t) => at(week, t)) })
    }),
  )
  const user = userEvent.setup()
  renderApp()
  await user.click(await screen.findByRole('button', { name: /Бакыт М\./ }))
  const panel = screen.getByRole('complementary', { name: 'Карточка приёма' })
  await user.click(await within(panel).findByRole('button', { name: 'Записать на следующий визит' }))
  const form = await screen.findByRole('complementary', { name: 'Новая запись' })
  // Этап «Коронка 46»: услуга (её длительность) и врач этапа
  await waitFor(() => expect(within(form).getByRole('button', { name: /Коронка/ })).toHaveAttribute('aria-pressed', 'true'))
  expect(within(form).getByRole('combobox', { name: 'Врач' })).toHaveTextContent('Дастан Т.')
  expect(within(form).getByRole('combobox', { name: /Длительность/ })).toHaveAttribute('data-value', '60')
  // Ближайшее свободное у врача этапа — а не 10:00 вне окон с ручным полем
  expect(await within(form).findByRole('button', { name: `Записать · ${shortDay(week)}, 11:00` })).toBeInTheDocument()
  expect(within(form).getByRole('button', { name: '11:00' })).toHaveAttribute('aria-pressed', 'true')
  expect(asked).toContain(`${week}|2|60`)
})

test('«Записать на следующий визит»: в этот день свободного нет — первое свободное в следующие дни', async () => {
  const today = todayIn()
  const later = addDays(today, 9)
  const done = appointment(10, 1, '10:00', 'Бакыт М.', { status: 'DONE', paidSom: 1000, paymentMethod: 'CASH', version: 1 })
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments', ({ request }) => HttpResponse.json(new URL(request.url).searchParams.get('doctorId') === '1' ? [done] : [])),
    http.get('*/api/appointments/by-patient/10', () => HttpResponse.json({
      patient: done.patient, done: 1, noShow: 0, cancelled: 0, upcoming: [], past: [done],
    } satisfies Schemas['PatientCard'])),
    // Плана нет — врач и услуга прежние; через неделю и на следующий день мест нет, через 9 дней — 09:30
    http.get('*/api/patients/10/plan', () => HttpResponse.json([])),
    http.get('*/api/service-types', () => HttpResponse.json(services)),
    http.get('*/api/slots', ({ request }) => {
      const q = new URL(request.url).searchParams
      return HttpResponse.json({ workingDay: true, starts: q.get('date') === later && q.get('doctorId') === '1' ? [at(later, '09:30')] : [] })
    }),
  )
  const user = userEvent.setup()
  renderApp()
  await user.click(await screen.findByRole('button', { name: /Бакыт М\./ }))
  const panel = screen.getByRole('complementary', { name: 'Карточка приёма' })
  await user.click(await within(panel).findByRole('button', { name: 'Записать на следующий визит' }))
  const form = await screen.findByRole('complementary', { name: 'Новая запись' })
  expect(await within(form).findByRole('button', { name: `Записать · ${shortDay(later)}, 09:30` })).toBeInTheDocument()
  expect(within(form).getByRole('combobox', { name: 'Врач' })).toHaveTextContent('Айгерим Садыкова')
})

test('«＋ Новая запись» на всех врачах: выбрали пациента в поиске — врачом становится его лечащий', async () => {
  const today = todayIn()
  const visit: Appointment = { ...appointment(50, 2, '10:00', 'Нурлан К.', { status: 'DONE' }), startAt: at(addDays(today, -3), '10:00') }
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments', () => HttpResponse.json([])),
    http.post('*/api/patients/search', () => HttpResponse.json([{ id: 50, fullName: 'Нурлан К.', phone: '996777555666' }])),
    http.get('*/api/appointments/by-patient/50', () => HttpResponse.json({
      patient: { id: 50, fullName: 'Нурлан К.', phone: '996777555666', telegram: false }, done: 1, noShow: 0, cancelled: 0, upcoming: [], past: [visit],
    } satisfies Schemas['PatientCard'])),
    http.get('*/api/service-types', () => HttpResponse.json(services)),
    http.get('*/api/slots', () => HttpResponse.json({ workingDay: true, starts: [at(today, '12:00')] })),
  )
  const user = userEvent.setup()
  renderApp()
  await user.click(await screen.findByRole('button', { name: '＋ Новая запись' }))
  const form = await screen.findByRole('complementary', { name: 'Новая запись' })
  await user.type(within(form).getByLabelText('Найти пациента'), 'Нур')
  await user.click(await within(form).findByRole('button', { name: /Нурлан К\./ }))
  await within(form).findByLabelText('О пациенте')
  // «＋ Новая запись» на «Все врачи» — врач по умолчанию: подставили лечащего (Дастан)
  await waitFor(() => expect(within(form).getByRole('combobox', { name: 'Врач' })).toHaveTextContent('Дастан Т.'))
  // Новый пациент без визитов — «Ещё не был в клинике» не показываем тому, у кого визиты есть
  expect(form).not.toHaveTextContent('Ещё не был в клинике')
})
