import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { addDays, todayIn } from '../lib/time'
import { appointment, me, renderApp } from '../test/fixtures'
import { server } from '../test/server'

type Appointment = Schemas['AppointmentView']

afterEach(() => {
  window.location.hash = ''
  localStorage.clear()
})

/** День одного врача; статус и «Вернуть» меняют приём, как сервер. */
function backend(a: Appointment, who: Schemas['BookingViewsMe'] = me) {
  let current = a
  const sent: unknown[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(who)),
    http.get('*/api/appointments', ({ request }) => HttpResponse.json(new URL(request.url).searchParams.get('doctorId') === String(a.doctorId) ? [current] : [])),
    http.post('*/api/appointments/:id/status', async ({ request }) => {
      const body = await request.json() as { status: Appointment['status'] }
      sent.push({ status: body.status })
      current = { ...current, status: body.status, version: current.version! + 1 }
      return HttpResponse.json(current)
    }),
    http.post('*/api/appointments/:id/undo', async ({ request }) => {
      const body = await request.json() as { previousStatus: Appointment['status'] }
      sent.push({ undo: body.previousStatus })
      current = { ...current, status: body.previousStatus, version: current.version! + 1 }
      return HttpResponse.json(current)
    }),
    http.delete('*/api/appointments/:id', () => {
      sent.push('delete')
      return new HttpResponse(null, { status: 204 })
    }),
  )
  return sent
}

const open = async (name: RegExp) => {
  await userEvent.click(await screen.findByRole('button', { name }))
  return screen.getByRole('complementary', { name: 'Карточка приёма' })
}

test('неявка — «Вернуть» возвращает как было', async () => {
  const sent = backend(appointment(10, 1, '00:05', 'Бакыт М.', { version: 1 }))
  renderApp()
  const panel = await open(/Бакыт М\./)
  await userEvent.click(within(panel).getByRole('button', { name: 'Неявка' }))
  expect(await within(panel).findByText('Отмечено: неявка')).toBeInTheDocument()
  expect(within(panel).getByRole('button', { name: 'Исправить: приём состоялся' })).toBeInTheDocument()
  await userEvent.click(within(panel).getByRole('button', { name: 'Вернуть' }))
  expect(await within(panel).findByRole('button', { name: 'Приём состоялся' })).toBeInTheDocument()
  expect(sent).toEqual([{ status: 'NO_SHOW' }, { undo: 'SCHEDULED' }])
})

test('отменённую запись — «Восстановить»; админ может удалить запись', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  const cancelled = appointment(10, 1, '10:00', 'Бакыт М.', { status: 'CANCELLED', version: 1 })
  const sent = backend(cancelled)
  server.use(http.get('*/api/appointments/10', () => HttpResponse.json(cancelled)))
  // Отменённых в сетке нет — открываем кнопкой бота «Открыть приём»
  window.history.replaceState(null, '', '/?appointment=10')
  renderApp()
  const panel = await screen.findByRole('complementary', { name: 'Карточка приёма' })
  await userEvent.click(within(panel).getByRole('button', { name: 'Восстановить' }))
  expect(await within(panel).findByRole('button', { name: 'Отменить запись' })).toBeInTheDocument()
  await userEvent.click(within(panel).getByRole('button', { name: 'Удалить запись' }))
  await vi.waitFor(() => expect(screen.queryByRole('complementary', { name: 'Карточка приёма' })).not.toBeInTheDocument())
  expect(sent).toEqual([{ status: 'SCHEDULED' }, 'delete'])
  window.history.replaceState(null, '', '/')
})

test('состоялся: «Записать на следующий визит» — «Новая запись» на того же пациента через неделю', async () => {
  backend(appointment(10, 1, '00:05', 'Бакыт М.', { status: 'DONE', paidSom: 1000, paymentMethod: 'CASH', version: 1 }))
  renderApp()
  const panel = await open(/Бакыт М\./)
  await userEvent.click(within(panel).getByRole('button', { name: 'Записать на следующий визит' }))
  const fresh = await screen.findByRole('complementary', { name: 'Новая запись' })
  expect(fresh).toHaveTextContent('Бакыт М.')
  expect(within(fresh).getByRole('combobox', { name: /Длительность/ })).toHaveValue('30')
  expect(fresh).toHaveTextContent(new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', day: 'numeric', month: 'long' }).format(new Date(`${addDays(todayIn(), 7)}T00:00:00Z`)))
})

test('приём коллеги — только посмотреть и позвонить', async () => {
  backend(appointment(20, 2, '10:00', 'Айгуль Т.', { version: 1 }), { ...me, admin: false, doctorId: 1 })
  renderApp()
  const panel = await open(/Айгуль Т\./)
  expect(within(panel).getByText(/Это приём коллеги/)).toBeInTheDocument()
  expect(within(panel).getByRole('link', { name: /Позвонить/ })).toHaveAttribute('href', 'tel:+996555123456')
  expect(within(panel).queryByRole('button', { name: 'Отменить запись' })).not.toBeInTheDocument()
})

test('имя пациента в карточке — его карточка в «Пациентах»', async () => {
  backend(appointment(10, 1, '10:00', 'Бакыт М.', { version: 1 }))
  server.use(
    http.get('*/api/patients/recent', () => HttpResponse.json([])),
    http.get('*/api/appointments/by-patient/10', () => HttpResponse.json({ patient: { id: 10, fullName: 'Бакыт М.', phone: '996555123456' }, done: 0, noShow: 0, cancelled: 0, upcoming: [], past: [] })),
    http.get('*/api/appointments/debts', () => HttpResponse.json([])),
  )
  renderApp()
  const panel = await open(/Бакыт М\./)
  await userEvent.click(within(panel).getByRole('button', { name: 'Бакыт М. ›' }))
  const card = await screen.findByRole('complementary', { name: 'Карточка пациента' })
  expect(await within(card).findByRole('heading', { name: 'Бакыт М.' })).toBeInTheDocument()
  expect(window.location.hash).toBe('#/patients')
})
