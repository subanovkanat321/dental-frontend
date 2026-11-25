import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { todayIn } from '../lib/time'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'

type Window = Schemas['WaitlistWindowsFreeWindow']

const at = (time: string) => new Date(`${todayIn()}T${time}:00+06:00`).toISOString()

/** Окно 15:00–16:00 освободилось; подходят двое (вымышленные): в боте и без бота. */
const windows: Window[] = [{
  doctorId: 1, start: at('15:00'), end: at('16:00'), freed: true,
  matches: [
    { entryId: 7, patient: { id: 70, fullName: 'Тест Бакыт', phone: '996555000070', telegram: true }, startAt: at('15:00'), durationMinutes: 30, declined: false },
    { entryId: 8, patient: { id: 80, fullName: 'Тест Айгуль', phone: '996555000080', telegram: false }, startAt: at('15:00'), durationMinutes: 45, declined: false },
  ],
}]

function backend(list: Window[] = windows) {
  const offers: { id: number; body: unknown }[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments', () => HttpResponse.json([])),
    http.get('*/api/waitlist/windows', () => HttpResponse.json(list)),
    http.get('*/api/patients/recent', () => HttpResponse.json([])),
    http.get('*/api/waitlist', () => HttpResponse.json(list.flatMap((w) => w.matches).filter((m, i, all) => all.findIndex((x) => x.entryId === m.entryId) === i)
      .map((m) => ({ id: m.entryId, doctorId: 1, patient: m.patient, durationMinutes: m.durationMinutes, createdAt: '2026-11-01T04:00:00Z' })) satisfies Schemas['WaitlistView'][])),
    http.post('*/api/waitlist/:id/offer', async ({ params, request }) => {
      offers.push({ id: Number(params.id), body: await request.json() })
      return new HttpResponse(null, { status: 204 })
    }),
  )
  return offers
}

beforeEach(() => {
  vi.stubGlobal('open', vi.fn())
  localStorage.clear()
})
afterEach(() => vi.unstubAllGlobals())

test('«Лист ожидания» → «🔔 Свободные окна»: «Предложить в бот» — у пациента в боте, WhatsApp — готовый текст', async () => {
  const offers = backend()
  const user = userEvent.setup()
  // Окна — вверху «Пациенты → Лист ожидания» (плашки «🔔 Окна» в «Расписании» с 2026-11-25 нет)
  window.location.hash = '/patients/waitlist'
  renderApp()
  const section = await screen.findByRole('region', { name: 'Свободные окна для листа ожидания' })
  const card = within(section).getByRole('region', { name: 'Освободилось 15:00–16:00' })
  expect(card).toHaveTextContent('подходят 2 пациента из листа ожидания')
  // Без бота — только WhatsApp
  expect(within(card).queryByRole('button', { name: 'Предложить в бот: Тест Айгуль' })).toBeNull()

  await user.click(within(card).getByRole('button', { name: 'Предложить в бот: Тест Бакыт' }))
  expect(await within(card).findByText('✓ отправили в бот')).toBeInTheDocument()
  expect(offers[0]).toEqual({ id: 7, body: { doctorId: 1, startAt: at('15:00'), channel: 'TELEGRAM' } })

  await user.click(within(card).getByRole('button', { name: 'Предложить в WhatsApp: Тест Айгуль' }))
  expect(offers[1]).toEqual({ id: 8, body: { doctorId: 1, startAt: at('15:00'), channel: 'WHATSAPP' } })
  const url = decodeURIComponent(String(vi.mocked(window.open).mock.calls[0]?.[0]))
  expect(url).toContain('996555000080')
  expect(url).toContain('Освободилось время у стоматолога')
})

test('плашки «🔔 Окна» в «Расписании» нет (окна — в «Листе ожидания» и «🔔» у свободного времени)', async () => {
  backend()
  window.location.hash = '/schedule'
  renderApp()
  await screen.findAllByRole('button', { name: /Новая запись/ })
  expect(screen.queryByRole('button', { name: /Освободилось окно|Свободные окна/ })).toBeNull()
})

test('больше двух окон — каждое свёрнуто строкой «время · врач · подходят N ›»; нажать — пациенты и кнопки (вверху «Листа ожидания»)', async () => {
  const many: Window[] = ['10:00', '11:00', '12:00'].map((t, i) => ({ ...windows[0]!, freed: false, start: at(t), end: at(`${10 + i}:30`),
    matches: windows[0]!.matches.map((m) => ({ ...m, startAt: at(t) })) }))
  backend(many)
  const user = userEvent.setup()
  window.location.hash = '/patients/waitlist'
  renderApp()
  const dialog = await screen.findByRole('region', { name: 'Свободные окна для листа ожидания' })
  const first = within(dialog).getByRole('region', { name: 'Свободно 10:00–10:30' })
  expect(within(first).queryByRole('button', { name: /Предложить в бот/ })).toBeNull()
  const fold = within(first).getByRole('button', { expanded: false })
  expect(fold).toHaveTextContent('подходят 2')
  await user.click(fold)
  const opened = within(dialog).getByRole('region', { name: 'Свободно 10:00–10:30' })
  expect(within(opened).getByRole('button', { name: 'Предложить в бот: Тест Бакыт' })).toBeInTheDocument()
  // Остальные — свёрнуты
  expect(within(within(dialog).getByRole('region', { name: 'Свободно 11:00–11:30' })).queryByRole('button', { name: /Предложить в бот/ })).toBeNull()
})
