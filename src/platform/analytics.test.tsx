import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { toCsv } from '../lib/csv'

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

const months = (n: number) => Array.from({ length: n }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}`)

/** Вымышленные клиники: «Улыбка» (Бишкек) платит, «Жемчуг» (Ош) — пилот кончается, «Белый зуб» — падает. */
const report = (days: number): Schemas['PlatformAnalyticsAnalytics'] => ({
  days,
  cities: ['Бишкек', 'Ош'],
  summary: { clinics: 3, working: 2, pilot: 1, paying: 1, overdue: 1, mrrSom: 2490, appointments: days === 90 ? 400 : 120, appointmentsBefore: 100 },
  funnel: {
    applications: { total: 4, approved: 2, rejected: 1, waiting: 1 },
    steps: [{ key: 'CREATED', clinics: 2 }, { key: 'ADMIN', clinics: 1 }, { key: 'CONFIGURED', clinics: 1 }, { key: 'FIRST_VISIT', clinics: 1 }, { key: 'MONTH', clinics: 0 }, { key: 'PAID', clinics: 0 }],
  },
  geography: [{ city: 'Бишкек', clinics: 2, working: 2, paying: 1, patients: 300, applications: 1 }, { city: 'Талас', clinics: 0, working: 0, paying: 0, patients: 0, applications: 2 }],
  money: {
    months: months(10).map((m) => ({ month: m, paidSom: m === '2026-10' ? 7470 : 0, payments: m === '2026-10' ? 1 : 0, mrrSom: 2490 })),
    due: [{ clinicId: 2, name: 'Жемчуг', city: 'Ош', date: '2026-11-20', kind: 'PILOT_ENDS', daysLeft: 17, tariff: 'Клиника', monthSom: 2490, appointments: 30 }],
  },
  risks: [{ clinicId: 3, name: 'Белый зуб', city: 'Бишкек', plan: 'OVERDUE', last14: 2, prev14: 12, reasons: [{ code: 'FALLING', text: 'Приёмов меньше на 83%: 2 против 12' }] }],
  cohorts: [{ month: '2026-08', clinics: 2, after: [{ eligible: 2, active: 1 }, { eligible: 2, active: 1 }, { eligible: 0, active: 0 }] }],
  features: { activeClinics: 2, appointments: 120, selfBooked: 30, aiBooked: 4, items: [{ key: 'BOT', clinics: 2 }, { key: 'PLAN', clinics: 1 }, { key: 'PUSH', clinics: 0 }] },
  patients: { total: 300, withBot: 150, done: 90, noShow: 10, newByMonth: months(10).map((m) => ({ month: m, count: 5 })) },
})

test('владелец: аналитика платформы — сводка, кому звонить, риск, воронка; период меняет запрос', async () => {
  const asked: string[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json({ ...me, owner: true, platform: true })),
    http.get('*/api/platform/analytics', ({ request }) => {
      const url = new URL(request.url)
      asked.push(`${url.searchParams.get('days')}:${url.searchParams.get('city') ?? ''}`)
      return HttpResponse.json(report(Number(url.searchParams.get('days'))))
    }),
  )
  const user = userEvent.setup()
  renderApp()
  await user.click(await screen.findByRole('tab', { name: 'Аналитика' }))

  const summary = await screen.findByRole('region', { name: 'Сводка' })
  expect(summary).toHaveTextContent('Платят1')
  expect(summary).toHaveTextContent('2 490 сом')
  expect(summary).toHaveTextContent('▲ 20%')
  expect(within(screen.getByRole('table', { name: 'Оплата: кому звонить' })).getByText('Жемчуг')).toBeInTheDocument()
  expect(screen.getByRole('table', { name: 'Оплата: кому звонить' })).toHaveTextContent('через 17 дн.')
  expect(screen.getByRole('table', { name: 'Клиники в зоне риска' })).toHaveTextContent('Приёмов меньше на 83%')
  expect(screen.getByRole('list', { name: 'Шаги воронки' })).toHaveTextContent('Админ пришёл по ссылке1 · 50%')
  expect(screen.getByRole('table', { name: 'Клиники по городам' })).toHaveTextContent('Талас')
  expect(screen.getByRole('region', { name: 'Использование функций' })).toHaveTextContent('25%')
  expect(screen.getByRole('region', { name: 'Использование функций' })).toHaveTextContent('ИИ записал: 4')
  expect(screen.getByRole('table', { name: 'Когорты по месяцу подключения' })).toHaveTextContent('50% (1 из 2)')
  expect(asked).toEqual(['30:'])

  await user.click(screen.getByRole('button', { name: '90 дней' }))
  expect(await screen.findByText('400')).toBeInTheDocument()
  expect(asked).toContain('90:')
})

test('менеджер платформы аналитику не видит', async () => {
  server.use(http.get('*/api/patient/me', () => HttpResponse.json({ ...me, owner: false, platform: true })))
  renderApp()
  expect(await screen.findByRole('tab', { name: 'Клиники' })).toBeInTheDocument()
  expect(screen.queryByRole('tab', { name: 'Аналитика' })).not.toBeInTheDocument()
})

test('CSV для Excel: BOM, «;», кавычки', () => {
  expect(toCsv([['Клиника', 'Сом'], ['«Зуб; и ко»', 990]])).toBe('\uFEFFКлиника;Сом\r\n"«Зуб; и ко»";990')
})

test('пусто: оплат за год не было — текст вместо пустых столбиков; в воронке после нуля нет «—»', async () => {
  const empty = report(30)
  empty.money!.months = empty.money!.months!.map((m) => ({ ...m, paidSom: 0, payments: 0 }))
  empty.funnel!.steps = [{ key: 'CREATED', clinics: 1 }, { key: 'CONFIGURED', clinics: 0 }, { key: 'FIRST_VISIT', clinics: 1 }]
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json({ ...me, owner: true, platform: true })),
    http.get('*/api/platform/analytics', () => HttpResponse.json(empty)),
  )
  const user = userEvent.setup()
  renderApp()
  await user.click(await screen.findByRole('tab', { name: 'Аналитика' }))
  const money = await screen.findByRole('region', { name: 'Оплаты по месяцам' })
  expect(money).toHaveTextContent('Оплат за год ещё не было')
  expect(within(money).queryByRole('img')).not.toBeInTheDocument()
  expect(screen.getByRole('list', { name: 'Шаги воронки' })).toHaveTextContent('Первый приём1')
  expect(screen.getByRole('list', { name: 'Шаги воронки' })).not.toHaveTextContent('—')
})
