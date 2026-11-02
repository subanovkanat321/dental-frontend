import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import { renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { InstallApp } from './InstallApp'
import { InstallHint } from './InstallHint'
import { launchedAsApp, listenInstallPrompt, registerServiceWorker, resetPwa, type InstallPromptEvent } from './pwa'
import { UpdateToast } from './UpdateToast'

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36'

function standalone(on: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: on && query === '(display-mode: standalone)', addEventListener() {}, removeEventListener() {} }))
}

/** Свойство navigator, которого нет в jsdom (clipboard, serviceWorker): своё на время теста. */
function navigatorProp(name: string, value: unknown) {
  Object.defineProperty(navigator, name, { value, configurable: true })
}

function userAgent(ua: string) {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua)
}

beforeEach(() => {
  resetPwa()
  standalone(false)
  try { localStorage.clear() } catch { /* нет хранилища */ }
})
afterEach(() => {
  vi.restoreAllMocks()
  delete window.Telegram
  for (const name of ['clipboard', 'serviceWorker']) Reflect.deleteProperty(navigator, name)
  window.history.replaceState(null, '', '/')
})

test('Chrome прислал «можно установить» — кнопка «Установить» показывает окно браузера; согласились — «установлено»', async () => {
  listenInstallPrompt()
  render(<InstallApp />)
  const prompt = vi.fn(() => Promise.resolve())
  const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
    prompt, userChoice: Promise.resolve({ outcome: 'accepted' as const }),
  }) as InstallPromptEvent
  act(() => { window.dispatchEvent(event) })
  expect(event.defaultPrevented).toBe(true)
  await userEvent.click(screen.getByRole('button', { name: 'Установить' }))
  expect(prompt).toHaveBeenCalled()
  expect(await screen.findByText('Приложение установлено ✓')).toBeInTheDocument()
})

test('iPhone: инструкция «Поделиться → На экран „Домой“»', () => {
  userAgent(IPHONE)
  render(<InstallApp />)
  const block = screen.getByRole('region', { name: 'Установить приложение' })
  expect(block).toHaveTextContent('Поделиться')
  expect(block).toHaveTextContent('На экран «Домой»')
  expect(screen.queryByRole('button', { name: 'Установить' })).not.toBeInTheDocument()
})

test('в Telegram: открыть сайт в браузере и установить оттуда, ссылку можно скопировать', async () => {
  const openLink = vi.fn()
  window.Telegram = { WebApp: { initData: 'signed', openLink, ready() {}, expand() {} } }
  const writeText = vi.fn(() => Promise.resolve())
  navigatorProp('clipboard', { writeText })
  render(<InstallApp />)
  expect(screen.getByRole('region', { name: 'Установить приложение' })).toHaveTextContent('в браузере телефона')
  await userEvent.click(screen.getByRole('button', { name: 'Скопировать ссылку' }))
  expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/login`)
  expect(await screen.findByRole('button', { name: 'Ссылка скопирована ✓' })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Открыть в браузере' }))
  expect(openLink).toHaveBeenCalledWith(`${window.location.origin}/login`)
})

test('уже установлено (открыто отдельным окном) — «Приложение установлено ✓»', () => {
  standalone(true)
  render(<InstallApp />)
  expect(screen.getByText('Приложение установлено ✓')).toBeInTheDocument()
})

test('service worker: только в сборке и не внутри Telegram', () => {
  const register = vi.fn(() => new Promise<ServiceWorkerRegistration>(() => {}))
  navigatorProp('serviceWorker', { register, addEventListener() {}, controller: null })
  // npm run dev и тесты — нет
  expect(registerServiceWorker(false)).toBe(false)
  // Telegram Mini App — нет
  window.Telegram = { WebApp: { initData: 'signed', ready() {}, expand() {} } }
  expect(registerServiceWorker(true)).toBe(false)
  expect(register).not.toHaveBeenCalled()
  // Браузер, сборка — да
  delete window.Telegram
  expect(registerServiceWorker(true)).toBe(true)
  expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/' })
})

test('новая версия ждёт — «Доступна новая версия», «Обновить» включает её', async () => {
  const postMessage = vi.fn()
  resetPwa({ waiting: { postMessage } as unknown as ServiceWorker })
  render(<UpdateToast />)
  expect(screen.getByRole('status')).toHaveTextContent('Доступна новая версия')
  await userEvent.click(screen.getByRole('button', { name: 'Обновить' }))
  expect(postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' })
})

test('подсказка на входе: в браузере телефона — да, закрыли — больше нет; на компьютере — нет', async () => {
  userAgent(ANDROID)
  const { unmount } = render(<InstallHint />)
  expect(screen.getByRole('note')).toHaveTextContent('Установить приложение')
  await userEvent.click(screen.getByRole('button', { name: 'Скрыть подсказку' }))
  expect(screen.queryByRole('note')).not.toBeInTheDocument()
  unmount()
  render(<InstallHint />)
  expect(screen.queryByRole('note')).not.toBeInTheDocument()
})

test('запуск с иконки без входа — страница входа, а не каталог клиник для пациентов', async () => {
  expect(launchedAsApp('?source=pwa')).toBe(true)
  expect(launchedAsApp('')).toBe(false)
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json({ detail: 'Войдите' }, { status: 401 })),
    http.get('*/web/config', () => HttpResponse.json({ botUsername: 'tish_test_bot', botId: 123456 })),
  )
  const replace = vi.fn()
  vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, pathname: '/', search: '?source=pwa', replace })
  renderApp()
  expect(await screen.findByRole('heading', { name: 'Вход для клиники' })).toBeInTheDocument()
  expect(replace).not.toHaveBeenCalled()
})
