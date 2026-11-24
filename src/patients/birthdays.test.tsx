import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { todayIn } from '../lib/time'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'

const today: Schemas['BirthdaysToday'] = {
  date: todayIn(),
  promoCode: 'TESTBDAY',
  gift: 'скидка 10 %',
  items: [
    { patient: { id: 5, fullName: 'Тест Именинница', phone: '996555000005', telegram: false }, age: 30, giftUsed: false },
    { patient: { id: 6, fullName: 'Тест В боте', phone: '996555000006', telegram: true }, age: 41, giftUsed: false },
  ],
}

function backend() {
  const greets: { id: number; body: unknown }[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments', () => HttpResponse.json([])),
    http.get('*/api/birthdays/today', () => HttpResponse.json(today)),
    http.post('*/api/birthdays/:id/greet', async ({ params, request }) => {
      const body = await request.json() as { channel: string; lang: string }
      greets.push({ id: Number(params.id), body })
      return HttpResponse.json({ lang: body.lang === 'KY' ? 'KY' : 'RU', text: body.channel === 'WHATSAPP' ? '🎂 Туулган күнүңүз менен! Саламатсызбы' : undefined } satisfies Schemas['BirthdaysGreeting'])
    }),
  )
  return greets
}

beforeEach(() => {
  vi.stubGlobal('open', vi.fn())
  localStorage.clear()
})
afterEach(() => vi.unstubAllGlobals())

test('«🎂 Дни рождения» в расписании: WhatsApp по-кыргызски и «Поздравить в бот»', async () => {
  const greets = backend()
  const user = userEvent.setup()
  renderApp()
  const chips = await screen.findAllByRole('button', { name: 'Сегодня день рождения: 2 — поздравить' })
  await user.click(chips[0]!)
  const dialog = await screen.findByRole('dialog', { name: '🎂 Сегодня день рождения' })
  expect(dialog).toHaveTextContent('исполняется 30')
  expect(dialog).toHaveTextContent('TESTBDAY')
  await user.click(within(dialog).getByRole('button', { name: 'Кыргызча' }))
  await user.click(within(dialog).getByRole('button', { name: 'Поздравить в WhatsApp: Тест Именинница' }))
  expect(greets[0]).toEqual({ id: 5, body: { channel: 'WHATSAPP', lang: 'KY' } })
  const url = decodeURIComponent(String(vi.mocked(window.open).mock.calls[0]?.[0]))
  expect(url).toContain('996555000005')
  expect(url).toContain('Саламатсызбы')
  // Без бота — кнопки «в бот» нет; в боте — есть
  expect(within(dialog).queryByRole('button', { name: 'Поздравить в бот: Тест Именинница' })).toBeNull()
  await user.click(within(dialog).getByRole('button', { name: 'Поздравить в бот: Тест В боте' }))
  expect(greets[1]).toEqual({ id: 6, body: { channel: 'TELEGRAM', lang: 'KY' } })
})

test('«Пациенты» → фильтр «🎂 Сегодня» показывает именинников', async () => {
  backend()
  const user = userEvent.setup()
  window.location.hash = '#/patients/all'
  renderApp()
  await user.click(await screen.findByRole('button', { name: /🎂 Сегодня · 2/ }))
  const list = await screen.findByRole('list', { name: 'Сегодня день рождения' })
  expect(within(list).getAllByRole('listitem')).toHaveLength(2)
})
