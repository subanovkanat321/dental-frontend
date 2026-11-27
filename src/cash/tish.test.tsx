import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp, findSub } from '../test/fixtures'
import { server } from '../test/server'

/** Только агрегаты, вымышленная клиника. */
const REPORT: Schemas['TishReportControllerTishReport'] = {
  month: '2026-11', from: '2026-11-01', to: '2026-11-18', previousFrom: '2026-10-01', previousTo: '2026-10-18', partial: true,
  current: { newPatients: 12, came: 9, revenueSom: 84000, allNewPatients: 20 },
  previous: { newPatients: 8, came: 6, revenueSom: 51000, allNewPatients: 18 },
  channels: [
    { channel: 'INSTAGRAM', newPatients: 7, came: 5, revenueSom: 50000, previousNewPatients: 3 },
    { channel: 'MINI_APP', newPatients: 4, came: 3, revenueSom: 30000, previousNewPatients: 4 },
    { channel: 'QR', newPatients: 1, came: 1, revenueSom: 4000, previousNewPatients: 0 },
    { channel: 'SITE', newPatients: 0, came: 0, revenueSom: 0, previousNewPatients: 1 },
  ],
  returned: { patients: 3, revenueSom: 27000, invited: 14, autoInvited: 9 },
}

beforeEach(() => {
  window.location.hash = '/cash'
  server.use(
    http.get('*/api/appointments/debts', () => HttpResponse.json([])),
    http.get('*/api/appointments/report', () => HttpResponse.json([])),
    http.get('*/api/appointments/sources', () => HttpResponse.json({ newPatients: [], firstVisits: 0, repeatVisits: 0 })),
    http.get('*/api/appointments/stats', () => HttpResponse.json([])),
  )
})
afterEach(() => {
  window.location.hash = ''
})

test('«Пациенты от Tish»: крупная цифра, пришли и выручка, сравнение с теми же днями прошлого месяца, каналы и как считали', async () => {
  const asked: string[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments/from-tish', ({ request }) => {
      asked.push(new URL(request.url).search)
      return HttpResponse.json(REPORT)
    }),
  )
  const user = userEvent.setup()
  renderApp()
  await user.click(await findSub('Аналитика'))

  const tish = await screen.findByRole('region', { name: 'Пациенты от Tish' })
  expect(within(tish).getByRole('heading')).toHaveTextContent('Пациенты от Tish · ноябрь')
  expect(await within(tish).findByLabelText('Новых пациентов через Tish')).toHaveTextContent('12новых пациентов через Tish — месяц идёт')
  const facts = within(tish).getByLabelText('Итоги месяца')
  expect(facts).toHaveTextContent('Пришли: 9')
  expect(facts).toHaveTextContent(/Выручка: 84\s000 сом/)
  expect(facts).toHaveTextContent('из всех новых: 12 из 20')
  // «Вернули» (идея 2): записались не позже 30 дней после «Позвать снова»
  expect(within(tish).getByLabelText('Вернули пациентов')).toHaveTextContent(/Вернули: 3 пациента · 27\s000 сом/)
  expect(within(tish).getByLabelText('Вернули пациентов')).toHaveTextContent('позвали 14, из них Tish сам — 9')
  expect(within(tish).getByLabelText('Сравнение с прошлым месяцем')).toHaveTextContent(/▲ 50% к тем же дням прошлого месяца \(1 окт – 18 окт\): было 8, пришли 6, 51\s000 сом/)
  // По каналам — только где есть новые; подписи по-русски
  const bars = within(tish).getByRole('list', { name: 'Новые пациенты по каналам' })
  expect(within(bars).getAllByRole('listitem').map((li) => li.querySelector('.hbar-name')?.textContent))
    .toEqual(['📱 Instagram', '📲 Mini App в Telegram', '🔳 QR на ресепшн'])
  expect(within(tish).getByText(/Как считали: новый пациент — первый приём в клинике в этом месяце/)).toBeInTheDocument()
  // Имён в отчёте нет — их нет и в ответе
  expect(tish).not.toHaveTextContent(/Айгуль|Бакыт/)
  expect(asked[0]).toBe('')

  // «Месяц» → отчёт за выбранный месяц
  await user.click(screen.getByRole('button', { name: 'Месяц' }))
  expect(asked.at(-1)).toMatch(/^\?month=\d{4}-\d{2}$/)
})

test('«Пациенты от Tish»: пусто — подсказка поставить ссылки; врачу без доступа к деньгам клиники плитки нет', async () => {
  server.use(http.get('*/api/patient/me', () => HttpResponse.json(me)))
  const user = userEvent.setup()
  const { unmount } = renderApp()
  await user.click(await findSub('Аналитика'))
  const tish = await screen.findByRole('region', { name: 'Пациенты от Tish' })
  expect(await within(tish).findByText('Пока никого через Tish')).toBeInTheDocument()
  expect(within(tish).getByText(/О клинике → Ссылки для записи/)).toBeInTheDocument()
  unmount()

  window.location.hash = '/cash'
  server.use(http.get('*/api/patient/me', () => HttpResponse.json({ ...me, admin: false })))
  renderApp()
  await user.click(await findSub('Аналитика'))
  await screen.findByRole('region', { name: 'Выручка за 6 месяцев' })
  expect(screen.queryByRole('region', { name: 'Пациенты от Tish' })).toBeNull()
})
