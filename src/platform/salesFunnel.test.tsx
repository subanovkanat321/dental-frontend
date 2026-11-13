import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp } from '../test/fixtures'
import { choose } from '../test/select'
import { server } from '../test/server'
import { waitForSlow } from '../test/wait'

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

const lead = (id: number, clinicName: string, extra: Partial<Schemas['SalesFunnelLead']> = {}): Schemas['SalesFunnelLead'] => ({
  id, clinicName, contactName: 'Айбек', phone: '996555000091', city: 'Бишкек', status: 'NEW', stage: 'LEAD',
  stageAt: '2026-11-01T06:00:00Z', createdAt: '2026-11-01T06:00:00Z', solo: false, ...extra,
})

test('воронка: счётчики с конверсией, фильтр по этапу и следующий шаг', async () => {
  const stages: Schemas['SalesFunnelStageCount'][] = [
    { stage: 'LEAD', current: 1, reached: 4, conversion: 100 }, { stage: 'CONTACTED', current: 1, reached: 3, conversion: 75 },
    { stage: 'DEMO', current: 1, reached: 2, conversion: 50 }, { stage: 'TRIAL', current: 0, reached: 1, conversion: 25 },
    { stage: 'PAYING', current: 1, reached: 1, conversion: 25 }, { stage: 'LOST', current: 0, reached: 0, conversion: 0 }]
  const leads = [lead(1, 'Улыбка'), lead(2, 'Дент', { stage: 'DEMO', nextStep: 'позвонить', nextStepOn: '2020-01-10' }),
    lead(3, 'Альфа', { stage: 'CONTACTED' }), lead(4, 'Бета', { stage: 'PAYING' })]
  let filter: string | null = null
  let saved: unknown = null
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(owner)),
    http.get('*/api/platform/funnel', ({ request }) => {
      filter = new URL(request.url).searchParams.get('stage')
      return HttpResponse.json({ total: 4, stages, leads: leads.filter((l) => !filter || l.stage === filter) } satisfies Schemas['SalesFunnelFunnel'])
    }),
    http.put('*/api/platform/funnel/2', async ({ request }) => {
      saved = await request.json()
      return HttpResponse.json(lead(2, 'Дент', { stage: 'CONTACTED' }))
    }),
  )
  const user = userEvent.setup()
  renderApp()
  const block = await screen.findByRole('region', { name: 'Воронка продаж' })
  const tabs = await within(block).findByRole('group', { name: 'Этап' })
  expect(await within(tabs).findByRole('button', { name: /Все · 4/ })).toBeInTheDocument()
  expect(within(tabs).getByRole('button', { name: /Связались/ })).toHaveTextContent('Связались · 1 75%')
  expect(within(tabs).getByRole('button', { name: /Платит/ })).toHaveTextContent('Платит · 1 25%')
  // Просроченный шаг — видно сразу
  expect(within(block).getByText(/Дальше: позвонить · 10\.01 \(просрочено\)/)).toBeInTheDocument()

  await user.click(within(tabs).getByRole('button', { name: /Демо показали/ }))
  await waitForSlow(() => expect(filter).toBe('DEMO'))
  expect(await within(block).findByRole('listitem', { name: 'Лид: Дент' })).toBeInTheDocument()
  expect(within(block).queryByRole('listitem', { name: 'Лид: Улыбка' })).not.toBeInTheDocument()

  const card = within(block).getByRole('listitem', { name: 'Лид: Дент' })
  await user.click(within(card).getByRole('button', { name: 'Изменить этап и шаг' }))
  await choose(within(card).getByRole('combobox', { name: 'Этап' }), 'Связались')
  await user.clear(within(card).getByRole('textbox', { name: 'Следующий шаг' }))
  await user.type(within(card).getByRole('textbox', { name: 'Следующий шаг' }), 'показать демо')
  await user.clear(within(card).getByLabelText('Когда'))
  await user.type(within(card).getByLabelText('Когда'), '2026-11-12')
  await user.click(within(card).getByRole('button', { name: 'Сохранить' }))
  await waitForSlow(() => expect(saved).toEqual({ stage: 'CONTACTED', nextStep: 'показать демо', nextStepOn: '2026-11-12' }))
})

test('воронка: вернуться ко всем лидам после фильтра', async () => {
  const leads = [lead(1, 'Улыбка'), lead(2, 'Дент', { stage: 'DEMO' })]
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(owner)),
    http.get('*/api/platform/funnel', ({ request }) => {
      const stage = new URL(request.url).searchParams.get('stage')
      return HttpResponse.json({ total: 2, stages: [{ stage: 'LEAD', current: 1, reached: 2, conversion: 100 }, { stage: 'DEMO', current: 1, reached: 1, conversion: 50 }],
        leads: leads.filter((l) => !stage || l.stage === stage) } satisfies Schemas['SalesFunnelFunnel'])
    }),
  )
  const user = userEvent.setup()
  renderApp()
  const block = await screen.findByRole('region', { name: 'Воронка продаж' })
  const tabs = await within(block).findByRole('group', { name: 'Этап' })
  await user.click(within(tabs).getByRole('button', { name: /Демо показали/ }))
  await waitForSlow(() => expect(within(block).queryByRole('listitem', { name: 'Лид: Улыбка' })).not.toBeInTheDocument())
  await user.click(within(tabs).getByRole('button', { name: /^Все/ }))
  expect(await within(block).findByRole('listitem', { name: 'Лид: Улыбка' }, { timeout: 3000 })).toBeInTheDocument()
})
