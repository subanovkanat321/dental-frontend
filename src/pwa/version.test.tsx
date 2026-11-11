import { http, HttpResponse } from 'msw'

import { server } from '../test/server'
import { waitForSlow } from '../test/wait'
import { resetPwa } from './pwa'
import { AWAY_MS, checkVersion, noteSectionLeft, quietScreen, resetVersionCheck, startVersionCheck, updateAtSafeMoment } from './version'

/** Тихое обновление: version.json новее мета сборки — перезагрузка в безопасный момент, не посреди ввода. */
let reload: ReturnType<typeof vi.fn>
let meta: HTMLMetaElement

function serverVersion(body: string | { version: string }) {
  server.use(http.get('*/version.json', () => (typeof body === 'string' ? new HttpResponse(body, { headers: { 'Content-Type': 'text/html' } }) : HttpResponse.json(body))))
}

function visibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(() => {
  resetVersionCheck()
  resetPwa()
  sessionStorage.clear()
  meta = Object.assign(document.createElement('meta'), { name: 'tish-version', content: 'old111' })
  document.head.append(meta)
  reload = vi.fn()
  vi.stubGlobal('location', { ...window.location, origin: window.location.origin, reload })
})
afterEach(() => {
  meta.remove()
  resetVersionCheck()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(document, 'visibilityState')
  document.body.innerHTML = ''
})

test('сервер отдаёт новую версию — смена раздела перезагружает, и только один раз на версию', async () => {
  serverVersion({ version: 'new222' })
  startVersionCheck()
  expect(await checkVersion()).toBe(true)
  updateAtSafeMoment()
  expect(reload).toHaveBeenCalledTimes(1)
  // Перезагрузились, а сервер всё ещё «новее» (кэш по дороге) — не крутимся
  updateAtSafeMoment()
  expect(reload).toHaveBeenCalledTimes(1)
})

test('та же версия или не JSON (nginx отдал index.html) — ничего не делаем', async () => {
  startVersionCheck()
  serverVersion({ version: 'old111' })
  expect(await checkVersion()).toBe(false)
  serverVersion('<!doctype html><html></html>')
  expect(await checkVersion()).toBe(false)
  updateAtSafeMoment()
  expect(reload).not.toHaveBeenCalled()
})

test('без мета сборки (dev, тесты) проверка выключена', async () => {
  meta.remove()
  serverVersion({ version: 'new222' })
  startVersionCheck()
  expect(await checkVersion()).toBe(false)
})

test('посреди ввода не перезагружаем: фокус в поле, открытая карточка, несохранённый раздел в фоне', async () => {
  serverVersion({ version: 'new222' })
  startVersionCheck()
  await checkVersion()
  const input = document.createElement('input')
  document.body.append(input)
  input.focus()
  expect(quietScreen()).toBe(false)
  updateAtSafeMoment()
  input.blur()
  const panel = document.createElement('div')
  panel.className = 'schedule with-panel'
  document.body.append(panel)
  updateAtSafeMoment()
  panel.remove()
  noteSectionLeft('settings', true)
  updateAtSafeMoment()
  expect(reload).not.toHaveBeenCalled()
  // Вернулись в раздел и ушли без правок — можно
  noteSectionLeft('settings', false)
  updateAtSafeMoment()
  expect(reload).toHaveBeenCalledTimes(1)
})

test('вернулись на вкладку после 5+ минут в фоне — проверка и тихая перезагрузка; после минуты — только проверка', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  let asked = 0
  server.use(http.get('*/version.json', () => { asked++; return HttpResponse.json({ version: 'new222' }) }))
  startVersionCheck()
  visibility('hidden')
  vi.setSystemTime(Date.now() + 60_000)
  visibility('visible')
  await waitForSlow(() => expect(asked).toBe(1))
  await new Promise((r) => setTimeout(r, 20))
  expect(reload).not.toHaveBeenCalled()
  visibility('hidden')
  vi.setSystemTime(Date.now() + AWAY_MS + 1000)
  visibility('visible')
  await waitForSlow(() => expect(reload).toHaveBeenCalledTimes(1))
})

test('PWA: ждущий service worker при смене раздела включается сам, без кнопки', () => {
  const worker = { postMessage: vi.fn() } as unknown as ServiceWorker
  resetPwa({ waiting: worker })
  updateAtSafeMoment()
  expect(worker.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' })
})
