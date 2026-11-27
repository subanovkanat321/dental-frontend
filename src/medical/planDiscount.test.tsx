import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp, medTab, openMedicalTab } from '../test/fixtures'
import { server } from '../test/server'
import { PlanPage } from '../site/PlanPage'
import { defaultDue, fromStep, priceOf, typePrice, fromList, setDiscount } from './stepDiscount'
import { stepMenuItem } from '../test/planStep'

type Step = Schemas['TreatmentStepView']
type Plan = Schemas['PlanOffersPatientPlan']

/**
 * Скидка в плане лечения (V257 бэкенда): цена ниже прайса — скидка на разницу, кнопки процентов, «Скидка на выбранные» и
 * «на весь план», зачёркнутая цена и итог «скидка … к оплате», правило «Настройки → Пациенты и скидки → Скидки», лист печати и страница
 * пациента. Пациент и цены вымышленные; сервер — MSW, скидку считает как сервер.
 */
const SERVICES: Schemas['ServiceTypeView'][] = [
  { id: 3, name: 'Пломба композит', durationMinutes: 60, active: true, priceSom: 4000 },
  { id: 4, name: 'Коронка', durationMinutes: 90, active: true, priceSom: 7000 },
]

/** Скидка, как её считает сервер: процент от цены (половина вверх) или сумма. */
function withDiscount(s: Step, d?: { percent?: number; som?: number } | null): Step {
  if (!d || (!d.percent && !d.som) || !s.priceSom) return { ...s, discountPercent: undefined, discountSom: undefined, netSom: undefined }
  const off = d.percent ? Math.round((s.priceSom * d.percent) / 100) : d.som!
  return { ...s, discountPercent: d.percent, discountSom: off, netSom: s.priceSom - off }
}

function backend(policy: Schemas['DiscountPoliciesPolicy'] = { who: 'ADMIN', maxPercent: 10, canGive: true, myMaxPercent: 100 }) {
  let plan: Step[] = [
    withDiscount({ id: 1, tooth: 16, title: 'Пломба композит', priceSom: 4500, stage: 1, serviceTypeId: 3 }, { percent: 10 }),
    { id: 2, tooth: 26, title: 'Пломба композит', priceSom: 2500, stage: 1, serviceTypeId: 3 },
    { id: 3, title: 'Консультация', stage: 1 },
  ]
  let nextId = 10
  const sent: Record<string, unknown>[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/clinic/discounts', () => HttpResponse.json(policy)),
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
      plan = [...plan, withDiscount({ id: nextId++, tooth: body.tooth, title: body.title ?? '', priceSom: body.priceSom, stage: body.stage ?? 1 },
        body.discount)]
      return HttpResponse.json(plan)
    }),
    http.put('*/api/patients/2/plan/discount', async ({ request }) => {
      const body = (await request.json()) as Schemas['ChartControllerDiscount']
      sent.push({ discount: body })
      plan = plan.map((s) => ((body.stepIds ?? []).includes(s.id) ? withDiscount(s, body.discount) : s))
      return HttpResponse.json(plan)
    }),
    http.put('*/api/patients/2/plan/:stepId', async ({ request, params }) => {
      const body = (await request.json()) as Schemas['ChartControllerStep']
      sent.push({ put: Number(params.stepId), ...body })
      plan = plan.map((s) => (s.id === Number(params.stepId)
        ? withDiscount({ ...s, priceSom: body.priceSom, title: body.title ?? s.title }, body.discount) : s))
      return HttpResponse.json(plan)
    }),
  )
  return sent
}

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

test('строка этапа: зачёркнутая цена, цена со скидкой и процент; итог плана — «скидка … к оплате»', async () => {
  backend()
  const list = await openPlan()
  expect(within(list).getByLabelText('Цена 4 500 сом, со скидкой 4 050 сом')).toHaveTextContent(/4\s500 −10 % 4\s050 сом/)
  expect(screen.getByRole('heading', { name: /План лечения/ })).toHaveTextContent(/7\s000 сом, скидка −450 сом, к оплате 6\s550 сом/)
  // Длительность услуги прайса — подсказка для записи
  expect(within(list).getAllByText('⏱ 60 мин')).toHaveLength(2)
})

test('«Что сделать»: цена ниже прайса — скидка на разницу; кнопка 10 % пересчитывает цену; врач и срок по умолчанию', async () => {
  const sent = backend()
  await openPlan()
  await userEvent.click(screen.getByRole('button', { name: /^Зуб 17:/ }))
  await userEvent.click(screen.getByRole('button', { name: 'Что сделать: 17 →' }))
  const sheet = await screen.findByRole('dialog', { name: 'Что сделать: 17' })
  await userEvent.type(within(sheet).getByRole('searchbox', { name: 'Найти услугу в прайсе' }), 'корон')
  await userEvent.click(within(sheet).getByRole('button', { name: /Коронка/ }))
  const price = within(sheet).getByRole('spinbutton', { name: 'Цена, сом' })
  await userEvent.clear(price)
  await userEvent.type(price, '6000')
  expect(within(sheet).getByRole('note', { name: 'Скидка этапа' })).toHaveTextContent(/Цена по прайсу 7\s000 сом → 6\s000 сом, скидка 1\s000 сом \(−14,3 %\)/)
  // Кнопка 10 % — от цены прайса
  await userEvent.click(within(within(sheet).getByRole('group', { name: 'Скидка этапа' })).getByRole('button', { name: '10 %' }))
  expect(price).toHaveValue(6300)
  expect(within(sheet).getByText(/По умолчанию: этап 1 — через неделю/)).toBeInTheDocument()
  await userEvent.click(within(sheet).getByRole('button', { name: '＋ Добавить в план' }))
  expect(sent).toContainEqual({ add: { tooth: 17, title: 'Коронка', priceSom: 7000, discount: { percent: 10 }, stage: 1, serviceTypeId: 4, doctorId: 1,
    dueOn: '2026-11-18', priority: 'DESIRED' } })
})

test('нельзя давать скидку — цена ниже прайса сохраняется просто ценой, с подсказкой «решает руководитель»', async () => {
  const sent = backend({ who: 'ADMIN', maxPercent: 10, canGive: false })
  await openPlan()
  await userEvent.click(screen.getByRole('button', { name: '＋ Без зуба' }))
  const sheet = await screen.findByRole('dialog', { name: 'Без зуба: чистка, консультация…' })
  await userEvent.type(within(sheet).getByRole('searchbox', { name: 'Найти услугу в прайсе' }), 'плом')
  await userEvent.click(within(sheet).getByRole('button', { name: /Пломба композит/ }))
  const price = within(sheet).getByRole('spinbutton', { name: 'Цена, сом' })
  await userEvent.clear(price)
  await userEvent.type(price, '2500')
  expect(within(sheet).queryByRole('group', { name: 'Скидка этапа' })).not.toBeInTheDocument()
  expect(within(sheet).getByRole('note', { name: 'Скидка этапа' })).toHaveTextContent('скидку оформляет руководитель — сохраним как цену этапа без скидки')
  await userEvent.click(within(sheet).getByRole('button', { name: '＋ Добавить в план' }))
  expect(sent).toContainEqual({ add: expect.objectContaining({ priceSom: 2500, title: 'Пломба композит' }) })
  expect(JSON.stringify(sent)).not.toContain('discount')
  // Кнопок скидки на план тоже нет
  expect(screen.queryByRole('button', { name: '🏷 Скидка на весь план' })).not.toBeInTheDocument()
})

test('скидка на весь план и на выбранные зубы — процентом; «Снять скидку»', async () => {
  const sent = backend()
  await openPlan()
  await userEvent.click(screen.getByRole('button', { name: '🏷 Скидка на весь план' }))
  const form = screen.getByRole('form', { name: 'Скидка на весь план' })
  expect(form).toHaveTextContent('2 этапа с ценой')
  await userEvent.click(within(form).getByRole('button', { name: '15 %' }))
  expect(form).toHaveTextContent(/7\s000 сом → 5\s950 сом, скидка 1\s050 сом/)
  await userEvent.click(within(form).getByRole('button', { name: 'Применить' }))
  // Этап без цены не отправляем
  expect(sent).toContainEqual({ discount: { stepIds: [1, 2], discount: { percent: 15 } } })
  expect(await screen.findByRole('heading', { name: /План лечения/ })).toHaveTextContent(/скидка −1\s050 сом, к оплате 5\s950 сом/)

  // Выбранный зуб на формуле → «Скидка на выбранные (1)» → снять
  await userEvent.click(screen.getByRole('button', { name: /^Зуб 26:/ }))
  await userEvent.click(screen.getByRole('button', { name: '🏷 Скидка на выбранные (1)' }))
  const picked = screen.getByRole('form', { name: 'Скидка на выбранные: 26' })
  await userEvent.click(within(picked).getByRole('button', { name: 'Снять скидку' }))
  expect(sent).toContainEqual({ discount: { stepIds: [2] } })
})

test('правка старого этапа: цена ниже нынешнего прайса — «оформить разницу скидкой?» одной кнопкой', async () => {
  const sent = backend()
  const list = await openPlan()
  await userEvent.click(await stepMenuItem(list, 'Пломба композит', 'Изменить', 1))
  const edit = screen.getByRole('form', { name: 'Этап: Пломба композит' })
  expect(edit).toHaveTextContent(/В прайсе сейчас 4\s000 сом/)
  await userEvent.click(within(edit).getByRole('button', { name: /оформить разницу 1\s500 сом скидкой/ }))
  expect(within(edit).getByRole('note', { name: 'Скидка этапа' })).toHaveTextContent(/скидка 1\s500 сом \(−37,5 %\)/)
  await userEvent.click(within(edit).getByRole('button', { name: 'Сохранить' }))
  expect(sent).toContainEqual(expect.objectContaining({ put: 2, priceSom: 4000, discount: { som: 1500 } }))
})

test('страница плана пациента: зачёркнутая цена, «Скидка» и «Итого со скидкой» — ru и ky', async () => {
  window.location.hash = '#' + 'b'.repeat(43)
  const plan: Plan = {
    id: 5, clinicName: 'Улыбка', totalSom: 8550, discountSom: 950,
    stages: [{ stage: 1, totalSom: 8550, discountSom: 950, items: [{ tooth: 16, title: 'Пломба', priceSom: 4500, discountSom: 450 },
      { tooth: 26, title: 'Пломба', priceSom: 5000, discountSom: 500 }] }],
  }
  server.use(http.get('*/web/plan/:token', () => HttpResponse.json(plan)))
  render(<PlanPage />)
  expect(await screen.findByText('Итого со скидкой:', { exact: false })).toHaveTextContent(/Итого со скидкой: 8\s550 сом/)
  expect(screen.getByText('Скидка:', { exact: false })).toHaveTextContent(/Скидка: −950 сом/)
  expect(screen.getAllByRole('listitem')[0]).toHaveTextContent(/4\s500 сом\s*4\s050 сом/)
  await userEvent.click(screen.getByRole('button', { name: 'Кыргызча' }))
  expect(screen.getByText('Арзандатуу менен жалпы:', { exact: false })).toHaveTextContent(/8\s550 сом/)
  window.location.hash = ''
})

test('цена и скидка в форме: согласованы в обе стороны; срок по номеру этапа', () => {
  const list = fromList(7000)
  expect(priceOf(typePrice(list, '6000'))).toMatchObject({ priceSom: 6000 })
  const policy = { who: 'ALL', maxPercent: 10, canGive: true, myMaxPercent: 10 } as const
  // 1 000 из 7 000 — 14,3 % > 10 %: просто цена
  expect(priceOf(typePrice(list, '6000'), policy)).toMatchObject({ priceSom: 6000, blocked: 'скидка больше вашего предела (10 %) — решает руководитель' })
  expect(priceOf(typePrice(list, '6000'), policy).discount).toBeUndefined()
  expect(priceOf(typePrice(list, '6500'), policy)).toMatchObject({ priceSom: 7000, discount: { som: 500 } })
  expect(setDiscount(list, { kind: 'percent', value: 5 }).price).toBe('6650')
  // Цена выше прайса — не скидка
  expect(priceOf(typePrice(list, '8000'))).toMatchObject({ priceSom: 8000, off: 0 })
  expect(fromStep({ priceSom: 4500, netSom: 4050, discountPercent: 10, discountSom: 450 })).toEqual({ price: '4050', ref: 4500, discount: { kind: 'percent', value: 10 } })
  // Сроки: этап 1 — неделя, этап 3 — +2 недели за этапом; у старого плана прошедшие сроки — не раньше чем через неделю
  expect(defaultDue([], 1, '2026-11-24')).toBe('2026-12-01')
  expect(defaultDue([], 3, '2026-11-24')).toBe('2026-12-29')
  expect(defaultDue([{ stage: 1, dueOn: '2026-12-10' }], 2, '2026-11-24')).toBe('2026-12-24')
  expect(defaultDue([{ stage: 1, dueOn: '2025-01-10' }], 2, '2026-11-24')).toBe('2026-12-01')
})
