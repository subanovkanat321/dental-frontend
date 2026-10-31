import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'

afterEach(() => {
  window.location.hash = ''
})

test('админу: оплата кончается и новый договор — напоминания ведут в «Настройки»', async () => {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments', () => HttpResponse.json([])),
    http.get('*/api/clinic/billing', () => HttpResponse.json({ state: 'ACTIVE', paidUntil: '2026-11-03', daysLeft: 3 })),
    http.get('*/api/clinic/agreement', () => HttpResponse.json({ current: { version: 2 }, last: { version: 1 }, scans: [] })),
  )
  renderApp()
  expect(await screen.findByRole('button', { name: /Приложение: оплачено до 3 нояб 2026/ })).toBeInTheDocument()
  await userEvent.click(await screen.findByRole('button', { name: /Договор с платформой обновился \(версия 2\)/ }))
  expect(window.location.hash).toBe('#/settings/agreement')
})

test('врачу напоминаний нет', async () => {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json({ ...me, admin: false })),
    http.get('*/api/appointments', () => HttpResponse.json([])),
    http.get('*/api/clinic/billing', () => HttpResponse.json({ state: 'PAUSED', paidUntil: '2026-10-01' })),
  )
  renderApp()
  await screen.findByRole('navigation', { name: 'Разделы' })
  expect(screen.queryByText(/Приложение:/)).not.toBeInTheDocument()
})
