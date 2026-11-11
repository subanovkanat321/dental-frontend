import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import { appointment, me, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { waitForSlow } from '../test/wait'

/** Фальшивый Telegram.WebApp: подпись запуска и системная кнопка «Назад». */
function fakeTelegram() {
  const handlers = new Set<() => void>()
  const back = { visible: false, show() { this.visible = true }, hide() { this.visible = false },
    onClick: (cb: () => void) => handlers.add(cb), offClick: (cb: () => void) => handlers.delete(cb) }
  window.Telegram = { WebApp: { initData: 'query_id=1&user=%7B%22id%22%3A111%7D&hash=abc', ready() {}, expand() {}, BackButton: back } }
  return { back, press: () => [...handlers].forEach((h) => h()) }
}

afterEach(() => {
  delete window.Telegram
})

test('в Telegram: запросы с подписью initData, «Назад» Telegram закрывает карточку', async () => {
  const tg = fakeTelegram()
  const auth: (string | null)[] = []
  server.use(
    http.get('*/api/patient/me', ({ request }) => {
      auth.push(request.headers.get('Authorization'))
      return HttpResponse.json(me)
    }),
    http.get('*/api/appointments', ({ request }) => HttpResponse.json(
      new URL(request.url).searchParams.get('doctorId') === '1' ? [appointment(10, 1, '10:00', 'Бакыт М.')] : [])),
  )
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: /Бакыт М\./ }))
  expect(screen.getByRole('complementary', { name: 'Карточка приёма' })).toBeInTheDocument()
  expect(auth[0]).toBe('tma query_id=1&user=%7B%22id%22%3A111%7D&hash=abc')
  expect(tg.back.visible).toBe(true)

  tg.press()
  await waitForSlow(() => expect(screen.queryByRole('complementary', { name: 'Карточка приёма' })).not.toBeInTheDocument())
  expect(tg.back.visible).toBe(false)
})

test('в Telegram подпись устарела (401) — «откройте заново из бота», а не вход через сайт', async () => {
  fakeTelegram()
  server.use(http.get('*/api/patient/me', () => HttpResponse.json({ detail: 'Сессия устарела — откройте заново из бота' }, { status: 401 })))
  renderApp()
  expect(await screen.findByText('Сессия устарела — откройте заново из бота')).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Войти через Telegram' })).not.toBeInTheDocument()
})
