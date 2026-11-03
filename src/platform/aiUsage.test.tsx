import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'

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

const report = {
  month: '2026-11', actions: 42, usd: 3.5, som: 341, platformUsd: 0.25,
  settings: { perDoctor: 300, somPerUsd: 87, vatPercent: 12 },
  clinics: [
    { clinicId: 1, name: 'Стоматология «Тест»', actions: 40, errors: 1, inputTokens: 1_200_000, outputTokens: 80_000, cacheReadTokens: 0,
      cacheWriteTokens: 0, usd: 3.25, som: 317, used: 39, limit: 600, doctors: 2, tariffSom: 2490, free: false },
    { clinicId: 2, name: 'Кабинет «Пилот»', actions: 0, errors: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
      usd: 0, som: 0, used: 0, limit: 50, customLimit: 50, doctors: 1, tariffSom: 990, free: true },
  ],
  kinds: [{ kind: 'VISIT_REPORT', label: 'Отчёт после приёма', actions: 30, errors: 0, inputTokens: 1, outputTokens: 1, usd: 2.5, som: 244 },
    { kind: 'SUPPORT', label: 'Помощник техподдержки', actions: 2, errors: 0, inputTokens: 1, outputTokens: 1, usd: 0.25, som: 24 }],
  days: [{ date: '2026-11-02', actions: 42, usd: 3.5, som: 341 }],
} satisfies Schemas['AiUsageStoreReport']

test('владелец: «Расход ИИ» — итог в $ и сомах, клиники с тарифом, свой лимит клинике', async () => {
  const limits: unknown[] = []
  const months: (string | null)[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(owner)),
    http.get('*/api/platform/ai-usage', ({ request }) => {
      months.push(new URL(request.url).searchParams.get('month'))
      return HttpResponse.json(report)
    }),
    http.put('*/api/platform/ai-usage/clinics/:id/limit', async ({ params, request }) => {
      limits.push([params.id, await request.json()])
      return new HttpResponse(null, { status: 204 })
    }),
  )
  const user = userEvent.setup()
  renderApp()
  await user.click(await screen.findByRole('tab', { name: 'Расход ИИ' }))
  expect(await screen.findByText(/Всего:/)).toHaveTextContent('Всего: $3.50 · 341 сом · 42 запросов к ИИ')
  expect(screen.getByText(/по курсу 87 сом за \$1 и с НДС 12%/)).toHaveTextContent('Помощник техподдержки платформы: $0.2500')
  const table = screen.getByRole('table', { name: 'Расход ИИ по клиникам' })
  const first = within(table).getByRole('row', { name: /Стоматология «Тест»/ })
  expect(first).toHaveTextContent('39 / 600')
  expect(first).toHaveTextContent('1,2 млн / 80,0 тыс.')
  expect(first).toHaveTextContent('317 сом')
  expect(first).toHaveTextContent('2 490 сом')
  const pilot = within(table).getByRole('row', { name: /Кабинет «Пилот»/ })
  expect(pilot).toHaveTextContent('0 / 50 (свой)')
  expect(pilot).toHaveTextContent('пилот, 0 сом')
  expect(screen.getByRole('list', { name: 'Расход ИИ по видам действий' })).toHaveTextContent('Отчёт после приёма')
  expect(screen.getByRole('list', { name: 'Расход ИИ по дням' })).toHaveTextContent('02.11')
  expect(months[0]).toMatch(/^\d{4}-\d{2}$/)

  await user.click(within(first).getByRole('button', { name: 'Изменить лимит' }))
  const form = within(first).getByRole('form', { name: 'Лимит ИИ: Стоматология «Тест»' })
  const input = within(form).getByRole('spinbutton', { name: 'Действий в месяц' })
  await user.clear(input)
  await user.type(input, '1000')
  await user.click(within(form).getByRole('button', { name: 'Сохранить' }))
  await vi.waitFor(() => expect(limits).toEqual([['1', { monthly: 1000 }]]))

  // Свой лимит — вернуть «по умолчанию»
  await user.click(within(pilot).getByRole('button', { name: 'Изменить лимит' }))
  await user.click(within(pilot).getByRole('button', { name: 'По умолчанию' }))
  await vi.waitFor(() => expect(limits).toHaveLength(2))
  expect(limits[1]).toEqual(['2', {}])
})

test('менеджер платформы не видит «Расход ИИ»', async () => {
  server.use(http.get('*/api/patient/me', () => HttpResponse.json({ doctor: false, platform: true, owner: false, fullName: 'Мира' })))
  renderApp()
  expect(await screen.findByRole('tab', { name: 'Клиники' })).toBeInTheDocument()
  expect(screen.queryByRole('tab', { name: 'Расход ИИ' })).not.toBeInTheDocument()
})
