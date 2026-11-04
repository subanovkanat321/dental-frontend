import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'

afterEach(() => {
  window.location.hash = ''
})

test('«💬 Помощь» на главном экране: открывает чат с помощником, закрывается; в «Настройках» кнопки нет', async () => {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments', () => HttpResponse.json([])),
    http.get('*/api/appointments/to-pay', () => HttpResponse.json([])),
    http.get('*/api/support/chat', () => HttpResponse.json({ ai: true, dailyLimit: 20, usedToday: 0, maxLength: 1000 })),
  )
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Помощь: спросить помощника Tish' }))
  const chat = await screen.findByRole('complementary', { name: 'Помощь' })
  expect(await within(chat).findByText(/Спросите, как что-то сделать в Tish/)).toBeInTheDocument()
  await userEvent.click(screen.getAllByRole('button', { name: 'Закрыть' }).at(-1)!)
  expect(await screen.findByRole('button', { name: 'Помощь: спросить помощника Tish' })).toBeInTheDocument()

  window.location.hash = '#/settings'
  await vi.waitFor(() => expect(screen.queryByRole('button', { name: 'Помощь: спросить помощника Tish' })).not.toBeInTheDocument())
})
