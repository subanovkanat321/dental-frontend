import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { PLATFORM_LONG_PASSWORD } from './platformAccess'

type Me = Schemas['BookingViewsMe']

afterEach(() => {
  window.location.hash = ''
})

function serve(body: Me) {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(body)),
    http.get('*/api/appointments', () => HttpResponse.json([])),
  )
}

test('владелец платформы вошёл по короткому паролю — «Платформа» в меню с подсказкой сменить пароль, без запросов к платформе', async () => {
  let platformCalls = 0
  server.use(http.get('*/api/platform/*', () => {
    platformCalls++
    return HttpResponse.json({ detail: PLATFORM_LONG_PASSWORD }, { status: 403 })
  }))
  serve({ ...me, platform: false, platformPasswordShort: true })
  const user = userEvent.setup()
  renderApp()
  const nav = await screen.findByRole('navigation', { name: 'Разделы' })
  await user.click(within(nav).getByRole('button', { name: /^Платформа/ }))

  const hint = await screen.findByRole('region', { name: 'Платформа' })
  expect(within(hint).getByRole('status')).toHaveTextContent(
    'Для «Платформы» по паролю нужен пароль от 12 символов — смените его в «Мой профиль» → «Логин и пароль»')
  expect(within(hint).getByRole('button', { name: 'Открыть «Мой профиль»' })).toBeInTheDocument()
  expect(platformCalls).toBe(0)
})

test('обычный сотрудник — «Платформы» в меню нет', async () => {
  serve({ ...me, platform: false, platformPasswordShort: false })
  renderApp()
  const nav = await screen.findByRole('navigation', { name: 'Разделы' })
  expect(within(nav).queryByRole('button', { name: /^Платформа/ })).not.toBeInTheDocument()
})
