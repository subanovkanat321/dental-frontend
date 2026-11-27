import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { reloadPage } from '../lib/reload'
import { TELEGRAM_POLL_MS } from './TelegramSection'

vi.mock('../lib/reload', () => ({ reloadPage: vi.fn() }))

type Status = Schemas['TelegramConnectControllerConnectStatus']

const LINK = 'https://t.me/tish_test_bot?start=tgmove_abc'

/** Регистратор с Telegram; ссылки и id — вымышленные. */
function backend(mine: Schemas['TelegramChangeControllerMyTelegram'] = { telegram: true, available: true }) {
  let status: Status = { state: 'waiting', secondsLeft: 900 }
  let started = 0
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json({ ...me, doctorId: undefined, admin: false, reception: true })),
    http.get('*/api/me/telegram', () => HttpResponse.json(mine)),
    http.get('*/api/me/phone', () => HttpResponse.json({ phone: undefined, phoneOnly: false, telegram: mine.telegram } satisfies Schemas['MyPhoneControllerMyPhone'])),
    http.post('*/api/me/telegram-change', () => {
      started++
      return HttpResponse.json({ link: LINK, secondsLeft: 900 } satisfies Schemas['TelegramChangeControllerChangeStarted'])
    }),
    http.get('*/web/telegram-change/status', () => HttpResponse.json(status)),
    http.post('*/api/me/telegram-connect', () => HttpResponse.json(
      { link: 'https://t.me/tish_test_bot?start=tglink_abc', secondsLeft: 1800 } satisfies Schemas['TelegramConnectControllerConnectStarted'])),
    http.get('*/api/appointments', () => HttpResponse.json([])),
    http.get('*/web/config', () => HttpResponse.json({ botUsername: 'tish_test_bot' })),
  )
  window.location.hash = '/settings/profile'
  return { started: () => started, set: (s: Status) => { status = s } }
}

afterEach(() => {
  window.location.hash = ''
  vi.unstubAllGlobals()
})

test('«Мой профиль → Telegram» на телефоне: «Сменить Telegram» → ссылка для нового аккаунта, «переключите аккаунт», отмена в боте', async () => {
  const api = backend()
  const user = userEvent.setup()
  renderApp()
  const section = await screen.findByRole('region', { name: 'Telegram' })
  expect(within(section).getByText('✓ Вы входите через Telegram')).toBeInTheDocument()
  await user.click(within(section).getByRole('button', { name: 'Сменить Telegram' }))
  const step = await within(section).findByRole('generic', { name: 'Сменить Telegram' })
  expect(api.started()).toBe(1)
  expect(step).toHaveTextContent('Откройте ссылку в новом аккаунте Telegram: переключите аккаунт')
  expect(within(step).getByRole('link', { name: LINK })).toHaveAttribute('href', LINK)
  expect(within(step).getByRole('button', { name: 'Скопировать ссылку' })).toBeInTheDocument()
  expect(step).toHaveTextContent('Ждём «✅ Да, перенести» в новом Telegram')
  // QR — только на компьютере
  expect(within(step).queryByRole('img')).not.toBeInTheDocument()
  // Ссылка — не в адресе страницы и не в localStorage
  expect(window.location.href).not.toContain('tgmove')
  expect(JSON.stringify({ ...localStorage })).not.toContain('tgmove')

  api.set({ state: 'cancelled', secondsLeft: 0 })
  expect(await within(section).findByRole('alert', {}, { timeout: TELEGRAM_POLL_MS * 3 })).toHaveTextContent('Перенос отменён в Telegram.')
  expect(within(section).getByRole('button', { name: 'Сменить Telegram' })).toBeInTheDocument()
})

test('компьютер: QR-код для телефона с новым Telegram; перенесли — страница входит заново', async () => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('pointer: fine'), addEventListener() {}, removeEventListener() {} }))
  const api = backend()
  const user = userEvent.setup()
  renderApp()
  const section = await screen.findByRole('region', { name: 'Telegram' })
  await user.click(within(section).getByRole('button', { name: 'Сменить Telegram' }))
  const step = await within(section).findByRole('generic', { name: 'Сменить Telegram' })
  expect(await within(step).findByRole('img', { name: /QR-код/ })).toBeInTheDocument()
  expect(step).toHaveTextContent('Наведите камеру телефона, где открыт НОВЫЙ Telegram')
  api.set({ state: 'linked', secondsLeft: 0 })
  const dialog = await screen.findByRole('alertdialog', {}, { timeout: TELEGRAM_POLL_MS * 3 })
  expect(dialog).toHaveTextContent('Вход перенесён на новый Telegram')
  await act(async () => { await user.click(within(dialog).getByRole('button', { name: /OK|Хорошо|Понятно/ })) })
  expect(reloadPage).toHaveBeenCalled()
})

test('без Telegram (вход по номеру): «📲 Подключить Telegram» вместо смены', async () => {
  backend({ telegram: false, available: true })
  const user = userEvent.setup()
  renderApp()
  const section = await screen.findByRole('region', { name: 'Telegram' })
  expect(within(section).getByText('Telegram не подключён — вход по номеру и паролю')).toBeInTheDocument()
  expect(within(section).queryByRole('button', { name: 'Сменить Telegram' })).not.toBeInTheDocument()
  await user.click(within(section).getByRole('button', { name: '📲 Подключить Telegram' }))
  expect(await within(section).findByRole('link', { name: 'https://t.me/tish_test_bot?start=tglink_abc' })).toBeInTheDocument()
})
