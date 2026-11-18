import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'

const clinic: Schemas['ClinicView'] = {
  brandName: 'Стоматология «Тест»', phones: ['996555123456'], code: 'test1', workStart: '09:00:00', workEnd: '18:00:00',
  workDays: ['MONDAY'], listed: true, independentDoctors: false, separateSupplies: false, settingUp: false, ownHours: false, recallMonths: 6
}

beforeEach(() => {
  window.location.hash = '/clinic/about'
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/clinic', () => HttpResponse.json(clinic)),
    http.get('*/api/clinic/deposit', () => HttpResponse.json({ mode: 'OFF', hasQr: false } satisfies Schemas['DepositsSettings'])),
    http.get('*/api/service-types', () => HttpResponse.json([])),
  )
})
afterEach(() => {
  window.location.hash = ''
})

test('«Ссылки для записи»: своя ссылка с меткой на каждый канал, «Скопировать» кладёт её в буфер, QR на ресепшн', async () => {
  const user = userEvent.setup()
  renderApp()
  const block = await screen.findByRole('region', { name: 'Ссылки для записи' })
  const origin = window.location.origin
  expect(within(block).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual([
    `${origin}/c/test1?from=instagram`, `${origin}/c/test1?from=2gis`, `${origin}/c/test1?from=whatsapp`,
    `${origin}/c/test1?from=reels`, `${origin}/c/test1?from=qr`,
  ])

  await user.click(within(block).getByRole('button', { name: 'Скопировать ссылку: 2ГИС' }))
  expect(await navigator.clipboard.readText()).toBe(`${origin}/c/test1?from=2gis`)
  expect(within(block).getByRole('status')).toHaveTextContent('Ссылка «2ГИС» скопирована')

  // QR — той же ссылки с меткой qr; можно скачать
  const qr = await within(block).findByRole('img', { name: 'QR-код записи в клинику для ресепшн' })
  await waitFor(() => expect(qr).toHaveAttribute('data-link', `${origin}/c/test1?from=qr`))
  expect(within(block).getByRole('button', { name: 'Скачать QR' })).toBeInTheDocument()
})
