import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp, medTab, openMedicalTab } from '../test/fixtures'
import { pickDate } from '../test/date'
import { choose } from '../test/select'
import { server } from '../test/server'
import { addDays, todayIn } from '../lib/time'

type Step = Schemas['TreatmentStepView']
type Template = Schemas['PlanTemplatesView']

/**
 * Шаг 4А (опыт Dentist Plus): врач и срок у этапа плана, просроченный этап, «📄 Из шаблона», «💲 Обновить цены».
 * Пациент вымышленный; сервер — MSW, план меняется, как на сервере.
 */
const today = todayIn()

const IMPLANT: Template = {
  id: 7, title: 'Имплант под ключ', shared: true, editable: false, usesTeeth: true, steps: [
    { title: 'Консультация хирурга, КТ', stage: 1, perTooth: false },
    { title: 'Установка импланта', serviceTypeId: 3, serviceName: 'Имплант', priceSom: 40000, stage: 1, perTooth: true },
    { title: 'Коронка на имплант', serviceTypeId: 4, serviceName: 'Коронка', priceSom: 15000, stage: 2, perTooth: true },
  ],
}

function backend(options: { templates?: Template[] } = {}) {
  let plan: Step[] = [
    { id: 1, tooth: 46, title: 'Имплантация', priceSom: 40000, stage: 1, serviceTypeId: 3, doctorId: 2, doctorName: 'Дастан Т.',
      dueOn: addDays(today, -5), overdue: true },
    { id: 2, tooth: 46, title: 'Формирователь', priceSom: 5000, stage: 2 },
    { id: 3, tooth: 46, title: 'Коронка', priceSom: 15000, stage: 2, serviceTypeId: 4 },
  ]
  let templates = options.templates ?? [IMPLANT]
  const sent: Record<string, unknown>[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments', () => HttpResponse.json([])),
    http.get('*/api/patients/recent', () => HttpResponse.json([{ id: 2, fullName: 'Айгуль Т.', phone: '996700333444' }])),
    http.get('*/api/appointments/by-patient/2', () => HttpResponse.json({
      patient: { id: 2, fullName: 'Айгуль Т.', phone: '996700333444' }, done: 1, noShow: 0, cancelled: 0, upcoming: [], past: [],
    })),
    http.get('*/api/appointments/debts', () => HttpResponse.json([])),
    http.get('*/api/patients/2/teeth', () => HttpResponse.json([])),
    http.get('*/api/patients/2/files', () => HttpResponse.json([])),
    http.get('*/api/patients/2/notes', () => HttpResponse.json([])),
    http.get('*/api/service-types', () => HttpResponse.json([
      { id: 3, name: 'Имплант', durationMinutes: 60, active: true, priceSom: 45000 },
      { id: 4, name: 'Коронка на имплант', durationMinutes: 60, active: true, priceSom: 18000 },
      { id: 5, name: 'Профгигиена', durationMinutes: 60, active: true, priceSom: 3000 },
    ] satisfies Schemas['ServiceTypeView'][])),
    http.get('*/api/patients/2/plan', () => HttpResponse.json(plan)),
    http.put('*/api/patients/2/plan/assign', async ({ request }) => {
      const body = (await request.json()) as Schemas['ChartControllerAssign']
      sent.push({ assign: body })
      const doctorName = me.doctors?.find((d) => d.id === body.doctorId)?.fullName
      plan = plan.map((s) => (body.stepIds?.includes(s.id)
        ? { ...s, doctorId: body.doctorId, doctorName, dueOn: body.dueOn, overdue: Boolean(body.dueOn && body.dueOn < today) }
        : s))
      return HttpResponse.json(plan)
    }),
    http.get('*/api/patients/2/plan/prices', () => HttpResponse.json({
      changes: [
        { stepId: 1, tooth: 46, title: 'Имплантация', wasSom: 40000, nowSom: 45000 },
        { stepId: 3, tooth: 46, title: 'Коронка', wasSom: 15000, nowSom: 18000 },
      ],
      wasSom: 60000, nowSom: 68000, manual: 1,
    } satisfies Schemas['TreatmentPlanReprice'])),
    http.post('*/api/patients/2/plan/prices', () => {
      sent.push({ prices: true })
      plan = plan.map((s) => (s.id === 1 ? { ...s, priceSom: 45000 } : s.id === 3 ? { ...s, priceSom: 18000 } : s))
      return HttpResponse.json(plan)
    }),
    http.get('*/api/plan-templates', () => HttpResponse.json(templates)),
    http.post('*/api/plan-templates/defaults', () => {
      sent.push({ defaults: true })
      templates = [...templates, IMPLANT]
      return HttpResponse.json(templates)
    }),
    http.post('*/api/plan-templates', async ({ request }) => {
      const body = (await request.json()) as Schemas['PlanTemplatesFields']
      sent.push({ template: body })
      templates = [...templates, { id: templates.length + 10, title: body.title ?? '', shared: Boolean(body.shared), editable: true, usesTeeth: false,
        steps: (body.steps ?? []).map((s) => ({ title: s.title ?? '', stage: s.stage ?? 1, perTooth: Boolean(s.perTooth), serviceTypeId: s.serviceTypeId })) }]
      return HttpResponse.json(templates.at(-1), { status: 201 })
    }),
    http.post('*/api/patients/2/plan/templates/:id', async ({ request, params }) => {
      const body = (await request.json()) as Schemas['PlanTemplatesApply']
      sent.push({ apply: Number(params.id), ...body })
      plan = [...plan, { id: 10, title: 'Консультация хирурга, КТ', stage: body.startStage ?? 1 },
        ...(body.teeth ?? []).map((t, i) => ({ id: 11 + i, tooth: t, title: 'Установка импланта', priceSom: 45000, stage: body.startStage ?? 1 }))]
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
})

test('врач и срок у этапа: «просрочен» подсвечен, назначить одному этапу и всему «Этапу 2», снять срок', async () => {
  const sent = backend()
  const list = await openPlan()
  expect(list).toHaveTextContent(/Дастан Т\. · до \d+ \S+ · просрочен/)
  expect(screen.getByText(/Просрочен 1 этап/)).toBeInTheDocument()

  // Весь «Этап 2»: врач и срок — обоим несделанным этапам группы
  await userEvent.click(within(list).getByRole('button', { name: 'Врач и срок: этап 2' }))
  const form = screen.getByRole('form', { name: 'Врач и срок: этап 2' })
  await choose(within(form).getByRole('combobox', { name: 'Врач этапа' }), 'Айгерим Садыкова')
  await pickDate(within(form).getByLabelText('Срок этапа'), addDays(today, 20))
  await userEvent.click(within(form).getByRole('button', { name: 'Сохранить' }))
  expect(sent).toContainEqual({ assign: { stepIds: [2, 3], doctorId: 1, dueOn: addDays(today, 20) } })
  expect(await within(list).findAllByText(/Айгерим Садыкова · до/)).toHaveLength(2)

  // Один этап: снять срок и врача — «просрочен» уходит
  await userEvent.click(within(list).getByRole('button', { name: 'Врач и срок: Имплантация' }))
  const one = screen.getByRole('form', { name: 'Врач и срок: Имплантация' })
  await choose(within(one).getByRole('combobox', { name: 'Врач этапа' }), 'Без врача')
  await userEvent.click(within(one).getByRole('button', { name: 'Без срока' }))
  await userEvent.click(within(one).getByRole('button', { name: 'Сохранить' }))
  expect(sent).toContainEqual({ assign: { stepIds: [1] } })
  await screen.findByRole('button', { name: 'Врач и срок: Имплантация' })
  expect(screen.queryByText(/Просрочен/)).not.toBeInTheDocument()
})

test('«📄 Из шаблона»: шаблону нужны зубы — без них не добавить; зубы и «начать с этапа» уходят на сервер', async () => {
  const sent = backend()
  await openPlan()
  await userEvent.click(screen.getByRole('button', { name: '📄 Из шаблона' }))
  const sheet = await screen.findByRole('dialog', { name: 'Шаблон плана' })
  await userEvent.click(await within(sheet).findByRole('button', { name: /Имплант под ключ/ }))
  const form = within(sheet).getByRole('form', { name: 'Применить шаблон «Имплант под ключ»' })
  // План уже до «Этапа 2» — по умолчанию следующим, третьим
  expect(form).toHaveTextContent('Этап 3 Консультация хирурга, КТ')
  expect(within(form).getByRole('button', { name: 'Добавить в план' })).toBeDisabled()
  await userEvent.type(within(form).getByLabelText('Зубы для шаблона'), '36, 37')
  expect(form).toHaveTextContent(/Примерно 110[\s ]000 сом/)
  await choose(within(form).getByRole('combobox', { name: 'Начать с этапа' }), 'Этап 1')
  await userEvent.click(within(form).getByRole('button', { name: 'Добавить в план' }))
  expect(sent).toContainEqual({ apply: 7, teeth: [36, 37], startStage: 1 })
  expect(await screen.findAllByText('Установка импланта')).toHaveLength(2)
  expect(screen.queryByRole('dialog', { name: 'Шаблон плана' })).not.toBeInTheDocument()
})

test('шаблонов нет — «Добавить готовые»: готовые шаблоны ставит и подбирает услуги сервер (V246)', async () => {
  const sent = backend({ templates: [] })
  await openPlan()
  await userEvent.click(screen.getByRole('button', { name: '📄 Из шаблона' }))
  const sheet = await screen.findByRole('dialog', { name: 'Шаблон плана' })
  await userEvent.click(await within(sheet).findByRole('button', { name: /Добавить готовые/ }))
  expect(await within(sheet).findByRole('button', { name: /Имплант под ключ/ })).toBeInTheDocument()
  // Один запрос — без подбора услуг в браузере и без шаблонов по одному
  expect(sent).toContainEqual({ defaults: true })
  expect(sent.filter((x) => 'template' in x)).toHaveLength(0)
})

test('«💲 Обновить цены»: было → стало, итог, этапы без услуги не меняются; подтвердили — сервер пересчитал', async () => {
  const sent = backend()
  await openPlan()
  await userEvent.click(screen.getByRole('button', { name: '💲 Обновить цены' }))
  const sheet = await screen.findByRole('dialog', { name: 'Обновить цены' })
  const changes = await within(sheet).findByRole('list', { name: 'Было → стало' })
  expect(within(changes).getAllByRole('listitem')[0]).toHaveTextContent(/46 · Имплантация40[\s ]000 сом → 45[\s ]000 сом/)
  expect(sheet).toHaveTextContent(/Осталось по плану: 60[\s ]000 сом → 68[\s ]000 сом/)
  expect(sheet).toHaveTextContent('Этапов без услуги из прайса: 1')
  expect(sent).not.toContainEqual({ prices: true })
  await userEvent.click(within(sheet).getByRole('button', { name: 'Обновить цены' }))
  expect(sent).toContainEqual({ prices: true })
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Обновить цены' })).not.toBeInTheDocument())
  expect(screen.getAllByText(/45[\s ]000 сом/).length).toBeGreaterThan(0)
})
