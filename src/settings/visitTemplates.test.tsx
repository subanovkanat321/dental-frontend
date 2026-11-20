import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me } from '../test/fixtures'
import { server } from '../test/server'
import { VisitTemplatesPage } from './VisitTemplatesPage'

const templates: Schemas['VisitTemplatesView'][] = [
  { id: 5, title: 'Кариес — пломба', shared: false, editable: true, note: 'Кариес {зуб}', toothState: 'FILLING', plan: [], usesTeeth: true },
  { id: 6, title: 'Профгигиена', shared: true, editable: true, sections: { treatment: 'Чистка' }, usesTeeth: false },
]

function backend() {
  const calls = { put: [] as unknown[], deleted: [] as number[], sections: [] as unknown[] }
  server.use(
    http.get('*/api/visit-templates', () => HttpResponse.json(templates)),
    http.put('*/api/visit-templates/:id', async ({ request, params }) => {
      const body = await request.json() as Schemas['VisitTemplatesFields']
      calls.put.push({ id: Number(params.id), ...body })
      return HttpResponse.json({ ...templates[0]!, title: body.title ?? '' } satisfies Schemas['VisitTemplatesView'])
    }),
    http.delete('*/api/visit-templates/:id', ({ params }) => {
      calls.deleted.push(Number(params.id))
      return new HttpResponse(null, { status: 204 })
    }),
    http.get('*/api/clinic/note-sections', () => HttpResponse.json({ on: false })),
    http.put('*/api/clinic/note-sections', async ({ request }) => {
      const body = await request.json() as Schemas['ChartControllerSectionsSetting']
      calls.sections.push(body)
      return HttpResponse.json(body)
    }),
    http.get('*/api/service-types', () => HttpResponse.json([])),
  )
  return calls
}

function renderPage(who = me) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><VisitTemplatesPage me={who} onBack={() => {}} /></QueryClientProvider>)
}

test('шаблоны: свои и общие, переименовать, удалить; руководитель включает «Разделы заметки»', async () => {
  const calls = backend()
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  renderPage()
  const mine = await screen.findByRole('group', { name: 'Мои' })
  expect(screen.getByRole('group', { name: 'Общие клиники' })).toHaveTextContent('Профгигиена')
  expect(mine).toHaveTextContent('Кариес {зуб} · зубы: пломба')

  await userEvent.click(within(mine).getByRole('button', { name: 'Изменить: Кариес — пломба' }))
  const form = screen.getByRole('form', { name: 'Шаблон «Кариес — пломба»' })
  const title = within(form).getByRole('textbox', { name: 'Название' })
  await userEvent.clear(title)
  await userEvent.type(title, 'Кариес простой')
  await userEvent.click(within(form).getByRole('button', { name: 'Сохранить' }))
  expect(calls.put[0]).toMatchObject({ id: 5, title: 'Кариес простой', note: 'Кариес {зуб}', toothState: 'FILLING', shared: false })

  await userEvent.click(await screen.findByRole('button', { name: 'Удалить: Профгигиена' }))
  await waitFor(() => expect(calls.deleted).toEqual([6]))

  await userEvent.click(screen.getByRole('checkbox', { name: 'Разделы заметки' }))
  await waitFor(() => expect(calls.sections).toEqual([{ on: true }]))
})

test('врач без прав руководителя: переключателя разделов нет, «Общий для клиники» не предлагается', async () => {
  backend()
  renderPage({ ...me, admin: false })
  await screen.findByRole('group', { name: 'Мои' })
  expect(screen.queryByRole('checkbox', { name: 'Разделы заметки' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: '＋ Новый шаблон' }))
  expect(screen.queryByRole('checkbox', { name: /Общий для клиники/ })).not.toBeInTheDocument()
})
