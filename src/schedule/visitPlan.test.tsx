import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { appointment, me, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { waitForSlow } from '../test/wait'
import { planMeta } from './planDoneStore'

// Строка «План лечения» в карточке приёма: пациенты и этапы — вымышленные
type Step = Schemas['TreatmentStepView']
type Appointment = Schemas['AppointmentView']

const visit: Appointment = appointment(31, 1, '00:05', 'Нурлан К.', { status: 'DONE', version: 1, serviceName: 'Осмотр' })

function backend(start: Step[], status = 200) {
  let plan = [...start]
  const calls: unknown[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments', ({ request }) => HttpResponse.json(new URL(request.url).searchParams.get('doctorId') === '1' ? [visit] : [])),
    http.get('*/api/appointments/to-pay', () => HttpResponse.json([])),
    http.get('*/api/patients/:id/plan', () => status === 200 ? HttpResponse.json(plan)
      : HttpResponse.json({ status, detail: 'Медкарту видят врач приёма и руководитель' }, { status })),
    http.post('*/api/patients/:id/plan', async ({ request }) => {
      const body = (await request.json()) as Schemas['ChartControllerStep']
      calls.push(body)
      plan = [...plan, { id: 99, title: body.title, tooth: body.tooth, stage: body.stage ?? 1 }]
      return HttpResponse.json(plan)
    }),
    http.put('*/api/patients/:id/plan/:stepId', async ({ request, params }) => {
      const body = (await request.json()) as { done?: boolean }
      calls.push({ step: Number(params.stepId), done: body.done })
      plan = plan.map((s) => s.id === Number(params.stepId) ? { ...s, doneAt: body.done ? new Date().toISOString() : undefined, doneAppointmentId: body.done ? visit.id : undefined } : s)
      return HttpResponse.json(plan)
    }),
  )
  return calls
}

async function card() {
  await userEvent.click(await screen.findByRole('button', { name: /Нурлан К\./ }))
  return screen.getByRole('complementary', { name: 'Карточка приёма' })
}

test('строка «План лечения» рядом с зубами: счётчик, открывает тот же редактор, что в медкарте — добавить этап после осмотра', async () => {
  const calls = backend([
    { id: 1, tooth: 46, title: 'Лечение каналов', stage: 1 },
    { id: 2, title: 'Профчистка', stage: 1, doneAt: new Date().toISOString(), doneAppointmentId: visit.id },
  ])
  renderApp()
  const c = await card()
  const row = await within(c).findByRole('region', { name: 'План лечения пациента' })
  const head = within(row).getByRole('button', { name: /План лечения/ })
  await waitForSlow(() => expect(head).toHaveTextContent('1 этап, 1 сделан сегодня'))
  expect(head).toHaveAttribute('aria-expanded', 'false')
  // Рядом — «Зубы», «Материалы», «Снимки»: в одном списке приёма
  expect(within(c).getByRole('region', { name: 'Приём' })).toContainElement(row)

  await userEvent.click(head)
  expect(within(row).getByRole('list', { name: 'Этапы лечения' })).toHaveTextContent('Лечение каналов')
  await userEvent.type(within(row).getByRole('textbox', { name: 'Что сделать' }), 'Пломба')
  await userEvent.type(within(row).getByRole('textbox', { name: 'Зуб' }), '36')
  await userEvent.click(within(row).getByRole('button', { name: '＋ Добавить в план' }))
  await waitForSlow(() => expect(calls).toContainEqual(expect.objectContaining({ title: 'Пломба', tooth: 36 })))
  await waitForSlow(() => expect(head).toHaveTextContent('2 этапа, 1 сделан сегодня'))

  // Отметить сделанное — счётчик в строке обновится сам (тот же кэш, что у медкарты)
  await userEvent.click(within(row).getByRole('checkbox', { name: 'Сделано: Лечение каналов' }))
  await waitForSlow(() => expect(head).toHaveTextContent('1 этап, 2 сделано сегодня'))
})

test('плана нет — в строке «нет»', async () => {
  backend([])
  const { unmount } = renderApp()
  const c = await card()
  const row = await within(c).findByRole('region', { name: 'План лечения пациента' })
  await waitForSlow(() => expect(within(row).getByRole('button', { name: /План лечения/ })).toHaveTextContent('нет'))
  unmount()
})

test('нет доступа к медкарте (403) — строки «План лечения» нет', async () => {
  backend([], 403)
  renderApp()
  const c = await card()
  await within(c).findByRole('region', { name: 'Приём' })
  await waitForSlow(() => expect(within(c).queryByRole('region', { name: 'План лечения пациента' })).not.toBeInTheDocument())
})

test('planMeta: «нет», «всё сделано», «N этапов»', () => {
  expect(planMeta([], visit)).toBe('нет')
  expect(planMeta([{ id: 1, title: 'А', stage: 1, doneAt: '2020-01-01T00:00:00Z' }], visit)).toBe('всё сделано')
  expect(planMeta([1, 2, 3, 4, 5].map((id) => ({ id, title: 'А', stage: 1 })), visit)).toBe('5 этапов')
})
