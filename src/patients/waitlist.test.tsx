import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { todayIn } from '../lib/time'
import { appointment, me, renderApp, findSub } from '../test/fixtures'
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
      list = [{ id: 7, patient: aigul, doctorId: body.doctorId, durationMinutes: body.durationMinutes, createdAt: new Date().toISOString() }]
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
  await userEvent.click(within(form).getByRole('button', { name: 'В лист ожидания' }))
  expect(await within(panel).findByText(/В листе ожидания/)).toHaveTextContent('45 мин')
  expect(sent).toEqual([{ patientId: 2, doctorId: 2, durationMinutes: 45 }])

  await userEvent.click((await findSub(/Лист ожидания · 1/)))
  const table = await screen.findByRole('table', { name: 'Лист ожидания' })
  expect(table).toHaveTextContent('Дастан Т.')
  // «Убрать» переспрашивает: нажали случайно — пациент остаётся в листе
  const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
  await userEvent.click(within(table).getByRole('button', { name: 'Убрать из листа: Айгуль Т.' }))
  expect(confirm).toHaveBeenCalledWith('Убрать Айгуль Т. из листа ожидания?')
  expect(table).toHaveTextContent('Айгуль Т.')
  await userEvent.click(within(table).getByRole('button', { name: 'Убрать из листа: Айгуль Т.' }))
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
  const table = await screen.findByRole('table', { name: 'Лист ожидания' })
  await userEvent.click(within(table).getByRole('button', { name: 'Убрать из листа: Айгуль Т.' }))
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
  await userEvent.click(within(panel).getByLabelText(/Хочет раньше/))
  await userEvent.click(within(panel).getByRole('button', { name: 'Записать' }))
  expect(await screen.findByRole('complementary', { name: 'Карточка приёма' })).toBeInTheDocument()
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
  const table = await screen.findByRole('table', { name: 'Позвать на профосмотр' })
  expect(table).toHaveTextContent('ещё не звали')
  // Строка: последний визит · услуга, с какого дня пора и какой срок применён (считает сервер)
  expect(table).toHaveTextContent('10 янв 2026 · Коррекция брекетов')
  expect(table).toHaveTextContent(/10 февраля( 2026)? · через 1 мес\./)
  await userEvent.click(within(table).getByRole('button', { name: 'WhatsApp' }))
  expect(opened[0]).toContain('https://api.whatsapp.com/send/?phone=996700333444&text=')
  expect(decodeURIComponent(opened[0]!)).toContain('Прошло больше месяца с вашего визита')
  expect(decodeURIComponent(opened[0]!)).toContain('пора на профилактический осмотр')
  expect(decodeURIComponent(opened[0]!)).toContain('Стоматология «Тест»')
  expect(await within(table).findByText('сегодня')).toBeInTheDocument()
  expect(invited).toBe(1)
  // Звали меньше недели назад — сначала вопрос, потом текст повтора
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
  await userEvent.click(within(table).getByRole('button', { name: 'WhatsApp' }))
  expect(confirm.mock.calls[0]![0]).toBe('Звали сегодня. Позвать ещё раз?')
  await waitForSlow(() => expect(opened).toHaveLength(2))
  expect(decodeURIComponent(opened[1]!)).toContain('Мы писали вам сегодня — напоминаем ещё раз: пора на профилактический осмотр')

  server.use(http.get('*/api/service-types', () => HttpResponse.json([])))
  await userEvent.click(within(table).getByRole('button', { name: 'Записать' }))
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
    free: [{ start: nine, end: new Date(`${todayIn()}T10:00:00+06:00`).toISOString() }] })))
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
  expect(await screen.findByRole('complementary', { name: 'Карточка приёма' })).toHaveTextContent('Айгуль Т.')
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
  await userEvent.click(within(box).getByRole('button', { name: 'В лист ожидания' }))
  expect(await screen.findByRole('table', { name: 'Лист ожидания' })).toHaveTextContent('Айгуль Т.')
  expect(sent).toHaveLength(1)
  expect(sent[0]).toMatchObject({ patientId: 2 })
})
