import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp, findSub, querySub } from '../test/fixtures'
import { server } from '../test/server'
import { mbText, uptimeText } from './serverHealth'

beforeEach(() => {
  window.location.hash = '/platform'
  server.use(
    http.get('*/web/config', () => HttpResponse.json({ botUsername: 'tish_test_bot' })),
    http.get('*/api/platform/clinics', () => HttpResponse.json([])),
    http.get('*/api/platform/applications', () => HttpResponse.json([])),
    http.get('*/api/platform/agreements/statuses', () => HttpResponse.json({})),
    http.get('*/api/platform/pay-requests', () => HttpResponse.json([])),
  )
})
afterEach(() => {
  window.location.hash = ''
})

const owner = { ...me, owner: true, platform: true }

const health = {
  checkedAt: '2026-11-06T10:00:00Z',
  app: { version: '0.0.1-SNAPSHOT', commit: 'abc1234', builtAt: '2026-11-06T08:00:00Z', startedAt: '2026-11-05T08:00:00Z',
    uptimeSeconds: 93784, java: '25+36 (Eclipse Adoptium)', heapUsedMb: 120, heapMaxMb: 384, cpuPercent: 3, processors: 2,
    disk: { path: '/app/logs', totalMb: 51200, freeMb: 5120, usedPercent: 90 } },
  db: { up: true, queryMs: 2, sizeMb: 300, connections: 7, poolActive: 1, poolMax: 10 },
  backup: { lastAt: '2026-11-04T09:15:00Z', sizeMb: 50, offsite: true, ageHours: 48, stale: true },
  jobs: [
    { name: 'Напоминания пациентам о завтрашнем приёме', code: 'AutoReminders', schedule: '0 0 18 * * *', lastRunAt: '2026-11-05T12:00:00Z',
      status: 'SUCCESS', nextRunAt: '2026-11-06T12:00:00Z' },
    { name: 'Сводки и предупреждения врачам', code: 'NotifySchedule', schedule: 'каждые 1 мин', status: 'ERROR', error: 'TelegramException',
      lastRunAt: '2026-11-06T09:59:00Z', nextRunAt: '2026-11-06T10:00:00Z' },
  ],
  telegram: { mode: 'webhook', webhookSet: true, pendingUpdates: 3, lastErrorAt: '2026-11-06T09:30:00Z', lastError: 'Wrong response from the webhook: 502 Bad Gateway' },
  sms: { configured: true, lastSentAt: '2026-11-06T07:00:00Z' },
  ai: { configured: true, lastOkAt: '2026-11-06T09:00:00Z', errors24h: 1, lastErrorAt: '2026-11-06T08:00:00Z', lastError: 'AnthropicIoException' },
  errors: { total24h: 4, top: [{ method: 'GET', path: '/api/patients/{id}', exception: 'java.lang.IllegalStateException', count: 4,
    lastAt: '2026-11-06T09:40:00Z', lastRequestId: '3f9a2c41b7d0' }] },
  files: { storage: 'R2', moved: 1840, total: 2210, trash: 12, lastErrorAt: '2026-11-06T09:10:00Z', lastError: 'SdkClientException' },
  problems: [
    { code: 'DISK', text: 'Диск сервера занят на 90% (свободно 5120 МБ).' },
    { code: 'BACKUP', text: 'Последний бэкап базы — 48 ч назад.' },
  ],
} satisfies Schemas['HealthServiceHealth']

test('владелец: «Здоровье» — проблемы сверху, база, бэкап, Telegram, ошибки и задачи', async () => {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(owner)),
    http.get('*/api/platform/health', () => HttpResponse.json(health)),
  )
  const user = userEvent.setup()
  renderApp()
  await user.click(await findSub('Здоровье'))

  const alert = await screen.findByRole('alert', { name: 'Сейчас не так' })
  expect(alert).toHaveTextContent('Диск сервера занят на 90%')
  expect(alert).toHaveTextContent('Последний бэкап базы — 48 ч назад')

  const app = screen.getByRole('table', { name: 'Приложение и база' })
  expect(within(app).getByRole('row', { name: /Работает/ })).toHaveTextContent('1 д 2 ч')
  expect(within(app).getByRole('row', { name: /Версия/ })).toHaveTextContent('коммит abc1234')
  expect(within(app).getByRole('row', { name: /Диск/ })).toHaveTextContent('занято 90% · свободно 5,0 ГБ из 50,0 ГБ')
  expect(within(app).getByRole('row', { name: /База/ })).toHaveTextContent('отвечает за 2 мс · 300 МБ · соединений 7')
  expect(within(app).getByRole('row', { name: /Последний бэкап/ })).toHaveTextContent('48 ч назад · 50 МБ · копия в R2 ушла')
  // Файлы (R2): где хранятся, сколько перенесено из базы, корзина и последняя ошибка
  const files = within(app).getByRole('row', { name: /Файлы/ })
  expect(files).toHaveTextContent('R2 · перенесено 1840 из 2210 · в корзине 12')
  expect(files).toHaveTextContent('ошибка 6 нояб, 15:10: SdkClientException')

  const links = screen.getByRole('table', { name: 'Связи' })
  expect(within(links).getByRole('row', { name: /Telegram/ })).toHaveTextContent('ждут доставки 3')
  expect(within(links).getByRole('row', { name: /Telegram/ })).toHaveTextContent('502 Bad Gateway')
  expect(within(links).getByRole('row', { name: /ИИ/ })).toHaveTextContent('ошибок за сутки 1')

  const errors = screen.getByRole('table', { name: 'Ошибки сервера за сутки' })
  expect(within(errors).getByRole('row', { name: /patients/ })).toHaveTextContent('GET /api/patients/{id}')
  expect(within(errors).getByRole('row', { name: /patients/ })).toHaveTextContent('3f9a2c41b7d0')

  const jobs = screen.getByRole('table', { name: 'Задачи по расписанию' })
  expect(within(jobs).getByRole('row', { name: /Сводки/ })).toHaveTextContent('ошибка')
  expect(within(jobs).getByRole('row', { name: /Сводки/ })).toHaveTextContent('TelegramException')
})

test('поиск по номеру запроса: строки лога со стеком; неверный номер — ошибка под полем', async () => {
  const asked: (string | null)[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(owner)),
    http.get('*/api/platform/health', () => HttpResponse.json({ ...health, problems: [] })),
    http.get('*/api/platform/health/logs', ({ request }) => {
      const id = new URL(request.url).searchParams.get('requestId')
      asked.push(id)
      if (id === 'bad') {
        return HttpResponse.json({ status: 422, title: 'Unprocessable Content', detail: 'Проверьте поля формы',
          errors: [{ field: 'requestId', message: 'Номер запроса — 8–64 латинских букв, цифр или дефисов, как в оповещении' }] },
        { status: 422, headers: { 'Content-Type': 'application/problem+json' } })
      }
      return HttpResponse.json({ available: true, requestId: id!, truncated: false, files: ['dental.log'], lines: [
        { time: '2026-11-06T09:40:00Z', level: 'INFO', logger: 'kg.dental.patient.PatientService', message: 'Открыта карточка' },
        { time: '2026-11-06T09:40:01Z', level: 'ERROR', logger: 'kg.dental.ops.internal.RequestIdFilter', message: 'Запрос GET упал',
          error: 'java.lang.IllegalStateException', stack: 'at kg.dental.X.y(X.java:1)' },
      ] } satisfies Schemas['LogSearchResult'])
    }),
  )
  const user = userEvent.setup()
  renderApp()
  await user.click(await findSub('Здоровье'))
  expect(await screen.findByRole('status')).toHaveTextContent('Всё в порядке')

  const form = screen.getByRole('form', { name: 'Поиск по номеру запроса' })
  await user.type(within(form).getByLabelText('Номер запроса'), ' 3f9a2c41b7d0 ')
  await user.click(within(form).getByRole('button', { name: 'Найти строки лога' }))
  const lines = await screen.findByRole('table', { name: 'Строки лога' })
  expect(asked).toEqual(['3f9a2c41b7d0'])
  expect(within(lines).getAllByRole('row')).toHaveLength(2)
  expect(within(lines).getAllByRole('row')[1]).toHaveTextContent('java.lang.IllegalStateException')
  expect(within(lines).getByText('Стек')).toBeInTheDocument()

  await user.clear(within(form).getByLabelText('Номер запроса'))
  await user.type(within(form).getByLabelText('Номер запроса'), 'bad')
  await user.click(within(form).getByRole('button', { name: 'Найти строки лога' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Номер запроса — 8–64')
})

test('менеджер платформы вкладку «Здоровье» не видит', async () => {
  server.use(http.get('*/api/patient/me', () => HttpResponse.json({ ...me, owner: false, platform: true })))
  renderApp()
  expect(await findSub('Клиники')).toBeInTheDocument()
  expect(querySub('Здоровье')).not.toBeInTheDocument()
})

test('время работы и размеры — коротко', () => {
  expect(uptimeText(93784)).toBe('1 д 2 ч')
  expect(uptimeText(5400)).toBe('1 ч 30 мин')
  expect(uptimeText(59)).toBe('0 мин')
  expect(mbText(300)).toBe('300 МБ')
  expect(mbText(1536)).toBe('1,5 ГБ')
})
