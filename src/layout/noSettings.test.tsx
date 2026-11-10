import { screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import type * as Items from '../settings/items'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'

/**
 * Роль без единого пункта «Настроек» — раздела «Настройки» у неё нет. Сейчас «Памятки» и «Откуда
 * приходят» видят все сотрудники, поэтому правило проверяем на «Настройках» только для руководителя.
 */
vi.mock('../settings/items', async (original) => {
  const real = await original<typeof Items>()
  return {
    ...real,
    SETTINGS_GROUPS: real.SETTINGS_GROUPS.map(([group, items]) => [group, items.map((i) => ({ ...i, show: (who: Schemas['BookingViewsMe']) => Boolean(who.admin) }))]),
  }
})

afterEach(() => {
  window.history.replaceState(null, '', '/')
})

test('ассистент без пунктов «Настроек» — раздела нет; руководитель — есть', async () => {
  const assistant = { ...me, admin: false, doctorId: undefined, fullName: 'Асель', assistantOf: [2] }
  server.use(http.get('*/api/patient/me', () => HttpResponse.json(assistant)))
  window.location.hash = '/schedule'
  const first = renderApp()
  const nav = await screen.findByRole('navigation', { name: 'Разделы' })
  expect(within(nav).getByRole('button', { name: 'Клиника' })).toBeInTheDocument()
  expect(within(nav).queryByRole('button', { name: 'Настройки' })).not.toBeInTheDocument()
  first.unmount()

  server.use(http.get('*/api/patient/me', () => HttpResponse.json(me)))
  renderApp()
  expect(await within(await screen.findByRole('navigation', { name: 'Разделы' })).findByRole('button', { name: 'Настройки' })).toBeInTheDocument()
})
