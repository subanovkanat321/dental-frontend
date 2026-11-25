import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'

afterEach(() => {
  window.location.hash = ''
})

test('админу: новый договор — напоминание ведёт в «Настройки»; об оплате не напоминаем (Tish бесплатный)', async () => {
  let billingAsked = false
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments', () => HttpResponse.json([])),
    http.get('*/api/clinic/billing', () => { billingAsked = true; return HttpResponse.json({ state: 'ACTIVE', paidUntil: '2026-11-03', daysLeft: 3 }) }),
    http.get('*/api/clinic/agreement', () => HttpResponse.json({ current: { version: 2 }, last: { version: 1 }, scans: [] })),
  )
  renderApp()
  expect(await screen.findByRole('button', { name: /Договор с платформой обновился/ })).toBeInTheDocument()
  expect(screen.queryByText(/Приложение:|Продлить|оплат/)).not.toBeInTheDocument()
  expect(billingAsked).toBe(false)
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

test('напоминание скрывается ✕ до конца сеанса, новое — видно', async () => {
  sessionStorage.clear()
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments', () => HttpResponse.json([])),
    http.get('*/api/clinic/billing', () => HttpResponse.json({ state: 'ACTIVE', paidUntil: '2026-11-03', daysLeft: 3 })),
    http.get('*/api/clinic/agreement', () => HttpResponse.json({ current: { version: 2 }, last: { version: 1 }, scans: [] })),
  )
  renderApp()
  await screen.findByRole('button', { name: /Договор с платформой обновился/ })
  const close = screen.getAllByRole('button', { name: 'Скрыть напоминание до конца сеанса' })
  expect(close).toHaveLength(1)
  await userEvent.click(close[0]!)
  expect(screen.queryByRole('button', { name: /Договор с платформой обновился/ })).not.toBeInTheDocument()
  expect(JSON.parse(sessionStorage.getItem('crm.notices.hidden') ?? '[]')).toEqual(['agreement:2'])
  sessionStorage.clear()
})
