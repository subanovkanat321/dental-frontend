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

test('«Освободилось окно» в «Требует внимания»: «Предложить в бот» — у пациента в боте, WhatsApp — готовый текст', async () => {
  const offers = backend()
  const user = userEvent.setup()
  renderApp()
  const chips = await screen.findAllByRole('button', { name: /Освободилось окно: подходят 2 пациента из листа ожидания/ })
  await user.click(chips[0]!)
  const dialog = await screen.findByRole('dialog', { name: '🔔 Окна для листа ожидания' })
  const card = within(dialog).getByRole('region', { name: 'Освободилось 15:00–16:00' })
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

test('отказался — без кнопок; окон, где все отказались, в полосе нет', async () => {
  backend([{ ...windows[0]!, matches: [{ ...windows[0]!.matches[0]!, declined: true, offeredAt: at('09:00'), offeredVia: 'TELEGRAM' }] }])
  renderApp()
  await screen.findAllByRole('group', { name: 'Требует внимания' })
  expect(screen.queryByRole('button', { name: /Освободилось окно/ })).toBeNull()
})
