import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp, medTab, openMedicalTab } from '../test/fixtures'
import { choose } from '../test/select'
import { server } from '../test/server'
import { PlanPage } from '../site/PlanPage'

type Step = Schemas['TreatmentStepView']
type Variants = Schemas['PlanVariantsVariants']
type Plan = Schemas['PlanOffersPatientPlan']

/**
 * План с зубов и варианты плана (2026-11-23): выбрать зубы на формуле → «Что сделать» → услуга из прайса (цена за зуб),
 * «＋ Без зуба» → чистка в конец плана, «↑ ↓», «⧉ Ещё вариант», вкладки с итогами, «Пациент выбрал»; пациент выбирает
 * вариант на странице по ссылке. Пациент и цены вымышленные; сервер — MSW, считает итоги как сервер.
 */
const SERVICES: Schemas['ServiceTypeView'][] = [
  { id: 3, name: 'Пломба композит', durationMinutes: 60, active: true, priceSom: 4000 },
  { id: 4, name: 'Имплант', durationMinutes: 60, active: true, priceSom: 60000 },
  { id: 5, name: 'Профгигиена', durationMinutes: 60, active: true, priceSom: 3500 },
  { id: 6, name: 'Консультация', durationMinutes: 30, active: true, priceSom: 500 },
]

function backend() {
  let plan: Step[] = [{ id: 1, tooth: 36, title: 'Имплант', priceSom: 60000, stage: 1 }]
  let second: Step[] = []
  let variants = false
  let chosen = false
  let nextId = 10
  const sent: Record<string, unknown>[] = []
  const total = (steps: Step[]) => steps.reduce((sum, s) => sum + (s.priceSom ?? 0), 0)
  const view = (): Variants => (variants
    ? {
        switchable: true,
        variants: [
          { id: 101, number: 1, label: 'Вариант 1', current: !chosen, totalSom: total(plan), steps: plan },
          { id: 102, number: 2, name: 'Эконом', label: 'Вариант 2 — Эконом', current: chosen, chosenAt: chosen ? '2026-11-23T05:00:00Z' : undefined,
            chosenVia: chosen ? 'STAFF' : undefined, totalSom: total(second), steps: second },
        ],
      }
    : { switchable: true, variants: [] })
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments', () => HttpResponse.json([])),
    http.get('*/api/patients/recent', () => HttpResponse.json([{ id: 2, fullName: 'Айгуль Т.', phone: '996700333444' }])),
    http.get('*/api/appointments/by-patient/2', () => HttpResponse.json({
      patient: { id: 2, fullName: 'Айгуль Т.', phone: '996700333444' }, done: 1, noShow: 0, cancelled: 0, upcoming: [], past: [],
    })),
    http.get('*/api/appointments/debts', () => HttpResponse.json([])),
    http.get('*/api/patients/2/teeth', () => HttpResponse.json([{ number: 16, state: 'CARIES' }] satisfies Schemas['ToothView'][])),
    http.get('*/api/patients/2/files', () => HttpResponse.json([])),
    http.get('*/api/patients/2/notes', () => HttpResponse.json([])),
    http.get('*/api/service-types', () => HttpResponse.json(SERVICES)),
    http.get('*/api/patients/2/plan', () => HttpResponse.json(plan)),
    http.get('*/api/patients/2/plan/variants', () => HttpResponse.json(view())),
    http.post('*/api/patients/2/plan', async ({ request }) => {
      const body = (await request.json()) as Schemas['ChartControllerStep']
      const variant = new URL(request.url).searchParams.get('variantId')
      sent.push({ add: body, variant })
      const step: Step = { id: nextId++, tooth: body.tooth, title: body.title ?? '', priceSom: body.priceSom, stage: body.stage ?? 1 }
      if (variant === '102') {
        second = [...second, step]
        return HttpResponse.json(second)
      }
      plan = [...plan, step].sort((a, b) => a.stage - b.stage)
      return HttpResponse.json(plan)
    }),
    http.post('*/api/patients/2/plan/batch', async ({ request }) => {
      const body = (await request.json()) as Schemas['ChartControllerSteps']
      sent.push({ batch: body })
      plan = [...plan, ...(body.teeth ?? []).map((t) => ({ id: nextId++, tooth: t, title: body.title ?? '', priceSom: body.priceSom, stage: body.stage ?? 1 }))]
        .sort((a, b) => a.stage - b.stage)
      return HttpResponse.json(plan)
    }),
    http.post('*/api/patients/2/plan/:stepId/move', async ({ request, params }) => {
      const body = (await request.json()) as Schemas['ChartControllerMove']
      sent.push({ move: Number(params.stepId), up: body.up })
      const i = plan.findIndex((s) => s.id === Number(params.stepId))
      const j = body.up ? i - 1 : i + 1
      const copy = [...plan]
      copy.splice(Math.min(i, j), 2, plan[Math.max(i, j)]!, plan[Math.min(i, j)]!)
      plan = copy
      return HttpResponse.json(plan)
    }),
    http.post('*/api/patients/2/plan/variants', async ({ request }) => {
      sent.push({ variant: await request.json() })
      variants = true
      second = plan.map((s) => ({ ...s, id: s.id + 500 }))
      return HttpResponse.json(view())
    }),
    http.post('*/api/patients/2/plan/variants/:id/choose', ({ params }) => {
      sent.push({ choose: Number(params.id) })
      chosen = true
      ;[plan, second] = [second, plan]
      return HttpResponse.json(view())
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

test('с зубов: два зуба → «Что сделать» → услуга из прайса, цена за зуб × 2; зуб с этапом подсвечен', async () => {
  const sent = backend()
  await openPlan()
  // 36 — уже в плане: в рамке с числом этапов
  expect(screen.getByRole('button', { name: /^Зуб 36: .*в плане: 1/ })).toHaveClass('planned')
  await userEvent.click(screen.getByRole('button', { name: /^Зуб 16:/ }))
  await userEvent.click(screen.getByRole('button', { name: /^Зуб 17:/ }))
  await userEvent.click(screen.getByRole('button', { name: 'Что сделать: 16, 17 →' }))
  const sheet = await screen.findByRole('dialog', { name: 'Что сделать: 16, 17' })
  await userEvent.type(within(sheet).getByRole('searchbox', { name: 'Найти услугу в прайсе' }), 'плом')
  await userEvent.click(within(sheet).getByRole('button', { name: /Пломба композит/ }))
  expect(within(sheet).getByRole('spinbutton', { name: 'Цена, сом' })).toHaveValue(4000)
  expect(sheet).toHaveTextContent(/4\s000 сом × 2 зуба = 8\s000 сом/)
  await userEvent.click(within(sheet).getByRole('button', { name: '＋ Добавить в план' }))
  expect(sent).toContainEqual({ batch: { teeth: [16, 17], title: 'Пломба композит', priceSom: 4000, stage: 1, serviceTypeId: 3 } })
  const list = screen.getByRole('list', { name: 'Этапы лечения' })
  expect(await within(list).findAllByText(/Пломба композит/)).toHaveLength(2)
})

test('«＋ Без зуба»: профгигиена — быстрой кнопкой и «В конце плана»; порядок стрелками', async () => {
  const sent = backend()
  await openPlan()
  await userEvent.click(screen.getByRole('button', { name: '＋ Без зуба' }))
  const sheet = await screen.findByRole('dialog', { name: 'Без зуба: чистка, консультация…' })
  const quick = within(sheet).getByRole('group', { name: 'Частые процедуры без зуба' })
  expect(within(quick).getByRole('button', { name: /Консультация/ })).toBeInTheDocument()
  await userEvent.click(within(quick).getByRole('button', { name: /Профгигиена/ }))
  // Чистка — по умолчанию в конец: отдельным этапом после лечения
  expect(within(sheet).getByRole('combobox', { name: 'Этап лечения' })).toHaveTextContent('В конце плана (этап 2)')
  await userEvent.click(within(sheet).getByRole('button', { name: '＋ Добавить в план' }))
  const list = await screen.findByRole('list', { name: 'Этапы лечения' })
  expect(await within(list).findByText('Профгигиена')).toBeInTheDocument()
  expect(sent).toContainEqual({ add: { title: 'Профгигиена', priceSom: 3500, stage: 2, serviceTypeId: 5 }, variant: null })
  expect(list).toHaveTextContent(/Этап 1.*Имплант.*Этап 2.*Профгигиена/)

  // Стрелки: у первого «↑» выключена, «↓» двигает
  expect(within(list).getByRole('button', { name: 'Выше: Имплант' })).toBeDisabled()
  await userEvent.click(within(list).getByRole('button', { name: 'Ниже: Имплант' }))
  expect(sent).toContainEqual({ move: 1, up: false })
})

test('варианты: «⧉ Ещё вариант» → вкладки с итогами, этап во второй вариант, «Пациент выбрал этот вариант»', async () => {
  const sent = backend()
  await openPlan()
  await userEvent.click(screen.getByRole('button', { name: /Ещё вариант \(дешевле или дороже\)/ }))
  const tabs = await screen.findByRole('tablist', { name: 'Варианты плана' })
  expect(within(tabs).getByRole('tab', { name: /Вариант 1.*60\s000 сом/ })).toBeInTheDocument()
  // Открыт новый вариант — копия
  expect(within(tabs).getByRole('tab', { name: /Вариант 2 — Эконом/ })).toHaveAttribute('aria-selected', 'true')
  expect(sent).toContainEqual({ variant: {} })
  // Сравнение столбцами
  expect(screen.getByLabelText('Сравнение вариантов')).toHaveTextContent(/Вариант 1.*Имплант.*Вариант 2 — Эконом.*Имплант/)

  // Этап — в открытый (второй) вариант: ?variantId=102
  await userEvent.click(screen.getByRole('button', { name: '＋ Без зуба' }))
  const sheet = await screen.findByRole('dialog', { name: 'Без зуба: чистка, консультация…' })
  await userEvent.type(within(sheet).getByRole('textbox', { name: 'Что сделать' }), 'Отбеливание')
  await userEvent.type(within(sheet).getByRole('spinbutton', { name: 'Цена, сом' }), '7000')
  await choose(within(sheet).getByRole('combobox', { name: 'Этап лечения' }), 'Этап 1')
  await userEvent.click(within(sheet).getByRole('button', { name: '＋ Добавить в план' }))
  expect(sent).toContainEqual({ add: { title: 'Отбеливание', priceSom: 7000, stage: 1 }, variant: '102' })
  expect(await within(tabs).findByRole('tab', { name: /Вариант 2 — Эконом.*67\s000 сом/ })).toBeInTheDocument()
  // Сделанным этап невыбранного варианта не отметить
  expect(within(screen.getByRole('list', { name: 'Этапы лечения' })).getByRole('checkbox', { name: 'Сделано: Отбеливание' })).toBeDisabled()

  await userEvent.click(screen.getByRole('button', { name: '✅ Пациент выбрал этот вариант' }))
  expect(sent).toContainEqual({ choose: 102 })
  expect(await screen.findByText(/Вариант 2 — Эконом — выбран пациентом · отметил сотрудник/)).toBeInTheDocument()
  // Остальные — свёрнуты в «Другие варианты»
  expect(screen.getByText('Другие варианты (1)')).toBeInTheDocument()
})

test('страница плана по ссылке: варианты вкладками с итогом, «Выбрать этот вариант» уходит с номером варианта', async () => {
  window.location.hash = '#' + 'a'.repeat(43)
  let agreed = ''
  const plan: Plan = {
    id: 5, clinicName: 'Улыбка', totalSom: 63000, stages: [{ stage: 1, totalSom: 63000, items: [{ tooth: 36, title: 'Имплант', priceSom: 60000 }] }],
    variants: [
      { id: 101, number: 1, totalSom: 63000, stages: [{ stage: 1, totalSom: 60000, items: [{ tooth: 36, title: 'Имплант', priceSom: 60000 }] },
        { stage: 2, totalSom: 3000, items: [{ title: 'Профчистка', priceSom: 3000 }] }] },
      { id: 102, number: 2, name: 'Эконом', totalSom: 33000, stages: [{ stage: 1, totalSom: 33000, items: [{ tooth: 36, title: 'Мост', priceSom: 30000 },
        { title: 'Профчистка', priceSom: 3000 }] }] },
    ],
  }
  server.use(
    http.get('*/web/plan/:token', () => HttpResponse.json(plan)),
    http.post('*/web/plan/:token/agree', ({ request }) => {
      agreed = new URL(request.url).search
      return HttpResponse.json({ ...plan, variants: undefined, agreedAt: '2026-11-23T05:00:00Z', chosenNumber: 2, chosenName: 'Эконом', totalSom: 33000,
        stages: plan.variants![1]!.stages } satisfies Plan)
    }),
  )
  render(<PlanPage />)
  const tabs = await screen.findByRole('tablist')
  expect(within(tabs).getByRole('tab', { name: /Вариант 1.*63\s000 сом/ })).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByText('Врач подготовил несколько вариантов лечения — выберите удобный.')).toBeInTheDocument()
  await userEvent.click(within(tabs).getByRole('tab', { name: /Вариант 2 — Эконом.*33\s000 сом/ }))
  expect(screen.getByText('Мост')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Выбрать этот вариант: Вариант 2 — Эконом' }))
  expect(await screen.findByText('✅ Вы выбрали: Вариант 2 — Эконом')).toBeInTheDocument()
  expect(agreed).toBe('?variant=102')
  // Кыргызча
  await userEvent.click(screen.getByRole('button', { name: 'Кыргызча' }))
  expect(screen.getByText('✅ Сиз тандадыңыз: 2-вариант — Эконом')).toBeInTheDocument()
  window.location.hash = ''
})

test('шаблоны: сохранить план как шаблон; «Отправить план пациенту» — сообщением или листом A4', async () => {
  const sent = backend()
  server.use(
    http.get('*/api/plan-templates', () => HttpResponse.json([] satisfies Schemas['PlanTemplatesView'][])),
    http.post('*/api/plan-templates', async ({ request }) => {
      sent.push({ template: await request.json() })
      return HttpResponse.json({ id: 9, title: 'Имплант 36', shared: false, editable: true, usesTeeth: true, steps: [] } satisfies Schemas['PlanTemplatesView'],
        { status: 201 })
    }),
    http.get('*/api/patients/2/plan/offers', () => HttpResponse.json([] satisfies Schemas['PlanOffersOfferView'][])),
  )
  await openPlan()
  await userEvent.click(screen.getByRole('button', { name: '📄 Из шаблона' }))
  await userEvent.click(await screen.findByRole('button', { name: '💾 Сохранить этот план как шаблон' }))
  await userEvent.type(screen.getByRole('textbox', { name: 'Название шаблона' }), 'Имплант 36')
  await userEvent.click(screen.getByRole('button', { name: 'Сохранить шаблон' }))
  expect(sent).toContainEqual({ template: { title: 'Имплант 36', steps: [{ title: 'Имплант', stage: 1, perTooth: true }] } })
  await userEvent.click(screen.getByRole('button', { name: 'Закрыть' }))

  await userEvent.click(await screen.findByRole('button', { name: 'Отправить план пациенту' }))
  const panel = screen.getByRole('region', { name: 'План пациенту' })
  expect(within(panel).getByRole('button', { name: '💬 Сообщением' })).toHaveAttribute('aria-pressed', 'true')
  await userEvent.click(within(panel).getByRole('button', { name: '📄 Листом A4' }))
  await userEvent.click(screen.getByRole('button', { name: '📄 Открыть лист и отправить' }))
  expect(await screen.findByRole('dialog', { name: 'Отправить листом: план лечения' })).toBeInTheDocument()
})
