import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me } from '../test/fixtures'
import { choose } from '../test/select'
import { server } from '../test/server'
import { PlanTemplatesPage } from './PlanTemplatesPage'

/** «Настройки → Приём → Шаблоны плана» (шаг 4А): свои и общие, новый шаблон с шагами, изменить, удалить. */
const templates: Schemas['PlanTemplatesView'][] = [
  { id: 5, title: 'Санация', shared: true, editable: true, usesTeeth: true, steps: [
    { title: 'Профгигиена', stage: 1, perTooth: false }, { title: 'Лечение кариеса', stage: 2, perTooth: true },
  ] },
]

function backend() {
  const calls = { post: [] as unknown[], put: [] as unknown[], deleted: [] as number[] }
  server.use(
    http.get('*/api/plan-templates', () => HttpResponse.json(templates)),
    http.post('*/api/plan-templates', async ({ request }) => {
      const body = await request.json() as Schemas['PlanTemplatesFields']
      calls.post.push(body)
      return HttpResponse.json({ ...templates[0]!, id: 9, title: body.title ?? '' }, { status: 201 })
    }),
    http.put('*/api/plan-templates/:id', async ({ request, params }) => {
      const body = await request.json() as Schemas['PlanTemplatesFields']
      calls.put.push({ id: Number(params.id), ...body })
      return HttpResponse.json(templates[0])
    }),
    http.delete('*/api/plan-templates/:id', ({ params }) => {
      calls.deleted.push(Number(params.id))
      return new HttpResponse(null, { status: 204 })
    }),
    http.get('*/api/service-types', () => HttpResponse.json([
      { id: 3, name: 'Имплант', durationMinutes: 60, active: true, priceSom: 40000 },
    ] satisfies Schemas['ServiceTypeView'][])),
  )
  return calls
}

function renderPage(who = me) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><PlanTemplatesPage me={who} onBack={() => {}} /></QueryClientProvider>)
}

test('шаблоны плана: новый со шагами и услугой, изменить этап, удалить', async () => {
  const calls = backend()
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  renderPage({ ...me, doctorId: 1 })
  const shared = await screen.findByRole('group', { name: 'Общие клиники' })
  expect(shared).toHaveTextContent('Профгигиена → Лечение кариеса · 2 этапа')

  await userEvent.click(screen.getByRole('button', { name: '＋ Новый шаблон' }))
  const form = screen.getByRole('form', { name: 'Новый шаблон плана' })
  await userEvent.type(within(form).getByRole('textbox', { name: 'Название' }), 'Имплант под ключ')
  await choose(within(form).getByRole('combobox', { name: 'Шаг 1: услуга' }), 'Имплант')
  expect(within(form).getByRole('textbox', { name: 'Шаг 1: что сделать' })).toHaveValue('Имплант')
  await userEvent.click(within(form).getByRole('checkbox', { name: 'Каждому зубу' }))
  await userEvent.click(within(form).getByRole('button', { name: '＋ Шаг' }))
  await userEvent.type(within(form).getByRole('textbox', { name: 'Шаг 2: что сделать' }), 'Коронка на имплант')
  await choose(within(form).getByRole('combobox', { name: 'Шаг 2: этап' }), 'Этап 3')
  await userEvent.click(within(form).getByRole('button', { name: 'Сохранить' }))
  expect(calls.post[0]).toEqual({
    title: 'Имплант под ключ', shared: false, steps: [
      { title: 'Имплант', serviceTypeId: 3, stage: 1, perTooth: true },
      { title: 'Коронка на имплант', stage: 3, perTooth: true },
    ],
  })

  await userEvent.click(await within(shared).findByRole('button', { name: 'Изменить: Санация' }))
  const edit = screen.getByRole('form', { name: 'Шаблон «Санация»' })
  await userEvent.click(within(edit).getByRole('button', { name: 'Убрать шаг 2' }))
  await userEvent.click(within(edit).getByRole('button', { name: 'Сохранить' }))
  expect(calls.put[0]).toMatchObject({ id: 5, title: 'Санация', shared: true, steps: [{ title: 'Профгигиена', stage: 1, perTooth: false }] })

  await userEvent.click(await screen.findByRole('button', { name: 'Удалить: Санация' }))
  await waitFor(() => expect(calls.deleted).toEqual([5]))
})

test('шаблоны уже есть — «Добавить готовые» внизу возвращает только недостающие (сервер, V246)', async () => {
  backend()
  let calls = 0
  server.use(http.post('*/api/plan-templates/defaults', () => {
    calls++
    return HttpResponse.json([...templates, { id: 11, title: 'Имплант под ключ', shared: true, editable: true, usesTeeth: true, steps: [
      { title: 'Установка импланта', stage: 1, perTooth: true, serviceTypeId: 3, serviceName: 'Имплант', priceSom: 40000 },
    ] }] satisfies Schemas['PlanTemplatesView'][])
  }))
  renderPage()
  await screen.findByRole('group', { name: 'Общие клиники' })
  expect(screen.getByText(/Удалили готовый шаблон — его можно вернуть/)).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: /Добавить готовые/ }))
  expect(await screen.findByRole('status')).toHaveTextContent('Добавлено готовых: 1')
  expect(screen.getByText('Имплант под ключ')).toBeInTheDocument()
  expect(calls).toBe(1)
})
