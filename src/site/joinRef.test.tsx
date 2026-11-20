import { render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { server } from '../test/server'
import { Join } from './Join'

/** /join по ссылке-приглашению другой клиники: клиники — вымышленные. */
beforeEach(() => {
  server.use(http.get('*/web/tariffs', () => HttpResponse.json({ pilotMonths: 1, tariffs: [] } satisfies Schemas['Tariffs'])))
})
afterEach(() => {
  window.history.replaceState(null, '', '/')
})

test('/join?ref=…: «Вас пригласила клиника «…» — 3 месяца бесплатно», регистрация — с кодом', async () => {
  let asked = ''
  server.use(http.get('*/web/referral', ({ request }) => {
    asked = new URL(request.url).searchParams.get('code') ?? ''
    return HttpResponse.json({ clinicName: 'Стоматология Тест', freeMonths: 3 } satisfies Schemas['ClinicReferralsInvite'])
  }))
  window.history.replaceState(null, '', '/join?ref=ABC2DEF')
  render(<Join />)
  expect(await screen.findByRole('heading', { name: '🎁 Вас пригласила клиника «Стоматология Тест» — 3 месяца бесплатно' })).toBeInTheDocument()
  expect(asked).toBe('abc2def')
  for (const a of screen.getAllByRole('link', { name: 'Попробовать бесплатно' })) expect(a).toHaveAttribute('href', '/start?ref=abc2def')
})

test('/join с неизвестным или кривым кодом — страница как обычно, без приглашения', async () => {
  window.history.replaceState(null, '', '/join?ref=nosuch2')
  render(<Join />)
  expect(await screen.findByText(/Попробовать бесплатно: всё приложение/)).toBeInTheDocument()
  expect(screen.queryByRole('note', { name: 'Приглашение' })).not.toBeInTheDocument()
  for (const a of screen.getAllByRole('link', { name: 'Попробовать бесплатно' })) expect(a).toHaveAttribute('href', '/start')

  window.history.replaceState(null, '', '/join?ref=<script>')
  render(<Join />)
  expect(screen.queryByRole('note', { name: 'Приглашение' })).not.toBeInTheDocument()
})
