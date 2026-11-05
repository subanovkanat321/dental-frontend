import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'

/** Вымышленные пациенты: у Айгуль незаконченный план, Бакыт не пришёл. */
/** Как сервер: фильтр и страница — по запросу, счётчики — по всему списку. */
function serve(b: Schemas['ComebacksBoard']) {
  return ({ request }: { request: Request }) => {
    const q = new URL(request.url).searchParams
    const filter = q.get('filter') ?? 'ALL'
    const all = b.patients ?? []
    const shown = all.filter((c) => filter === 'ALL' || (filter === 'SENT' ? c.planSentAt : c.reason === filter))
    const sent = all.filter((c) => c.planSentAt)
    return HttpResponse.json({
      ...b, patients: shown.slice(0, Number(q.get('limit') ?? shown.length)), total: shown.length,
      sent: sent.length, agreed: sent.filter((c) => c.planAgreedAt).length,
    } satisfies Schemas['ComebacksBoard'])
  }
}

const board: Schemas['ComebacksBoard'] = {
  patients: [
    { patientId: 2, fullName: 'Айгуль Т.', phone: '996700333444', telegram: true, reason: 'PLAN', planSom: 18000,
      plan: ['зуб 36 — Коронка', 'Чистка'], lastVisit: '2026-10-10T04:00:00Z' },
    { patientId: 3, fullName: 'Бакыт М.', phone: '996555111222', telegram: false, reason: 'NO_SHOW', planSom: 0, plan: [] },
  ],
  planSom: 18000, planPatients: 1, noShows: 1, recalls: 0,
}

beforeEach(() => {
  window.location.hash = '/patients'
  vi.stubGlobal('open', vi.fn())
})
afterEach(() => {
  window.location.hash = ''
  vi.unstubAllGlobals()
})

test('«Позвать снова»: деньги на столе, «Tish вернул», приглашение в Telegram с правкой текста', async () => {
  const sent: unknown[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/patients/recent', () => HttpResponse.json([])),
    http.get('*/api/comebacks', serve(board)),
    http.get('*/api/comebacks/result', () => HttpResponse.json({ invited: 5, returned: 2, returnedPlanSom: 40000, paidSom: 12000 })),
    http.post('*/api/comebacks/2/draft', () => HttpResponse.json({ text: 'Здравствуйте, Айгуль Т.!\n\nОсталась коронка.', ai: false, lang: 'RU', telegram: true })),
    http.post('*/api/comebacks/2/invite', async ({ request }) => {
      sent.push(await request.json())
      return new HttpResponse(null, { status: 204 })
    }),
  )
  renderApp()
  await userEvent.click(await screen.findByRole('tab', { name: 'Позвать снова' }))
  const summary = await screen.findByRole('region', { name: 'Деньги на столе' })
  expect(summary).toHaveTextContent(/Незаконченные планы лечения18\s000 сом/)
  expect(screen.getByLabelText('Tish вернул')).toHaveTextContent(/вернулись 2 из 5 приглашённых · в их планах 40\s000 сом · уже оплачено 12\s000 сом/)
  const list = screen.getByRole('list', { name: 'Кого вернуть' })
  expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent('зуб 36 — Коронка · Чистка')

  // Фильтр: только неявки
  await userEvent.click(within(summary).getByRole('button', { name: /Не пришли/ }))
  expect(within(list).getAllByRole('listitem')).toHaveLength(1)
  await userEvent.click(within(summary).getByRole('button', { name: /Не пришли/ }))

  await userEvent.click(within(within(list).getAllByRole('listitem')[0]!).getByRole('button', { name: 'Пригласить' }))
  const text = await screen.findByRole('textbox', { name: 'Текст приглашения' })
  await userEvent.type(text, ' Ждём вас!')
  await userEvent.click(screen.getByRole('button', { name: '📤 В Telegram' }))
  expect(await screen.findByRole('status')).toHaveTextContent('Приглашение отправлено в Telegram')
  expect(sent).toEqual([{ text: 'Здравствуйте, Айгуль Т.!\n\nОсталась коронка. Ждём вас!', channel: 'TELEGRAM' }])
})

test('«Позвать снова»: «пора на осмотр» — последний визит, услуга, с какого дня пора; нет сроков у услуг — подсказка', async () => {
  const recallBoard: Schemas['ComebacksBoard'] = {
    patients: [{ patientId: 4, fullName: 'Нурлан К.', phone: '996555000283', telegram: false, reason: 'RECALL', planSom: 0, plan: [],
      lastVisit: '2026-04-03T04:00:00Z', recallMonths: 6, recallService: 'Профессиональная чистка', recallDueOn: '2026-10-03' }],
    planSom: 0, planPatients: 0, noShows: 0, recalls: 1,
  }
  let services: Schemas['ServiceTypeView'][] = [{ id: 1, name: 'Профессиональная чистка', durationMinutes: 60, active: true }]
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/patients/recent', () => HttpResponse.json([])),
    http.get('*/api/comebacks', serve(recallBoard)),
    http.get('*/api/comebacks/result', () => HttpResponse.json({ invited: 0, returned: 0, returnedPlanSom: 0, paidSom: 0 })),
    http.get('*/api/service-types', () => HttpResponse.json(services)),
  )
  const { unmount } = renderApp()
  await userEvent.click(await screen.findByRole('tab', { name: 'Позвать снова' }))
  const list = await screen.findByRole('list', { name: 'Кого вернуть' })
  expect(list).toHaveTextContent(/последний визит: 3 апр 2026 · Профессиональная чистка · пора с 3 октября( 2026)? \(через 6 мес\.\)/)
  const link = await screen.findByRole('link', { name: 'Настройки → Услуги' })
  expect(link).toHaveAttribute('href', '#/settings/services')
  unmount()

  // У услуги есть свой срок — подсказки нет
  services = [{ ...services[0]!, recallMonths: 6 }]
  renderApp()
  await userEvent.click(await screen.findByRole('tab', { name: 'Позвать снова' }))
  await screen.findByRole('list', { name: 'Кого вернуть' })
  expect(screen.queryByRole('link', { name: 'Настройки → Услуги' })).not.toBeInTheDocument()
})

test('«Позвать снова»: отправили план с ценами, а пациент не записался — строка статуса и фильтр', async () => {
  const sentPlan: Schemas['ComebacksBoard'] = {
    ...board,
    patients: [
      { ...board.patients![0]!, planSentAt: '2026-11-03T05:00:00Z', planAgreedAt: '2026-11-04T05:00:00Z' },
      board.patients![1]!,
    ],
  }
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/patients/recent', () => HttpResponse.json([])),
    http.get('*/api/comebacks', serve(sentPlan)),
  )
  renderApp()
  await userEvent.click(await screen.findByRole('tab', { name: 'Позвать снова' }))
  const list = await screen.findByRole('list', { name: 'Кого вернуть' })
  expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent(/план отправлен 3 нояб?\.? 2026 · согласован 4 нояб?\.? 2026 — запишите на первый этап/)
  const filter = screen.getByRole('button', { name: /Отправили план, не записались: 1 · согласились: 1/ })
  await userEvent.click(filter)
  expect(within(list).getAllByRole('listitem')).toHaveLength(1)
  expect(filter).toHaveAttribute('aria-pressed', 'true')
})

test('«Позвать снова»: по 50 за раз — «Показать ещё» догружает остальных', async () => {
  // 60 вымышленных пациентов «пора на осмотр»
  const many: Schemas['ComebacksBoard'] = {
    patients: Array.from({ length: 60 }, (_, i) => ({ patientId: 100 + i, fullName: `Пациент ${i + 1}`, phone: '996555000000',
      telegram: false, reason: 'RECALL' as const, planSom: 0, plan: [] })),
    planSom: 0, planPatients: 0, noShows: 0, recalls: 60,
  }
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/patients/recent', () => HttpResponse.json([])),
    http.get('*/api/comebacks', serve(many)),
    http.get('*/api/comebacks/result', () => HttpResponse.json({ invited: 0, returned: 0, returnedPlanSom: 0, paidSom: 0 })),
  )
  renderApp()
  await userEvent.click(await screen.findByRole('tab', { name: 'Позвать снова' }))
  const list = await screen.findByRole('list', { name: 'Кого вернуть' })
  expect(within(list).getAllByRole('listitem')).toHaveLength(50)
  await userEvent.click(screen.getByRole('button', { name: 'Показать ещё (10 из 10)' }))
  await vi.waitFor(() => expect(within(screen.getByRole('list', { name: 'Кого вернуть' })).getAllByRole('listitem')).toHaveLength(60))
  expect(screen.queryByRole('button', { name: /Показать ещё/ })).not.toBeInTheDocument()
})
