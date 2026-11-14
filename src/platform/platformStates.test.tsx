import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp, findSub, openPlatform } from '../test/fixtures'
import { server } from '../test/server'

// «Платформа»: пустые состояния и ошибки по вкладкам (полировка 2026-11-14). Клиники вымышленные.

const owner = { ...me, owner: true, platform: true }
const fail = () => HttpResponse.json({ title: 'Internal Server Error', status: 500, detail: 'Сервер упал' }, { status: 500 })

beforeEach(() => {
  window.location.hash = '/platform'
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(owner)),
    http.get('*/web/config', () => HttpResponse.json({ botUsername: 'tish_test_bot' })),
    http.get('*/api/platform/clinics', () => HttpResponse.json([])),
    http.get('*/api/platform/applications', () => HttpResponse.json([])),
    http.get('*/api/platform/agreements/statuses', () => HttpResponse.json({})),
    http.get('*/api/platform/pay-requests', () => HttpResponse.json([])),
    http.get('*/api/platform/funnel', () => HttpResponse.json({ total: 0, stages: [], leads: [] } satisfies Schemas['SalesFunnelFunnel'])),
  )
})
afterEach(() => {
  window.location.hash = ''
})

test('«Клиники» без клиник: «Клиник пока нет», «＋ Создать клинику» в шапке списка; воронка пустая — без переключателя «Все · 0»', async () => {
  renderApp()
  const list = await screen.findByRole('region', { name: 'Клиники' })
  expect(await within(list).findByText('Клиник пока нет')).toBeInTheDocument()
  expect(within(list).getByRole('button', { name: '＋ Создать клинику' })).toBeInTheDocument()
  expect(within(list).queryByRole('group', { name: 'Города' })).not.toBeInTheDocument()
  const funnel = screen.getByRole('region', { name: 'Воронка продаж' })
  expect(await within(funnel).findByText('В воронке пока никого')).toBeInTheDocument()
  expect(within(funnel).queryByRole('group', { name: 'Этап' })).not.toBeInTheDocument()
  expect(within(funnel).getByRole('button', { name: '＋ В воронку' })).toBeInTheDocument()
})

test('«Обращения» с ошибкой 500: текст ошибки, а не «Обращений пока нет»', async () => {
  server.use(http.get('*/api/platform/support/tickets', fail))
  const user = userEvent.setup()
  renderApp()
  await openPlatform('Обратная связь', 'Обращения', user)
  expect(await screen.findByText(/Обращения не загрузились/)).toBeInTheDocument()
  expect(screen.queryByText('Обращений пока нет')).not.toBeInTheDocument()
})

test('«Написать клиникам» пустой: пустое состояние, без «Следующая клиника» и фильтра «Все · 0»', async () => {
  server.use(http.get('*/api/platform/outreach', () => HttpResponse.json({ leads: [], template: { text: 'Здравствуйте', custom: false } })))
  const user = userEvent.setup()
  renderApp()
  await openPlatform('Рассылка клиникам', 'По одной (WhatsApp)', user)
  expect(await screen.findByText('Список клиник пуст')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Следующая клиника →' })).not.toBeInTheDocument()
  expect(screen.queryByRole('textbox', { name: 'Поиск по названию' })).not.toBeInTheDocument()
})

test('«Расход ИИ»: месяц без расхода — пустое состояние вместо таблицы; строка клиники открывает свой лимит', async () => {
  const report = (clinics: Schemas['AiUsageStoreClinicRow'][]) => ({
    month: '2026-11', actions: 0, usd: 0, som: 0, platformUsd: 0, settings: { perDoctor: 300, somPerUsd: 87, vatPercent: 12 }, clinics, kinds: [], days: [],
  })
  let clinics: Schemas['AiUsageStoreClinicRow'][] = []
  server.use(http.get('*/api/platform/ai-usage', () => HttpResponse.json(report(clinics))))
  const user = userEvent.setup()
  const { unmount } = renderApp()
  await user.click(await findSub('Расход ИИ'))
  expect(await screen.findByText('В этом месяце ИИ не пользовались')).toBeInTheDocument()
  expect(screen.queryByRole('table', { name: 'Расход ИИ по клиникам' })).not.toBeInTheDocument()
  unmount()

  clinics = [{ clinicId: 1, name: 'Стоматология «Тест»', actions: 3, errors: 0, inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0,
    usd: 0.1, som: 9, used: 3, limit: 600, doctors: 2, tariffSom: 2490, free: false }]
  renderApp()
  const row = within(await screen.findByRole('table', { name: 'Расход ИИ по клиникам' })).getByRole('row', { name: /Стоматология «Тест»/ })
  await user.click(within(row).getByText('3 / 600'))
  expect(within(row).queryByRole('button', { name: 'Изменить лимит' })).not.toBeInTheDocument()
})

test('«Контент» с ошибкой плана: ошибка, а не «В этом месяце постов нет»', async () => {
  server.use(
    http.get('*/api/platform/content', fail),
    http.get('*/api/platform/content/settings', () => HttpResponse.json({ reelsAuto: false, storiesAuto: false })),
    http.get('*/api/platform/content/instagram', () => HttpResponse.json({ enabled: false })),
  )
  const user = userEvent.setup()
  renderApp()
  await openPlatform('Маркетинг', 'Контент-план', user)
  expect(await screen.findByText(/План не загрузился/)).toBeInTheDocument()
  expect(screen.queryByText('В этом месяце постов нет')).not.toBeInTheDocument()
})
