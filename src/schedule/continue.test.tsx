import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { appointment, me, renderApp, expand } from '../test/fixtures'
import { server } from '../test/server'

// Пациенты и заметки вымышленные
const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString()

function setup(notes: Schemas['VisitNoteView'][], plan: Schemas['TreatmentStepView'][], who: Schemas['BookingViewsMe'] = me) {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(who)),
    http.get('*/api/appointments', ({ request }) => {
      const doctorId = Number(new URL(request.url).searchParams.get('doctorId'))
      return HttpResponse.json([appointment(10, 1, '23:30', 'Бакыт М.')].filter((a) => a.doctorId === doctorId))
    }),
    http.get('*/api/appointments/to-pay', () => HttpResponse.json([])),
    http.get('*/api/patients/:id/notes', () => HttpResponse.json(notes)),
    http.get('*/api/patients/:id/plan', () => HttpResponse.json(plan)),
  )
}

async function card() {
  await userEvent.click(await screen.findByRole('button', { name: /Бакыт М\./ }))
  return screen.getByRole('complementary', { name: 'Карточка приёма' })
}

test('следующий визит: что сделали в прошлый раз и что осталось по плану', async () => {
  setup([
    { appointmentId: 7, startAt: ago(10), note: 'Старая заметка', doctorName: 'Асель' },
    { appointmentId: 8, startAt: ago(3), note: 'Удалили нерв 36, временная пломба. Через 3 дня — каналы', doctorName: 'Асель' },
  ], [
    { id: 1, tooth: 36, title: 'Пульпит: удалить нерв', doneAt: ago(3) },
    { id: 2, tooth: 36, title: 'Пломбировать каналы' },
    { id: 3, tooth: 36, title: 'Постоянная пломба' },
  ])
  renderApp()
  const block = await expand(await within(await card()).findByRole('region', { name: 'Продолжение лечения' }))
  expect(within(block).getByText(/Удалили нерв 36/)).toBeInTheDocument()
  expect(within(block).queryByText('Старая заметка')).not.toBeInTheDocument()
  expect(within(block).getByText(/Пломбировать каналы/)).toBeInTheDocument()
  expect(within(block).getByText(/Постоянная пломба/)).toBeInTheDocument()
  // Сделанный этап не повторяем
  expect(within(block).queryByText(/удалить нерв/)).not.toBeInTheDocument()
})

test('первый визит — ни заметок, ни плана: блока нет', async () => {
  const asked: string[] = []
  setup([], [])
  server.use(http.get('*/api/patients/:id/plan', () => { asked.push('plan'); return HttpResponse.json([]) }))
  renderApp()
  const panel = await card()
  await waitFor(() => expect(asked).toContain('plan'))
  expect(within(panel).queryByRole('region', { name: 'Продолжение лечения' })).not.toBeInTheDocument()
})

test('регистратура медкарту не видит — ни запросов, ни блока', async () => {
  const asked: string[] = []
  // Регистратура: не админ, не врач, не ассистент
  setup([], [], { ...me, admin: false, doctorId: undefined, reception: true })
  server.use(http.get('*/api/patients/:id/notes', () => { asked.push('notes'); return HttpResponse.json([]) }))
  renderApp()
  const panel = await card()
  expect(within(panel).queryByRole('region', { name: 'Продолжение лечения' })).not.toBeInTheDocument()
  expect(asked).not.toContain('notes')
})

function cardOf(past: Schemas['AppointmentView'][]) {
  server.use(http.get('*/api/appointments/by-patient/:id', () => HttpResponse.json({ done: past.length, noShow: 0, cancelled: 0, upcoming: [], past })))
}

test('история пациента: врач ничего не записал — всё равно видно, когда и с чем был в последний раз', async () => {
  setup([], [])
  cardOf([
    appointment(7, 1, '10:00', 'Бакыт М.', { startAt: ago(40), endAt: ago(40), status: 'DONE', serviceName: 'Осмотр и консультация' }),
    appointment(8, 1, '10:00', 'Бакыт М.', { startAt: ago(12), endAt: ago(12), status: 'DONE', serviceName: 'Лечение кариеса' }),
    appointment(9, 1, '10:00', 'Бакыт М.', { startAt: ago(5), endAt: ago(5), status: 'NO_SHOW' }),
  ])
  renderApp()
  // Одной строкой: сколько раз был, когда и с чем последний раз, неявки
  const block = await within(await card()).findByLabelText('История пациента')
  expect(block).toHaveTextContent('Визитов: 2')
  expect(block).toHaveTextContent('12 дней назад')
  expect(block).toHaveTextContent('Лечение кариеса')
  expect(block).toHaveTextContent('не пришёл 1 раз')
  // Заметок нет — «Продолжения лечения» нет, а история есть
  expect(screen.queryByRole('region', { name: 'Продолжение лечения' })).not.toBeInTheDocument()
})

test('история пациента: первый визит и видна регистратуре', async () => {
  setup([], [], { ...me, admin: false, doctorId: undefined, reception: true })
  cardOf([])
  renderApp()
  const block = await within(await card()).findByLabelText('История пациента')
  expect(block).toHaveTextContent('Впервые в клинике')
})
