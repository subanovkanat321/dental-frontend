import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp, findSub } from '../test/fixtures'
import { server } from '../test/server'

// «Платформа → Настройки»: цены тарифов не дублируются — одна строка-ссылка на вкладку «Тарифы».

beforeEach(() => {
  window.location.hash = '/platform'
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json({ ...me, owner: true, platform: true } satisfies Schemas['BookingViewsMe'])),
    http.get('*/api/platform/clinics', () => HttpResponse.json([])),
    http.get('*/api/platform/applications', () => HttpResponse.json([])),
    http.get('*/api/platform/agreements/statuses', () => HttpResponse.json({})),
    http.get('*/api/platform/pay-requests', () => HttpResponse.json([])),
  )
})
afterEach(() => {
  window.location.hash = ''
})

test('вместо блока «Тарифы» — ссылка «Цены тарифов — во вкладке «Тарифы» ›»', async () => {
  const user = userEvent.setup()
  renderApp()
  await user.click(await findSub('Настройки'))
  const link = await screen.findByRole('link', { name: 'Цены тарифов — во вкладке «Тарифы» ›' })
  expect(link).toHaveAttribute('href', '#/platform/tariffs')
  expect(screen.queryByRole('heading', { name: 'Тарифы' })).not.toBeInTheDocument()
})
