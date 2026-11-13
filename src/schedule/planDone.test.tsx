import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { appointment, me, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { waitForSlow } from '../test/wait'
import { preselected } from './planDoneStore'

// «Что сделали сегодня?»: пациенты и этапы — вымышленные
type Appointment = Schemas['AppointmentView']
type Step = Schemas['TreatmentStepView']
type Me = Schemas['BookingViewsMe']

const services: Schemas['ServiceTypeView'][] = [
  { id: 5, name: 'Лечение кариеса', durationMinutes: 60, active: true },
  { id: 6, name: 'Профчистка', durationMinutes: 45, active: true },
]
const doctor: Me = { ...me, services }

const PLAN: Step[] = [
  { id: 1, tooth: 36, title: 'Лечение кариеса', stage: 1, serviceTypeId: 5 },
  { id: 2, tooth: 46, title: 'Пломба', stage: 1 },
  { id: 3, tooth: 11, title: 'Коронка', stage: 2 },
  { id: 4, title: 'Профчистка', stage: 1, doneAt: '2026-11-01T05:00:00Z', serviceTypeId: 6 },
]

function backend(start: Appointment, opts: { who?: Me; plan?: Step[]; teeth?: number[]; markStatus?: number } = {}) {
  let a = { ...start }
  let plan = [...(opts.plan ?? PLAN)]
  const calls: string[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(opts.who ?? doctor)),
    http.get('*/api/appointments', ({ request }) => HttpResponse.json(new URL(request.url).searchParams.get('doctorId') === '1' ? [a] : [])),
    http.get('*/api/appointments/to-pay', () => HttpResponse.json([])),
    http.get('*/api/patients/:id/plan', () => { calls.push('plan'); return HttpResponse.json(plan) }),
    http.get('*/api/appointments/:id/teeth', () => HttpResponse.json((opts.teeth ?? []).map((number) => ({ number, state: 'FILLING' })) satisfies Schemas['VisitToothView'][])),
    http.post('*/api/appointments/:id/status', async ({ request }) => {
      const body = (await request.json()) as Schemas['AppointmentRequestsChangeStatus']
      calls.push(`status:${body.status}`)
      a = { ...a, status: body.status, version: a.version + 1 }
      return HttpResponse.json(a)
    }),
    http.post('*/api/appointments/:id/plan-done', async ({ request, params }) => {
      const body = (await request.json()) as Schemas['ChartControllerPlanDone']
      calls.push(`done:${params.id}:${(body.stepIds ?? []).join(',')}`)
      if (opts.markStatus) return HttpResponse.json({ status: opts.markStatus, detail: 'Этап не найден' }, { status: opts.markStatus })
      plan = plan.map((s) => body.stepIds?.includes(s.id) ? { ...s, doneAt: new Date().toISOString(), doneAppointmentId: a.id } : s)
      return HttpResponse.json(plan satisfies Step[])
    }),
  )
  return calls
}

async function openCard(name: string) {
  await userEvent.click(await screen.findByRole('button', { name: new RegExp(name) }))
  return screen.getByRole('complementary', { name: 'Карточка приёма' })
}

async function markDone(card: HTMLElement) {
  await userEvent.click(within(card).getByRole('button', { name: 'Приём состоялся' }))
  await waitForSlow(() => expect(within(card).queryByRole('button', { name: 'Приём состоялся' })).not.toBeInTheDocument())
}

test('«Приём состоялся» → «Что сделали сегодня?»: предвыбор по услуге и зубу приёма, отметка одним запросом', async () => {
  const calls = backend(appointment(21, 1, '00:00', 'Айбек Т.', { serviceName: 'Лечение кариеса' }), { teeth: [36, 46] })
  renderApp()
  const card = await openCard('Айбек Т\\.')
  // До «состоялся» — не спрашиваем
  expect(within(card).queryByRole('region', { name: 'Что сделали сегодня?' })).not.toBeInTheDocument()
  await markDone(card)
  const block = await within(card).findByRole('region', { name: 'Что сделали сегодня?' })
  // Сделанный этап (профчистка) не показываем
  expect(within(block).queryByText('Профчистка')).not.toBeInTheDocument()
  // Услуга приёма (зуб 36) и зуб 46, отмеченные на приёме, — с галочкой; коронка — нет
  await waitFor(() => expect(within(block).getByRole('checkbox', { name: /Лечение кариеса/ })).toBeChecked())
  expect(within(block).getByRole('checkbox', { name: /46.*Пломба/ })).toBeChecked()
  expect(within(block).getByRole('checkbox', { name: /Коронка/ })).not.toBeChecked()
  // Оплата не принята — главная кнопка у неё, наша — обычная
  expect(within(block).getByRole('button', { name: 'Отметить сделанным' })).not.toHaveClass('primary')
  await userEvent.click(within(block).getByRole('checkbox', { name: /Коронка/ }))
  await userEvent.click(within(block).getByRole('checkbox', { name: /Лечение кариеса/ }))
  await userEvent.click(within(block).getByRole('button', { name: 'Отметить сделанным' }))
  expect(await within(card).findByText('Отмечено сделанным: 2 этапа плана')).toBeInTheDocument()
  expect(calls).toContain('done:21:2,3')
  expect(within(card).queryByRole('region', { name: 'Что сделали сегодня?' })).not.toBeInTheDocument()
})

test('несделанных этапов нет — блока нет', async () => {
  const calls = backend(appointment(22, 1, '00:00', 'Айбек Т.'), { plan: [PLAN[3]!] })
  renderApp()
  const card = await openCard('Айбек Т\\.')
  await markDone(card)
  await waitFor(() => expect(calls.filter((c) => c === 'plan').length).toBeGreaterThan(0))
  expect(within(card).queryByRole('region', { name: 'Что сделали сегодня?' })).not.toBeInTheDocument()
  expect(within(card).queryByText(/Отмечено сделанным/)).not.toBeInTheDocument()
})

test('«Ничего из плана» — блок закрывается, ничего не отмечено', async () => {
  const calls = backend(appointment(23, 1, '00:00', 'Айбек Т.'))
  renderApp()
  const card = await openCard('Айбек Т\\.')
  await markDone(card)
  const block = await within(card).findByRole('region', { name: 'Что сделали сегодня?' })
  // Без совпадений — ничего не выбрано, отмечать нечего
  expect(within(block).getByRole('button', { name: 'Отметить сделанным' })).toBeDisabled()
  await userEvent.click(within(block).getByRole('button', { name: 'Ничего из плана' }))
  expect(within(card).queryByRole('region', { name: 'Что сделали сегодня?' })).not.toBeInTheDocument()
  expect(calls.some((c) => c.startsWith('done:'))).toBe(false)
})

test('ошибка — понятный текст, блок остаётся', async () => {
  backend(appointment(24, 1, '00:00', 'Айбек Т.', { serviceName: 'Лечение кариеса' }), { markStatus: 404 })
  renderApp()
  const card = await openCard('Айбек Т\\.')
  await markDone(card)
  const block = await within(card).findByRole('region', { name: 'Что сделали сегодня?' })
  await waitFor(() => expect(within(block).getByRole('checkbox', { name: /Лечение кариеса/ })).toBeChecked())
  await userEvent.click(within(block).getByRole('button', { name: 'Отметить сделанным' }))
  expect(await within(block).findByRole('alert')).toHaveTextContent('Этап уже удалили или изменили')
})

test('регистратура и ассистент: «состоялся» отмечают, а этапы плана — нет', async () => {
  for (const who of [
    { ...doctor, admin: false, doctorId: undefined, reception: true },
    { ...doctor, admin: false, doctorId: undefined, assistantOf: [1] },
  ] satisfies Me[]) {
    const calls = backend(appointment(25, 1, '00:00', 'Айбек Т.', { serviceName: 'Лечение кариеса' }), { who })
    const view = renderApp()
    const card = await openCard('Айбек Т\\.')
    await markDone(card)
    // Ассистент план видит («Продолжение лечения»), но отмечать — нет
    await new Promise((r) => setTimeout(r, 50))
    expect(within(card).queryByRole('region', { name: 'Что сделали сегодня?' })).not.toBeInTheDocument()
    expect(calls.some((c) => c.startsWith('done:'))).toBe(false)
    view.unmount()
  }
})

test('предвыбор: услуга с другим зубом не выбирается, если на приёме отмечены зубы; этап без зуба — выбирается', () => {
  const a = appointment(1, 1, '10:00', 'Айбек Т.', { serviceName: 'лечение КАРИЕСА ' })
  const steps: Step[] = [
    { id: 1, tooth: 36, title: 'Лечение кариеса', stage: 1 },
    { id: 2, tooth: 26, title: 'Лечение кариеса', stage: 1, serviceTypeId: 5 },
    { id: 3, title: 'Что-то по услуге', stage: 1, serviceTypeId: 5 },
    { id: 4, tooth: 11, title: 'Винир', stage: 1 },
  ]
  expect(preselected(steps, a, services, [36])).toEqual([1, 3])
  // Зубы на приёме не отмечали — все этапы по услуге
  expect(preselected(steps, a, services, [])).toEqual([1, 2, 3])
})

describe('телефон: свайп «состоялся»', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('max-width') || query.includes('coarse'),
      media: query, addEventListener() {}, removeEventListener() {}, onchange: null,
      addListener() {}, removeListener() {}, dispatchEvent: () => false,
    }))
    vi.stubGlobal('innerWidth', 390)
    localStorage.setItem('crm.schedule.view', '1')
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  function swipeLeft(el: Element) {
    const at = (cx: number) => [{ identifier: 1, clientX: cx, clientY: 300 }]
    fireEvent.touchStart(el, { touches: at(300), changedTouches: at(300) })
    for (const k of [0.1, 0.5, 1]) fireEvent.touchMove(el, { touches: at(300 - 200 * k), changedTouches: at(300 - 200 * k) })
    fireEvent.touchEnd(el, { touches: [], changedTouches: at(100) })
  }

  test('жест не прерывается окном: под строкой «Этапы плана ›» — открывает карточку с блоком', async () => {
    const calls = backend(appointment(26, 1, '00:00', 'Айбек Т.', { serviceName: 'Лечение кариеса' }))
    renderApp()
    const row = (await screen.findByRole('button', { name: /, Айбек Т\.: / })).closest('li')!
    swipeLeft(row)
    const undo = await within(row).findByRole('status')
    expect(undo).toHaveTextContent('Приём отмечен состоявшимся')
    expect(screen.queryByRole('complementary', { name: 'Карточка приёма' })).not.toBeInTheDocument()
    await userEvent.click(await within(undo).findByRole('button', { name: 'Этапы плана ›' }))
    const card = screen.getByRole('complementary', { name: 'Карточка приёма' })
    const block = await within(card).findByRole('region', { name: 'Что сделали сегодня?' })
    await waitFor(() => expect(within(block).getByRole('checkbox', { name: /Лечение кариеса/ })).toBeChecked())
    expect(calls).toContain('status:DONE')
  })

  test('без несделанных этапов — только «Вернуть»', async () => {
    const calls = backend(appointment(27, 1, '00:00', 'Айбек Т.'), { plan: [] })
    renderApp()
    const row = (await screen.findByRole('button', { name: /, Айбек Т\.: / })).closest('li')!
    swipeLeft(row)
    const undo = await within(row).findByRole('status')
    await waitFor(() => expect(calls).toContain('plan'))
    expect(within(undo).queryByRole('button', { name: 'Этапы плана ›' })).not.toBeInTheDocument()
    expect(within(undo).getByRole('button', { name: 'Вернуть' })).toBeInTheDocument()
  })
})
