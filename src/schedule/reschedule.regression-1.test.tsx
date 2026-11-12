import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { addDays, dayTitle, todayIn } from '../lib/time'
import { appointment, me, renderApp } from '../test/fixtures'
import { pickDate } from '../test/date'
import { server } from '../test/server'
import { waitForSlow } from '../test/wait'

type Appointment = Schemas['AppointmentView']

// Regression: ISSUE-002 — после переноса на другой день карточка показывала старые день и время
// (и брала старую версию приёма для следующих действий)
// Found by /qa on 2026-11-01
test('перенос на другой день: карточка остаётся открытой и показывает новый день и время', async () => {
  const tomorrow = addDays(todayIn(), 1)
  let a: Appointment = appointment(10, 1, '15:00', 'Бакыт М.', { version: 2 })
  const dayOf = (x: Appointment) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bishkek' }).format(new Date(x.startAt))
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    // Как на сервере: приём только в списке своего дня
    http.get('*/api/appointments', ({ request }) => {
      const q = new URL(request.url).searchParams
      return HttpResponse.json(q.get('doctorId') === String(a.doctorId) && q.get('date') === dayOf(a) ? [a] : [])
    }),
    http.post('*/api/appointments/:id/reschedule', async ({ request }) => {
      const body = (await request.json()) as { startAt: string }
      const start = new Date(body.startAt)
      a = { ...a, startAt: start.toISOString(), endAt: new Date(start.getTime() + 30 * 60000).toISOString(), version: a.version + 1 }
      return HttpResponse.json(a)
    }),
  )
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: /Бакыт М\./ }))
  const panel = screen.getByRole('complementary', { name: 'Карточка приёма' })
  await userEvent.click(within(panel).getByRole('button', { name: 'Перенести или передать врачу' }))
  const form = within(panel).getByRole('form', { name: 'Перенос записи' })
  const day = within(form).getByLabelText('День')
  await pickDate(day, tomorrow)
  // Сетки свободного времени у завтра нет (нет /api/slots) — время руками
  if (!within(form).queryByLabelText('Время')) await userEvent.click(within(form).getByRole('button', { name: 'Другое время' }))
  await userEvent.clear(await within(form).findByLabelText('Время'))
  await userEvent.type(within(form).getByLabelText('Время'), '11:00')
  await userEvent.click(within(form).getByRole('button', { name: 'Перенести' }))

  expect(await within(panel).findByRole('status')).toHaveTextContent('напомните пациенту заново')
  // День сегодня перечитан — приёма в нём больше нет, а карточка всё равно свежая
  await waitForSlow(() => expect(screen.getAllByRole('button', { name: /Бакыт М\./ })).toHaveLength(1))
  const heading = within(panel).getByRole('heading', { level: 2 })
  expect(heading).toHaveTextContent('11:00–11:30')
  expect(panel).toHaveTextContent(dayTitle(tomorrow))
})
