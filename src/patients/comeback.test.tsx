import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp, findSub } from '../test/fixtures'
import { server } from '../test/server'
import { waitForSlow } from '../test/wait'

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
  planSom: 18000, planPatients: 1, noShows: 1, recalls: 0, total: 0, sent: 0, agreed: 0, cancelled: 0
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
  await userEvent.click(await findSub('Позвать снова'))
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
    planSom: 0, planPatients: 0, noShows: 0, recalls: 1, total: 0, sent: 0, agreed: 0, cancelled: 0
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
  await userEvent.click(await findSub('Позвать снова'))
  const list = await screen.findByRole('list', { name: 'Кого вернуть' })
  expect(list).toHaveTextContent(/последний визит: 3 апр 2026 · Профессиональная чистка · пора с 3 октября( 2026)? \(через 6 мес\.\)/)
  const link = await screen.findByRole('link', { name: 'Клиника → Услуги и цены' })
  expect(link).toHaveAttribute('href', '#/clinic/services')
  unmount()

  // У услуги есть свой срок — подсказки нет
  services = [{ ...services[0]!, recallMonths: 6 }]
  renderApp()
  await userEvent.click(await findSub('Позвать снова'))
  await screen.findByRole('list', { name: 'Кого вернуть' })
  expect(screen.queryByRole('link', { name: 'Клиника → Услуги и цены' })).not.toBeInTheDocument()
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
  await userEvent.click(await findSub('Позвать снова'))
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
    planSom: 0, planPatients: 0, noShows: 0, recalls: 60, total: 0, sent: 0, agreed: 0, cancelled: 0
  }
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/patients/recent', () => HttpResponse.json([])),
    http.get('*/api/comebacks', serve(many)),
    http.get('*/api/comebacks/result', () => HttpResponse.json({ invited: 0, returned: 0, returnedPlanSom: 0, paidSom: 0 })),
  )
  renderApp()
  await userEvent.click(await findSub('Позвать снова'))
  const list = await screen.findByRole('list', { name: 'Кого вернуть' })
  expect(within(list).getAllByRole('listitem')).toHaveLength(50)
  await userEvent.click(screen.getByRole('button', { name: 'Показать ещё (10 из 10)' }))
  await waitForSlow(() => expect(within(screen.getByRole('list', { name: 'Кого вернуть' })).getAllByRole('listitem')).toHaveLength(60))
  expect(screen.queryByRole('button', { name: /Показать ещё/ })).not.toBeInTheDocument()
})

/** Вымышленная Динара сама отменила чистку у Дастана 3 дня назад и не перезаписалась. */
function cancelledBoard(): Schemas['ComebacksBoard'] {
  const day = 86_400_000
  return {
    patients: [{ patientId: 5, fullName: 'Динара Ж.', phone: '996555000295', telegram: false, reason: 'CANCELLED', planSom: 0, plan: [],
      doctorId: 2, cancelled: { at: new Date(Date.now() - 3 * day).toISOString(), source: 'PATIENT', serviceId: 9, service: 'Чистка',
        doctorId: 2, doctor: 'Дастан Т.', startAt: '2026-11-08T05:00:00Z', minutes: 60 } }],
    planSom: 0, planPatients: 0, noShows: 0, recalls: 0, cancelled: 1, total: 0, sent: 0, agreed: 0
  }
}

function cancelledBackend() {
  const skipped: number[] = []
  let board = cancelledBoard()
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/patients/recent', () => HttpResponse.json([])),
    http.get('*/api/comebacks', ({ request }) => serve(board)({ request })),
    http.get('*/api/comebacks/result', () => HttpResponse.json({ invited: 0, returned: 0, returnedPlanSom: 0, paidSom: 0 })),
    http.post('*/api/comebacks/5/skip', () => {
      skipped.push(5)
      board = { ...board, patients: [], cancelled: 0 }
      return new HttpResponse(null, { status: 204 })
    }),
  )
  return skipped
}

test('«Позвать снова» → «Отменили и не записались»: строка, «Напомнить» в WhatsApp готовым текстом, «Не звать»', async () => {
  const skipped = cancelledBackend()
  const opened: string[] = []
  vi.stubGlobal('open', vi.fn((url: string) => { opened.push(String(url)); return null }))
  const text = 'Здравствуйте, Динара Ж.! Вы отменяли запись на Чистка в Стоматология «Тест». Подберём удобное время? Записаться: https://tish.test/c/test#book'
  const sent: unknown[] = []
  server.use(
    http.post('*/api/comebacks/5/draft', () => HttpResponse.json({ text, ai: false, lang: 'RU', telegram: false })),
    http.post('*/api/comebacks/5/invite', async ({ request }) => {
      sent.push(await request.json())
      return HttpResponse.json({ text: `🦷 Приглашение от клиники\n\n${text}`, telegram: false })
    }),
  )
  renderApp()
  await userEvent.click(await findSub('Позвать снова'))
  const summary = await screen.findByRole('region', { name: 'Деньги на столе' })
  const group = within(summary).getByRole('button', { name: /Отменили и не записались/ })
  expect(group).toHaveTextContent('1')
  await userEvent.click(group)
  expect(group).toHaveAttribute('aria-pressed', 'true')
  const row = within(screen.getByRole('list', { name: 'Кого вернуть' })).getAllByRole('listitem')[0]!
  expect(row).toHaveTextContent('Отменил запись')
  expect(row).toHaveTextContent('отменил пациент в боте · 3 дня назад')
  expect(row).toHaveTextContent(/был записан: Чистка · Дастан Т\. · 8 нояб?\.?, \d\d:\d\d/)

  await userEvent.click(within(row).getByRole('button', { name: 'Напомнить' }))
  const box = await screen.findByRole('textbox', { name: 'Текст приглашения' })
  expect(box).toHaveValue(text)
  expect(screen.getByText(/Готовый текст — можно поправить/)).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'WhatsApp' }))
  expect(await screen.findByRole('status')).toHaveTextContent('Открыли WhatsApp с текстом')
  expect(sent).toEqual([{ text, channel: 'WHATSAPP' }])
  expect(opened[0]).toContain('996555000295')
  expect(decodeURIComponent(opened[0]!)).toContain('Вы отменяли запись на Чистка')
  await userEvent.click(screen.getByRole('button', { name: 'Готово' }))

  await userEvent.click(within(screen.getByRole('list', { name: 'Кого вернуть' })).getByRole('button', { name: 'Не звать' }))
  await waitForSlow(() => expect(skipped).toEqual([5]))
  expect(await screen.findByText('Звать некого')).toBeInTheDocument()
})

test('«Отменили»: «Записать» — «Новая запись» с этим пациентом, врачом и услугой отменённой записи', async () => {
  cancelledBackend()
  const dinara = { id: 5, fullName: 'Динара Ж.', phone: '996555000295', telegram: false }
  server.use(
    http.get('*/api/appointments', () => HttpResponse.json([])),
    http.get('*/api/appointments/debts', () => HttpResponse.json([])),
    http.get('*/api/waitlist', () => HttpResponse.json([])),
    http.get('*/api/appointments/by-patient/5', () => HttpResponse.json({ patient: dinara, done: 1, noShow: 0, cancelled: 1, upcoming: [], past: [] })),
    http.get('*/api/service-types', () => HttpResponse.json([{ id: 9, name: 'Чистка', durationMinutes: 45, active: true },
      { id: 10, name: 'Пломба', durationMinutes: 30, active: true }])),
  )
  renderApp()
  await userEvent.click(await findSub('Позвать снова'))
  const list = await screen.findByRole('list', { name: 'Кого вернуть' })
  await userEvent.click(within(list).getByRole('button', { name: 'Записать' }))
  const form = await screen.findByRole('complementary', { name: 'Новая запись' })
  expect(form).toHaveTextContent('Динара Ж.')
  expect(within(form).getByRole('combobox', { name: 'Врач' })).toHaveTextContent('Дастан Т.')
  expect(await within(form).findByRole('button', { name: /Чистка/ })).toHaveAttribute('aria-pressed', 'true')
})
