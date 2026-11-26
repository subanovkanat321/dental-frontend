import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, openItem, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { choose } from '../test/select'
import { waitForSlow } from '../test/wait'

type Settings = Schemas['BirthdaysSettings']

afterEach(() => { window.location.hash = '' })

test('«Настройки → Привлечение пациентов → Дни рождения»: по умолчанию выключено; включить и час — сохраняются сразу', async () => {
  const puts: Settings[] = []
  let state: Settings = { autoGreet: false, greetHour: 10 }
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/promo-codes', () => HttpResponse.json([
      { id: 3, code: 'TESTBDAY', discountPercent: 10, active: true, appointments: 0 },
    ] satisfies Schemas['PromoCodesCode'][])),
    http.get('*/api/clinic/birthday-settings', () => HttpResponse.json(state)),
    http.get('*/api/service-types', () => HttpResponse.json([])),
    http.get('*/api/clinic/birthday-gift', () => HttpResponse.json({
      preset: 'NONE', active: false, validDays: 30, validUntil: '2026-12-24', previewRu: '🎂 С днём рождения!', previewKy: '🎂 Туулган күнүңүз менен!',
    } satisfies Schemas['BirthdaysGift'])),
    http.put('*/api/clinic/birthday-settings', async ({ request }) => {
      state = (await request.json()) as Settings
      puts.push(state)
      return HttpResponse.json(state)
    }),
  )
  renderApp()
  openItem('birthdays')
  const box = await screen.findByRole('region', { name: 'Поздравления с днём рождения' })
  const auto = within(box).getByRole('checkbox', { name: /Поздравлять ботом автоматически/ })
  expect(auto).not.toBeChecked()
  await userEvent.click(auto)
  await waitForSlow(() => expect(auto).toBeChecked())
  await choose(within(box).getByLabelText('Во сколько поздравлять'), '09:00')
  await waitForSlow(() => expect(puts).toHaveLength(2))
  expect(puts[1]).toEqual({ autoGreet: true, greetHour: 9 })
})
