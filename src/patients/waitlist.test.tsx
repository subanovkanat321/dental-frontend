import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { todayIn } from '../lib/time'
import { appointment, me, renderApp, findSub, openBooked, openNewMore } from '../test/fixtures'
import { server } from '../test/server'
import { choose } from '../test/select'
import { waitForSlow } from '../test/wait'

type Entry = Schemas['WaitlistView']

afterEach(() => {
  window.location.hash = ''
})

const aigul = { id: 2, fullName: 'Айгуль Т.', phone: '996700333444', telegram: false }

function backend(start: Entry[] = []) {
  let list = [...start]
  const sent: unknown[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/patients/recent', () => HttpResponse.json([{ ...aigul, lastVisit: '2026-01-10T04:00:00Z' }])),
    http.get('*/api/appointments', () => HttpResponse.json([])),
    http.get('*/api/appointments/by-patient/2', () => HttpResponse.json({ patient: aigul, done: 1, noShow: 0, cancelled: 0, upcoming: [], past: [] })),
    http.get('*/api/appointments/debts', () => HttpResponse.json([])),
    http.get('*/api/waitlist', () => HttpResponse.json(list)),
    http.post('*/api/waitlist', async ({ request }) => {
      const body = (await request.json()) as Entry & { patientId: number }
      sent.push(body)
      list = [{ id: 7, patient: aigul, doctorId: body.doctorId, durationMinutes: body.durationMinutes, createdAt: new Date().toISOString(), wish: body.wish }]
      return HttpResponse.json(list[0], { status: 201 })
    }),
    http.delete('*/api/waitlist/:id', () => {
      list = []
      return new HttpResponse(null, { status: 204 })
    }),
  )
  return sent
}

test('карточка пациента: «В лист ожидания» на 45 минут к Дастану — затем вкладка «Лист ожидания», «Убрать»', async () => {
  window.location.hash = '/patients'
  const sent = backend()
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Айгуль Т.' }))
  const panel = await screen.findByRole('complementary', { name: 'Карточка пациента' })
  await userEvent.click(within(panel).getByRole('tab', { name: 'Прочее' }))
  const form = await within(panel).findByRole('form', { name: 'В лист ожидания' })
  await choose(within(form).getByLabelText('Сколько нужно времени'), '45 мин')
  await choose(within(form).getByLabelText('К какому врачу'), 'Дастан Т.')
  await userEvent.click(within(form).getByRole('button', { name: 'Добавить в лист ожидания' }))
  expect(await within(panel).findByText(/В листе ожидания/)).toHaveTextContent('45 мин')
  expect(sent).toEqual([{ patientId: 2, doctorId: 2, durationMinutes: 45, wish: { weekdays: [] } }])

  // Убрать можно и в карточке — там же, где ставили
  expect(within(panel).getByRole('button', { name: 'убрать' })).toBeInTheDocument()

  await userEvent.click((await findSub(/Лист ожидания · 1/)))
  const list = await screen.findByRole('list', { name: 'Лист ожидания' })
  // Строка: имя, к кому и сколько, «Удобно: …»; в строке — «Записать», «Убрать» — в «⋯» (ещё не записан)
  expect(list).toHaveTextContent(/Дастан Т\. · 45 мин/)
  expect(list).toHaveTextContent('Удобно: когда угодно')
  expect(within(list).getByRole('button', { name: 'Записать: Айгуль Т.' })).toBeInTheDocument()
  expect(within(list).queryByRole('button', { name: /^Убрать/ })).toBeNull()
  // «Убрать» переспрашивает: нажали случайно — пациент остаётся в листе
  const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
  await userEvent.click(within(list).getByRole('button', { name: 'Ещё: Айгуль Т.' }))
  await userEvent.click(within(list).getByRole('menuitem', { name: 'Убрать из листа' }))
  expect(confirm).toHaveBeenCalledWith('Убрать Айгуль Т. из листа ожидания?')
  expect(list).toHaveTextContent('Айгуль Т.')
  await userEvent.click(within(list).getByRole('button', { name: 'Ещё: Айгуль Т.' }))
  await userEvent.click(within(list).getByRole('menuitem', { name: 'Убрать из листа' }))
  expect(await screen.findByText(/Пока никто не ждёт/)).toBeInTheDocument()
  confirm.mockRestore()
})

test('лист ожидания: «Убрать» не прошло — ошибка видна', async () => {
  window.location.hash = '/patients'
  backend([{ id: 7, patient: aigul, durationMinutes: 30, createdAt: '2026-10-20T04:00:00Z' }])
  server.use(http.delete('*/api/waitlist/:id', () => HttpResponse.json({ title: 'Forbidden', status: 403, detail: 'Нет доступа' }, { status: 403 })))
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  renderApp()
  await userEvent.click(await findSub(/Лист ожидания/))
  const list = await screen.findByRole('list', { name: 'Лист ожидания' })
  await userEvent.click(within(list).getByRole('button', { name: 'Ещё: Айгуль Т.' }))
  await userEvent.click(within(list).getByRole('menuitem', { name: 'Убрать из листа' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Нет доступа')
  vi.restoreAllMocks()
})

test('«Хочет раньше»: запись создана, а в лист не попал — об этом предупреждают', async () => {
  backend()
  server.use(
    http.get('*/api/slots', () => HttpResponse.json({ workingDay: true, starts: [new Date(`${todayIn()}T23:00:00+06:00`).toISOString()] })),
    http.post('*/api/patients/search', () => HttpResponse.json([aigul])),
    http.post('*/api/appointments', () => HttpResponse.json(appointment(55, 1, '23:00', 'Айгуль Т.'), { status: 201 })),
    http.post('*/api/waitlist', () => HttpResponse.json({ title: 'Conflict', status: 409, detail: 'Уже в листе ожидания' }, { status: 409 })),
  )
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: '＋ Новая запись' }))
  const panel = screen.getByRole('complementary', { name: 'Новая запись' })
  await userEvent.click(await within(panel).findByRole('button', { name: '23:00' }))
  await userEvent.type(within(panel).getByLabelText('Найти пациента'), 'Айг')
  await userEvent.click(await within(panel).findByRole('button', { name: /Айгуль Т\./ }))
  await openNewMore(panel)
  await userEvent.click(within(panel).getByLabelText(/Хочет раньше/))
  await userEvent.click(within(panel).getByRole('button', { name: /^Записать( ·|$)/ }))
  expect(await openBooked()).toBeInTheDocument()
  // Своё окно (lib/confirm notify), не системный alert
  const message = await screen.findByRole('alertdialog')
  expect(message).toHaveTextContent(/Запись создана, но в лист ожидания пациент не попал: Уже в листе ожидания/)
  await userEvent.click(within(message).getByRole('button', { name: 'Понятно' }))
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
})

test('ассистент — «Профосмотр»: WhatsApp — отметка «позвали» и готовый текст; «Записать» — «Новая запись» на пациента', async () => {
  window.location.hash = '/patients'
  backend()
  // У ассистента нет денег — вместо «Позвать снова» прежний «Профосмотр»
  server.use(http.get('*/api/patient/me', () => HttpResponse.json({ ...me, admin: false, doctorId: undefined, assistantOf: [1] })))
  let invited = 0
  const opened: string[] = []
  vi.spyOn(window, 'open').mockImplementation((url) => { opened.push(String(url)); return null })
  server.use(
    http.get('*/api/appointments/recall', () => HttpResponse.json([{ patient: aigul, lastVisit: '2026-01-10T04:00:00Z',
      invitedAt: invited ? new Date().toISOString() : undefined, serviceName: 'Коррекция брекетов', months: 1, dueOn: '2026-02-10' }])),
    http.post('*/api/patients/2/recall-invited', () => {
      invited++
      return new HttpResponse(null, { status: 204 })
    }),
  )
  renderApp()
  await userEvent.click(await findSub('Профосмотр'))
  const table = await screen.findByRole('list', { name: 'Позвать на профосмотр' })
  expect(table).toHaveTextContent('ещё не звали')
  // Строка: последний визит · услуга, с какого дня пора и какой срок применён (считает сервер); одна кнопка — WhatsApp
  expect(table).toHaveTextContent(/был 10 янв 2026 · Коррекция брекетов · пора с 10 февраля( 2026)? \(через 1 мес\.\)/)
  expect(within(table).queryByRole('button', { name: /^Записать( ·|$)/ })).toBeNull()
  await userEvent.click(within(table).getByRole('button', { name: 'WhatsApp' }))
  expect(opened[0]).toContain('https://api.whatsapp.com/send/?phone=996700333444&text=')
  expect(decodeURIComponent(opened[0]!)).toContain('Прошло больше месяца с вашего визита')
  expect(decodeURIComponent(opened[0]!)).toContain('пора на профилактический осмотр')
  expect(decodeURIComponent(opened[0]!)).toContain('Стоматология «Тест»')
  expect(await within(table).findByText('звали сегодня')).toBeInTheDocument()
  expect(invited).toBe(1)
  // Звали меньше недели назад — сначала вопрос, потом текст повтора
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
  await userEvent.click(within(table).getByRole('button', { name: 'WhatsApp' }))
  expect(confirm.mock.calls[0]![0]).toBe('Звали сегодня. Позвать ещё раз?')
  await waitForSlow(() => expect(opened).toHaveLength(2))
  expect(decodeURIComponent(opened[1]!)).toContain('Мы писали вам сегодня — напоминаем ещё раз: пора на профилактический осмотр')

  server.use(http.get('*/api/service-types', () => HttpResponse.json([])))
  // «Записать» — в «⋯» строки (и «＋ Записать» в карточке)
  await userEvent.click(within(table).getByRole('button', { name: 'Ещё: Айгуль Т.' }))
  await userEvent.click(within(table).getByRole('menuitem', { name: /^Записать( ·|$)/ }))
  expect(await screen.findByRole('complementary', { name: 'Новая запись' })).toHaveTextContent('Айгуль Т.')
  vi.restoreAllMocks()
})

test('«Новая запись»: выбрали время в сетке — кто из листа ожидания уже записан позже, «Перенести сюда» одним нажатием', async () => {
  backend([{ id: 7, patient: aigul, durationMinutes: 30, createdAt: '2026-10-20T04:00:00Z', upcoming: appointment(56, 1, '23:30', 'Айгуль Т.') }])
  let booked: unknown
  const nine = new Date(`${todayIn()}T09:00:00+06:00`).toISOString()
  server.use(http.post('*/api/waitlist/7/book', async ({ request }) => {
    booked = await request.json()
    return HttpResponse.json(appointment(55, 1, '09:00', 'Айгуль Т.'))
  }), http.get('*/api/slots', () => HttpResponse.json({ workingDay: true, starts: [nine],
    free: [{ start: nine, end: new Date(`${todayIn()}T10:00:00+06:00`).toISOString() }] })),
  // Кто подходит на 09:00 — считает сервер (шаг 6Б)
  http.get('*/api/waitlist/fits', () => HttpResponse.json([{ entryId: 7, patient: aigul, startAt: nine, durationMinutes: 30, declined: false }])))
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: '＋ Новая запись' }))
  // Время не подставлено: окно выбирают в сетке, и тогда — кто его ждёт
  await userEvent.click(await screen.findByRole('button', { name: '09:00' }))
  const box = await screen.findByRole('region', { name: 'Подходит из листа ожидания' })
  expect(box).toHaveTextContent('Айгуль Т.')
  // WhatsApp — через openLink (в Telegram откроется снаружи); вне Telegram — window.open
  const opened: string[] = []
  vi.spyOn(window, 'open').mockImplementation((url) => { opened.push(String(url)); return null })
  const wa = within(box).getByRole('button', { name: 'WhatsApp' })
  await waitForSlow(() => expect(wa).toBeEnabled())
  await userEvent.click(wa)
  expect(opened[0]).toContain('phone=996700333444')
  vi.restoreAllMocks()
  await userEvent.click(within(box).getByRole('button', { name: 'Перенести сюда' }))
  expect(await openBooked()).toHaveTextContent('Айгуль Т.')
  expect(booked).toEqual({ doctorId: 1, startAt: nine })
})

test('вкладка «Лист ожидания»: «Добавить» — найти пациента и записать в лист', async () => {
  const sent = backend()
  server.use(http.post('*/api/patients/search', () => HttpResponse.json([aigul])))
  window.location.hash = '/patients'
  renderApp()
  await userEvent.click(await findSub(/Лист ожидания/))
  await userEvent.click(await screen.findByRole('button', { name: /Добавить в лист ожидания/ }))
  await userEvent.type(screen.getByLabelText('Найти пациента для листа ожидания'), 'Айг')
  await userEvent.click(await screen.findByRole('button', { name: /Айгуль Т\./ }))
  const box = screen.getByRole('form', { name: 'В лист ожидания' })
  await userEvent.click(within(box).getByRole('button', { name: 'Добавить в лист ожидания' }))
  expect(await screen.findByRole('list', { name: 'Лист ожидания' })).toHaveTextContent('Айгуль Т.')
  expect(sent).toHaveLength(1)
  expect(sent[0]).toMatchObject({ patientId: 2 })
})

test('«Когда удобно…»: утро и пн/пт — уходит на сервер часами, в карточке — «утро · пн, пт»', async () => {
  window.location.hash = '/patients'
  const sent = backend()
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Айгуль Т.' }))
  const panel = await screen.findByRole('complementary', { name: 'Карточка пациента' })
  await userEvent.click(within(panel).getByRole('tab', { name: 'Прочее' }))
  const form = await within(panel).findByRole('form', { name: 'В лист ожидания' })
  await userEvent.click(within(form).getByRole('button', { name: /Когда удобно/ }))
  await userEvent.click(within(form).getByRole('button', { name: 'Утро' }))
  await userEvent.click(within(form).getByRole('button', { name: 'Пн' }))
  await userEvent.click(within(form).getByRole('button', { name: 'Пт' }))
  await userEvent.click(within(form).getByRole('button', { name: 'Добавить в лист ожидания' }))
  expect(await within(panel).findByText('утро · пн, пт')).toBeInTheDocument()
  expect(sent).toEqual([expect.objectContaining({ wish: { timeFrom: '08:00', timeTo: '12:00', weekdays: [1, 5] } })])
})

test('лист ожидания: «Записать» — новая запись на пациента; записан — «✅ Записан …» и «Убрать» без вопроса', async () => {
  window.location.hash = '/patients'
  const removed: string[] = []
  backend([
    { id: 7, patient: aigul, durationMinutes: 60, doctorId: 2, createdAt: '2026-10-20T04:00:00Z' },
    { id: 8, patient: { ...aigul, id: 3, fullName: 'Бакыт Т.' }, durationMinutes: 30, createdAt: '2026-10-21T04:00:00Z',
      upcoming: { id: 99, startAt: '2026-12-01T09:00:00Z', endAt: '2026-12-01T09:30:00Z', status: 'SCHEDULED', doctorId: 1, version: 0, patient: { id: 3, fullName: 'Бакыт Т.' } } as Schemas['AppointmentView'] },
  ])
  server.use(http.delete('*/api/waitlist/:id', ({ params }) => { removed.push(String(params.id)); return new HttpResponse(null, { status: 204 }) }))
  const confirm = vi.spyOn(window, 'confirm')
  renderApp()
  await userEvent.click(await findSub(/Лист ожидания/))
  const list = await screen.findByRole('list', { name: 'Лист ожидания' })
  expect(list).toHaveTextContent(/✅ Записан/)
  expect(within(list).queryByRole('button', { name: 'Записать: Бакыт Т.' })).toBeNull()
  await userEvent.click(within(list).getByRole('button', { name: 'Убрать из листа: Бакыт Т.' }))
  await waitFor(() => expect(removed).toEqual(['8']))
  expect(confirm).not.toHaveBeenCalled()
  // «Записать» — «Новая запись» на этого пациента
  await userEvent.click(within(list).getByRole('button', { name: 'Записать: Айгуль Т.' }))
  expect(await screen.findByRole('complementary', { name: 'Новая запись' })).toHaveTextContent('Айгуль Т.')
  confirm.mockRestore()
})
