import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { priorityGroups, priorityGrouped, suggestPriority } from '../lib/planPriority'
import { findSub, me, renderApp, medTab, openMedicalTab } from '../test/fixtures'
import { server } from '../test/server'
import { PlanPage } from '../site/PlanPage'
import { stepMenuItem } from '../test/planStep'

type Step = Schemas['TreatmentStepView']
type Plan = Schemas['PlanOffersPatientPlan']
type Candidate = Schemas['ComebacksCandidate']

/**
 * Срочность этапа плана (V267 бэкенда): выбор «🔴 Срочно · 🟡 Желательно · 🟢 Можно позже» в «Что сделать» и в правке,
 * группы с суммой (со скидкой этапа) в редакторе, план только из «Желательно» — без групп, страница плана пациента (ru/ky),
 * «🔴 есть срочное» в «Позвать снова». Пациенты и цены вымышленные; сервер — MSW (порядок — как у сервера: срочность, этап).
 */
const SERVICES: Schemas['ServiceTypeView'][] = [
  { id: 3, name: 'Пломба композит', durationMinutes: 60, active: true, priceSom: 4000 },
  { id: 5, name: 'Удаление зуба', durationMinutes: 45, active: true, priceSom: 2000 },
]

const RANK = { URGENT: 0, DESIRED: 1, LATER: 2 } as const

/** Как сервер: несделанные — по срочности, потом этап; сделанные — ниже. */
const ordered = (plan: Step[]) => [...plan].sort((a, b) => Number(Boolean(a.doneAt)) - Number(Boolean(b.doneAt))
  || (a.doneAt ? 0 : RANK[a.priority ?? 'DESIRED'] - RANK[b.priority ?? 'DESIRED']) || a.stage - b.stage || a.id - b.id)

function backend(start: Step[]) {
  let plan = ordered(start)
  let nextId = 10
  const sent: Record<string, unknown>[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/clinic/discounts', () => HttpResponse.json({ who: 'ADMIN', maxPercent: 10, canGive: true, myMaxPercent: 100 })),
    http.get('*/api/appointments', () => HttpResponse.json([])),
    http.get('*/api/patients/recent', () => HttpResponse.json([{ id: 2, fullName: 'Айгуль Т.', phone: '996700333444' }])),
    http.get('*/api/appointments/by-patient/2', () => HttpResponse.json({
      patient: { id: 2, fullName: 'Айгуль Т.', phone: '996700333444' }, done: 1, noShow: 0, cancelled: 0, upcoming: [], past: [],
    })),
    http.get('*/api/appointments/debts', () => HttpResponse.json([])),
    http.get('*/api/patients/2/teeth', () => HttpResponse.json([] satisfies Schemas['ToothView'][])),
    http.get('*/api/patients/2/files', () => HttpResponse.json([])),
    http.get('*/api/patients/2/notes', () => HttpResponse.json([])),
    http.get('*/api/service-types', () => HttpResponse.json(SERVICES)),
    http.get('*/api/patients/2/plan', () => HttpResponse.json(plan)),
    http.get('*/api/patients/2/plan/variants', () => HttpResponse.json({ switchable: true, variants: [] })),
    http.post('*/api/patients/2/plan', async ({ request }) => {
      const body = (await request.json()) as Schemas['ChartControllerStep']
      sent.push({ add: body })
      plan = ordered([...plan, { id: nextId++, tooth: body.tooth, title: body.title ?? '', priceSom: body.priceSom, stage: body.stage ?? 1,
        priority: body.priority ?? 'DESIRED' }])
      return HttpResponse.json(plan)
    }),
    http.put('*/api/patients/2/plan/:stepId', async ({ request, params }) => {
      const body = (await request.json()) as Schemas['ChartControllerStep']
      sent.push({ put: Number(params.stepId), ...body })
      plan = ordered(plan.map((s) => (s.id === Number(params.stepId) ? { ...s, priority: body.priority ?? s.priority } : s)))
      return HttpResponse.json(plan)
    }),
  )
  return sent
}

const MIXED: Step[] = [
  { id: 1, tooth: 16, title: 'Пломба композит', priceSom: 4000, stage: 1, priority: 'DESIRED' },
  { id: 2, tooth: 46, title: 'Удаление зуба', priceSom: 2000, stage: 1, priority: 'URGENT' },
  // Скидка этапа: в сумму группы — цена со скидкой
  { id: 3, tooth: 36, title: 'Лечение пульпита', priceSom: 10000, discountPercent: 10, discountSom: 1000, netSom: 9000, stage: 2, priority: 'URGENT' },
  { id: 4, tooth: 11, title: 'Отбеливание', priceSom: 9000, stage: 3, priority: 'LATER' },
  { id: 5, tooth: 17, title: 'Осмотр', priceSom: 500, stage: 1, priority: 'URGENT', doneAt: '2026-11-10T05:00:00Z' },
]

/** Заголовки групп срочности в списке этапов. */
const prioHeads = (list: HTMLElement) => within(list).getAllByRole('listitem').filter((li) => li.classList.contains('plan-prio')).map((li) => li.textContent)

async function openPlan() {
  window.location.hash = '/patients'
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Айгуль Т.' }))
  await openMedicalTab()
  await screen.findByRole('heading', { name: 'Медкарта · Айгуль Т.' })
  await medTab('План лечения')
  return screen.findByRole('list', { name: 'Этапы лечения' })
}

afterEach(() => {
  window.location.hash = ''
  localStorage.clear()
})

test('группы по срочности: заголовки с суммой (со скидкой), внутри — этапы, сделанное — отдельно; пустых групп нет', async () => {
  backend(MIXED.filter((s) => s.priority !== 'DESIRED'))
  const list = await openPlan()
  expect(prioHeads(list)).toEqual([expect.stringMatching(/^🔴 Срочно · 11\s000 сом$/), expect.stringMatching(/^🟢 Можно позже · 9\s000 сом$/), '✓ Сделано'])
  // Внутри срочного — «Этап 1» и «Этап 2»
  // В заголовке этапа — сумма этапа внутри группы
  expect(within(list).getAllByText(/^Этап \d/).map((x) => x.textContent)).toEqual([
    expect.stringMatching(/^Этап 1 · 2\s000 сом$/), expect.stringMatching(/^Этап 2 · 9\s000 сом$/), expect.stringMatching(/^Этап 3 · 9\s000 сом$/)])
  // «Выше / Ниже» (в «⋯») — внутри группы: срочный второй — «Выше» можно, «Ниже» нельзя (дальше — другая группа)
  expect(await stepMenuItem(list, 'Лечение пульпита', 'Ниже')).toBeDisabled()
  expect(screen.getByRole('menuitem', { name: 'Выше' })).toBeEnabled()
  await userEvent.keyboard('{Escape}')
  // Один в своей группе — двигать некуда: «Выше / Ниже» в меню нет совсем
  await stepMenuItem(list, 'Отбеливание', 'Изменить')
  expect(screen.queryByRole('menuitem', { name: 'Выше' })).not.toBeInTheDocument()
  await userEvent.keyboard('{Escape}')
})

test('все этапы «Желательно» — план как раньше, без групп', async () => {
  backend(MIXED.map((s) => ({ ...s, priority: 'DESIRED' })))
  const list = await openPlan()
  expect(within(list).queryByText(/Срочно|Желательно|Можно позже|Сделано/)).not.toBeInTheDocument()
})

test('«Что сделать»: срочность одним нажатием, «Удаление» подсказывает «Срочно»', async () => {
  const sent = backend([MIXED[0]!])
  await openPlan()
  await userEvent.click(screen.getByRole('button', { name: /^Зуб 47:/ }))
  await userEvent.click(screen.getByRole('button', { name: 'Что сделать: 47 →' }))
  const sheet = await screen.findByRole('dialog', { name: 'Что сделать: 47' })
  const chips = within(sheet).getByRole('group', { name: 'Срочность этапа' })
  expect(within(chips).getByRole('button', { name: 'Желательно' })).toHaveAttribute('aria-pressed', 'true')
  await userEvent.type(within(sheet).getByRole('searchbox', { name: 'Найти услугу в прайсе' }), 'удал')
  await userEvent.click(within(sheet).getByRole('button', { name: /Удаление зуба/ }))
  expect(within(chips).getByRole('button', { name: 'Срочно' })).toHaveAttribute('aria-pressed', 'true')
  expect(sheet).toHaveTextContent('Подобрано по услуге')
  // Врач решил иначе — его выбор главнее подсказки
  await userEvent.click(within(chips).getByRole('button', { name: 'Можно позже' }))
  await userEvent.click(within(chips).getByRole('button', { name: 'Срочно' }))
  await userEvent.click(within(sheet).getByRole('button', { name: '＋ Добавить в план' }))
  expect(sent).toContainEqual({ add: expect.objectContaining({ tooth: 47, title: 'Удаление зуба', priority: 'URGENT' }) })
  const list = await screen.findByRole('list', { name: 'Этапы лечения' })
  await waitFor(() => expect(prioHeads(list)).toEqual([expect.stringMatching(/^🔴 Срочно · 2\s000 сом$/), expect.stringMatching(/^🟡 Желательно · 4\s000 сом$/)]))
})

test('правка этапа: срочность меняется кнопкой и уходит на сервер', async () => {
  const sent = backend([MIXED[0]!, MIXED[1]!])
  const list = await openPlan()
  await userEvent.click(await stepMenuItem(list, 'Пломба композит', 'Изменить'))
  const edit = screen.getByRole('form', { name: 'Этап: Пломба композит' })
  await userEvent.click(within(edit).getByRole('button', { name: 'Можно позже' }))
  await userEvent.click(within(edit).getByRole('button', { name: 'Сохранить' }))
  expect(sent).toContainEqual(expect.objectContaining({ put: 1, priority: 'LATER' }))
  await waitFor(() => expect(prioHeads(list)).toEqual([expect.stringMatching(/^🔴 Срочно · 2\s000 сом$/), expect.stringMatching(/^🟢 Можно позже · 4\s000 сом$/)]))
})

test('страница плана пациента: группы по срочности с суммой с сервера — ru и ky; без срочности — по этапам', async () => {
  window.location.hash = '#' + 'c'.repeat(43)
  const plan: Plan = {
    id: 5, clinicName: 'Улыбка', totalSom: 25000, discountSom: 1000,
    stages: [
      { stage: 1, totalSom: 15000, items: [{ tooth: 46, title: 'Удаление', priceSom: 2000, priority: 'URGENT' },
        { tooth: 16, title: 'Пломба', priceSom: 4000, priority: 'DESIRED' }, { tooth: 11, title: 'Отбеливание', priceSom: 9000, priority: 'LATER' }] },
      { stage: 2, totalSom: 9000, discountSom: 1000, items: [{ tooth: 36, title: 'Лечение пульпита', priceSom: 10000, discountSom: 1000, priority: 'URGENT' }] },
    ],
    priorities: [{ priority: 'URGENT', totalSom: 11000, discountSom: 1000 }, { priority: 'DESIRED', totalSom: 4000 }, { priority: 'LATER', totalSom: 9000 }],
  }
  server.use(http.get('*/web/plan/:token', () => HttpResponse.json(plan)))
  render(<PlanPage />)
  const urgent = await screen.findByRole('region', { name: '🔴 Срочно' })
  expect(within(urgent).getByRole('heading')).toHaveTextContent(/🔴 Срочно11\s000 сом/)
  expect(within(urgent).getAllByRole('listitem').map((x) => x.textContent)).toEqual([
    expect.stringMatching(/^Зуб 46 · Удаление · этап 1/), expect.stringMatching(/^Зуб 36 · Лечение пульпита · этап 2/)])
  expect(urgent).toHaveTextContent('Это лучше не откладывать.')
  expect(screen.getByRole('region', { name: '🟢 Можно позже' })).toHaveTextContent('Отбеливание')
  expect(screen.queryByRole('heading', { name: 'Этап 1' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Кыргызча' }))
  expect(screen.getByRole('region', { name: '🔴 Шашылыш' })).toHaveTextContent('2-этап')
  expect(screen.getByRole('region', { name: '🟡 Жакында жасоо керек' })).toBeInTheDocument()
  expect(screen.getByRole('region', { name: '🟢 Кийинчерээк' })).toBeInTheDocument()
  window.location.hash = ''
})

test('«Позвать снова»: «🔴 есть срочное» у пациента со срочным в плане', async () => {
  const patients: Candidate[] = [
    { patientId: 7, fullName: 'Динара У.', telegram: false, reason: 'PLAN', planSom: 6000, plan: ['зуб 46 — Удаление'], invites: 0, urgent: 1, invitedAuto: false },
    { patientId: 8, fullName: 'Бакыт М.', telegram: false, reason: 'PLAN', planSom: 9000, plan: ['зуб 11 — Отбеливание'], invites: 0, urgent: 0, invitedAuto: false },
  ]
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/comebacks', () => HttpResponse.json({ patients, planSom: 15000, planPatients: 2, noShows: 0, recalls: 0, total: 2, sent: 0,
      agreed: 0, cancelled: 0 } satisfies Schemas['ComebacksBoard'])),
  )
  server.use(http.get('*/api/patients/recent', () => HttpResponse.json([])),
    http.get('*/api/comebacks/result', () => HttpResponse.json({ invited: 0, returned: 0, returnedPlanSom: 0, paidSom: 0 })))
  window.location.hash = '/patients'
  renderApp()
  await userEvent.click(await findSub('Позвать снова'))
  const list = await screen.findByRole('list', { name: 'Кого вернуть' })
  const rows = within(list).getAllByRole('listitem')
  expect(rows[0]).toHaveTextContent('🔴 есть срочное')
  expect(rows[1]).not.toHaveTextContent('срочное')
})

test('группы и подсказка — чистые функции', () => {
  expect(priorityGrouped([{ priority: 'DESIRED' }, {}])).toBe(false)
  expect(priorityGroups(MIXED.filter((s) => !s.doneAt)).map((g) => [g.priority, g.total])).toEqual([['URGENT', 11000], ['DESIRED', 4000], ['LATER', 9000]])
  expect(suggestPriority('Удаление зуба мудрости')).toBe('URGENT')
  expect(suggestPriority('Отбеливание')).toBe('LATER')
  expect(suggestPriority('Пломба')).toBeNull()
})
