import { screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'

import { appointment, me, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { readDeepLink } from './deepLink'

afterEach(() => {
  window.history.replaceState(null, '', '/')
})

test('адреса кнопок бота → раздел CRM', () => {
  expect(readDeepLink('?day=tomorrow&v=abc', '2026-11-01')).toEqual({ page: 'schedule', date: '2026-11-02' })
  expect(readDeepLink('?day=tomorrow&doctor=2', '2026-11-01')).toEqual({ page: 'schedule', date: '2026-11-02', doctorId: 2 })
  expect(readDeepLink('?doctor=2', '2026-11-01')).toEqual({ page: 'schedule', doctorId: 2, date: undefined })
  expect(readDeepLink('?appointment=15&v=x')).toEqual({ page: 'schedule', appointmentId: 15 })
  expect(readDeepLink('?supply=7')).toEqual({ page: 'stock', supplyId: 7 })
  expect(readDeepLink('?screen=support&ticket=4')).toEqual({ page: 'help', tab: 'support', ticketId: 4 })
  expect(readDeepLink('?screen=pay-requests')).toEqual({ page: 'platform', tab: 'clinics' })
  expect(readDeepLink('?screen=booked&day=tomorrow&unconfirmed=1&doctor=2&v=x', '2026-11-01'))
    .toEqual({ page: 'patients', tab: 'booked', date: '2026-11-02', unconfirmed: true, unmarked: false, doctorId: 2 })
  expect(readDeepLink('?screen=booked&day=today&unconfirmed=1', '2026-11-01'))
    .toEqual({ page: 'patients', tab: 'booked', date: '2026-11-01', unconfirmed: true, unmarked: false, doctorId: undefined })
  // «Отметить (N)» — напоминание после вечерней смены
  expect(readDeepLink('?screen=booked&day=today&unmarked=1&doctor=3', '2026-11-01'))
    .toEqual({ page: 'patients', tab: 'booked', date: '2026-11-01', unconfirmed: false, unmarked: true, doctorId: 3 })
  expect(readDeepLink('?v=abc')).toBeNull()
  expect(readDeepLink('?appointment=abc')).toBeNull()
})

test('«Открыть приём» из уведомления: день приёма с его карточкой, адрес чистый', async () => {
  const a = appointment(15, 1, '10:00', 'Бакыт М.')
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments/15', () => HttpResponse.json(a)),
    http.get('*/api/appointments', ({ request }) => HttpResponse.json(new URL(request.url).searchParams.get('doctorId') === '1' ? [a] : [])),
  )
  window.history.replaceState(null, '', '/?appointment=15&v=abc')
  renderApp()
  const panel = await screen.findByRole('complementary', { name: 'Карточка приёма' })
  expect(within(panel).getByRole('button', { name: 'Бакыт М. ›' })).toBeInTheDocument()
  expect(window.location.search).toBe('')
  expect(window.location.hash).toBe('#/schedule')
})

test('«Приёмы коллеги» (?doctor=2): расписание сразу этого врача', async () => {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments', () => HttpResponse.json([])),
  )
  window.history.replaceState(null, '', '/?doctor=2')
  renderApp()
  expect(await screen.findByRole('group', { name: 'Дастан Т.' })).toBeInTheDocument()
  expect(screen.queryByRole('group', { name: 'Айгерим Садыкова' })).not.toBeInTheDocument()
  expect(window.location.search).toBe('')
})
