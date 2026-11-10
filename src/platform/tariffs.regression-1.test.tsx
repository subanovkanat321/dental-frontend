import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp, findSub } from '../test/fixtures'
import { server } from '../test/server'

beforeEach(() => {
  window.location.hash = '/platform'
})
afterEach(() => {
  window.location.hash = ''
})

// Regression: ISSUE-004 — сервер возвращает новые цены, форма пересоздавалась по ключу из цен
// и теряла «Тарифы сохранены»: владелец не видел, что сохранение прошло
// Found by /qa on 2026-11-01
test('сохранили новые цены — форма показывает «Тарифы сохранены» и новые цены', async () => {
  let tariffs: Schemas['Tariffs'] = {
    pilotMonths: 3,
    tariffs: [
      { code: 'SOLO', name: 'Кабинет', who: '1 врач', maxDoctors: 1, monthSom: 990, yearSom: 9900 },
      { code: 'LARGE', name: 'Клиника', who: 'Все остальные', monthSom: 2490, yearSom: 24900 },
    ],
  }
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json({ ...me, owner: true, platform: true })),
    http.get('*/api/platform/clinics', () => HttpResponse.json([])),
    http.get('*/web/tariffs', () => HttpResponse.json(tariffs)),
    // Как настоящий сервер: в ответе — то, что сохранили
    http.put('*/api/platform/tariffs', async ({ request }) => {
      tariffs = (await request.json()) as Schemas['Tariffs']
      return HttpResponse.json(tariffs)
    }),
  )
  const user = userEvent.setup()
  renderApp()
  await user.click(await findSub('Тарифы'))
  const form = await screen.findByRole('form', { name: 'Тарифы' })
  await user.clear(within(form).getByLabelText('В месяц: Кабинет'))
  await user.type(within(form).getByLabelText('В месяц: Кабинет'), '1090')
  await user.click(within(form).getByRole('button', { name: 'Сохранить тарифы' }))

  const saved = await screen.findByRole('form', { name: 'Тарифы' })
  expect(await within(saved).findByRole('status')).toHaveTextContent('Тарифы сохранены')
  expect(within(saved).getByLabelText('В месяц: Кабинет')).toHaveValue(1090)
})
