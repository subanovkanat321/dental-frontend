import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { TelegramLoginStatus } from '../api/client'
import { createQueryClient } from '../api/queryClient'
import { server } from '../test/server'
import { Login } from './Login'
import { QR_SCREEN } from '../lib/qrScreen'
import { QR_CAPTION } from './TelegramLogin'

/** QR-код входа на компьютере без Telegram: ссылка та же, что у кнопки «Войти через Telegram». */
const link = (n: number) => `https://t.me/tish_test_bot?start=weblogin_${String(n).padStart(32, 'A')}`

/** Экран: wide — компьютер с мышью (matchMedia отвечает на QR_SCREEN), иначе телефон. */
function screenIs(wide: boolean) {
  window.matchMedia = vi.fn((query: string) => ({
    matches: wide && query === QR_SCREEN, media: query, onchange: null,
    addEventListener: () => undefined, removeEventListener: () => undefined,
    addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

/**
 * Фальшивый бэкенд: каждый start — новая ссылка (link(1), link(2)…); statuses — ответы status по очереди
 * (последний повторяется), «waiting» — с последней выданной ссылкой.
 */
function backend(statuses: TelegramLoginStatus['state'][]) {
  let started = 0
  let i = 0
  server.use(
    http.get('*/web/config', () => HttpResponse.json({
      botUsername: 'tish_test_bot', passwordLogin: true, telegramCode: true, telegramLogin: true,
    })),
    http.post('*/web/login/telegram/start', () => HttpResponse.json({ link: link(++started), secondsLeft: 300 })),
    http.get('*/web/login/telegram/status', () => {
      const state = statuses[Math.min(i++, statuses.length - 1)]!
      const body: TelegramLoginStatus = state === 'waiting' ? { state, secondsLeft: 280, link: link(Math.max(started, 1)) } : { state, secondsLeft: 0 }
      return HttpResponse.json(body)
    }),
    http.delete('*/web/login/telegram', () => new HttpResponse(null, { status: 204 })),
  )
  return { started: () => started }
}

function show() {
  const client = createQueryClient({ queries: { retry: false } })
  return render(<QueryClientProvider client={client}><Login /></QueryClientProvider>)
}

const qrImage = () => screen.findByRole('img', { name: /QR-код входа/ })

afterEach(() => {
  delete (window as { matchMedia?: unknown }).matchMedia
  delete window.Telegram
  vi.restoreAllMocks()
})

test('на компьютере QR-код ссылки в бота виден сразу; форма номера рядом, Telegram сам не открывается', async () => {
  const api = backend(['none'])
  screenIs(true)
  const open = vi.spyOn(window, 'open').mockReturnValue(null)
  show()

  const qr = await qrImage()
  expect(qr).toHaveAttribute('data-link', link(1))
  expect(qr.querySelector('path')?.getAttribute('d')).toMatch(/^M\d/)
  expect(screen.getByText(QR_CAPTION)).toBeInTheDocument()
  expect(api.started()).toBe(1)
  expect(open).not.toHaveBeenCalled()
  // Пока ссылка только для QR — не «ждём вас»: форма логина и пароля видна, с «Забыли пароль?»
  expect(screen.queryByRole('status', { name: 'Ждём подтверждения в Telegram' })).not.toBeInTheDocument()
  expect(await screen.findByRole('textbox', { name: 'Логин или телефон' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Забыли пароль? / Первый вход' })).toBeInTheDocument()

  // «Войти через Telegram» открывает ту же ссылку (новую не берёт), QR остаётся и на шаге ожидания
  await userEvent.click(screen.getByRole('button', { name: 'Войти через Telegram' }))
  expect(open).toHaveBeenCalledWith(link(1), '_blank', 'noopener')
  expect(await screen.findByRole('status', { name: 'Ждём подтверждения в Telegram' })).toBeInTheDocument()
  expect(await qrImage()).toHaveAttribute('data-link', link(1))
  expect(api.started()).toBe(1)
})

test('«Обновить код» берёт новую ссылку — и QR-код уже с ней', async () => {
  const api = backend(['none'])
  screenIs(true)
  show()
  expect(await qrImage()).toHaveAttribute('data-link', link(1))

  await userEvent.click(screen.getByRole('button', { name: 'Обновить код' }))
  await waitFor(() => expect(screen.getByRole('img', { name: /QR-код входа/ })).toHaveAttribute('data-link', link(2)))
  expect(api.started()).toBe(2)
})

test('код истёк — новый сам, без нажатия', async () => {
  const api = backend(['none', 'none'])
  screenIs(true)
  show()
  expect(await qrImage()).toHaveAttribute('data-link', link(1))
  // Опрос через 2 секунды: «none» — ссылка истекла → новая
  await waitFor(() => expect(screen.getByRole('img', { name: /QR-код входа/ })).toHaveAttribute('data-link', link(2)), { timeout: 5000 })
  expect(api.started()).toBe(2)
}, 10000)

test('на телефоне (узкий экран) QR-кода нет и ссылка заранее не берётся — как раньше, кнопка', async () => {
  const api = backend(['none'])
  screenIs(false)
  show()
  expect(await screen.findByRole('button', { name: 'Войти через Telegram' })).toBeInTheDocument()
  expect(screen.queryByRole('img', { name: /QR-код входа/ })).not.toBeInTheDocument()
  expect(screen.queryByText(QR_CAPTION)).not.toBeInTheDocument()
  expect(api.started()).toBe(0)
})

test('внутри Telegram QR-кода нет даже на широком экране', async () => {
  const api = backend(['none'])
  screenIs(true)
  window.Telegram = { WebApp: { initData: 'query_id=1&hash=abc' } } as unknown as typeof window.Telegram
  show()
  expect(await screen.findByRole('textbox', { name: 'Логин или телефон' })).toBeInTheDocument()
  expect(screen.queryByRole('img', { name: /QR-код входа/ })).not.toBeInTheDocument()
  expect(api.started()).toBe(0)
})
