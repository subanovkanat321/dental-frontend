import { http, HttpResponse } from 'msw'

import type { ClientErrorReport } from '../api/client'
import { server } from '../test/server'
import { MAX_PER_SESSION, networkErrors, reportError, resetErrorReports, section, shortUserAgent, startErrorReports } from './clientErrors'

/** Отчёты, дошедшие до «сервера», с заголовком сайта. */
function capture(): { reports: ClientErrorReport[]; headers: (string | null)[] } {
  const got = { reports: [] as ClientErrorReport[], headers: [] as (string | null)[] }
  server.use(http.post('*/web/client-error', async ({ request }) => {
    got.headers.push(request.headers.get('X-Dental-Web'))
    got.reports.push(await request.json() as ClientErrorReport)
    return new HttpResponse(null, { status: 204 })
  }))
  return got
}

/** Дать fetch и MSW отработать. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50))

beforeEach(() => {
  resetErrorReports()
  window.location.hash = ''
})

test('отклонённый промис — отчёт с заголовком сайта, разделом и без данных из состояния', async () => {
  const got = capture()
  startErrorReports()
  window.location.hash = '/patients/123'
  // Промис отклонили объектом с данными пациента — его содержимое не отправляется
  const event = new Event('unhandledrejection') as Event & { reason: unknown }
  event.reason = { fullName: 'Вымышленный Пациент', phone: '0555 000 111' }
  window.dispatchEvent(event)
  const error = PromiseRejectionEventLike(new TypeError("Cannot read properties of undefined (reading 'map')"))
  window.dispatchEvent(error)
  await settle()

  expect(got.headers).toEqual(['1', '1'])
  expect(got.reports[0]).toMatchObject({ message: 'Отклонено без Error: Object', section: 'patients', stack: '' })
  expect(JSON.stringify(got.reports)).not.toContain('0555')
  expect(JSON.stringify(got.reports)).not.toContain('Вымышленный')
  expect(got.reports[1]!.message).toBe("TypeError: Cannot read properties of undefined (reading 'map')")
  expect(got.reports[1]!.platform).toBe('browser-desktop')
})

test('шум не отправляется: ResizeObserver, расширения, отменённый запрос, ошибка запроса, обрыв сети', async () => {
  const got = capture()
  reportError(new Error('ResizeObserver loop completed with undelivered notifications.'))
  reportError('Script error.')
  reportError(new Error('boom'), { filename: 'chrome-extension://abc/content.js' })
  reportError(new DOMException('The user aborted a request.', 'AbortError'))
  const apiError = new Error('Сессия устарела')
  apiError.name = 'ApiError'
  reportError(apiError)
  reportError(new TypeError('Failed to fetch'))
  reportError(new TypeError('Load failed'))
  await settle()

  expect(got.reports).toEqual([])
  expect(networkErrors()).toBe(2)
})

test('не больше 5 отчётов за сессию, одинаковые — один раз', async () => {
  const got = capture()
  // Одна и та же ошибка — тот же текст и то же место в коде
  const same = () => new Error('одна и та же')
  reportError(same())
  reportError(same())
  for (let i = 0; i < 10; i++) reportError(new Error(`ошибка ${i}`))
  await settle()

  expect(got.reports).toHaveLength(MAX_PER_SESSION)
  expect(got.reports.map((r) => r.message)).toEqual(['Error: одна и та же', 'Error: ошибка 0', 'Error: ошибка 1', 'Error: ошибка 2', 'Error: ошибка 3'])
})

test('раздел — только слова из адреса, без номеров и параметров', () => {
  expect(section({ pathname: '/', hash: '' })).toBe('schedule')
  expect(section({ pathname: '/', hash: '#/settings/hours' })).toBe('settings/hours')
  expect(section({ pathname: '/', hash: '#/patients/42?tab=files' })).toBe('patients')
  expect(section({ pathname: '/c/abc123', hash: '#book' })).toBe('c/book')
})

test('браузер — коротко', () => {
  expect(shortUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'))
    .toBe('iPhone OS 17_4 · Safari 17')
  expect(shortUserAgent('Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36'))
    .toBe('Android 14 · Chrome 129')
})

/** jsdom не знает PromiseRejectionEvent — событие с полем reason. */
function PromiseRejectionEventLike(reason: unknown): Event {
  const event = new Event('unhandledrejection') as Event & { reason: unknown }
  event.reason = reason
  return event
}
