import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp } from '../test/fixtures'
import { server, SOURCES } from '../test/server'

type Option = Schemas['PatientSourcesOption']

beforeEach(() => {
  window.location.hash = '/settings/sources'
})
afterEach(() => {
  window.location.hash = ''
})

test('«Откуда узнают о клинике»: админ меняет порядок, добавляет с эмодзи из подсказок и скрывает', async () => {
  let list: Option[] = SOURCES.map((o) => ({ ...o }))
  let moved: unknown = null
  let created: unknown = null
  let updated: unknown = null
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json({ ...me, admin: true })),
    http.get('*/api/patient-sources', () => HttpResponse.json(list)),
    http.post('*/api/patient-sources/:id/move', async ({ request }) => {
      moved = await request.json()
      list = [list[1]!, list[0]!, ...list.slice(2)]
      return HttpResponse.json(list)
    }),
    http.post('*/api/patient-sources', async ({ request }) => {
      created = await request.json()
      list = [...list, { id: 30, active: true, patients: 0, ...(created as Schemas['PatientSourcesRequest']) }]
      return HttpResponse.json(list, { status: 201 })
    }),
    http.put('*/api/patient-sources/:id', async ({ request }) => {
      updated = await request.json()
      list = list.map((o) => (o.id === 16 ? { ...o, ...(updated as Schemas['PatientSourcesRequest']) } : o))
      return HttpResponse.json(list)
    }),
  )
  const user = userEvent.setup()
  renderApp()
  const table = await screen.findByRole('table', { name: 'Откуда узнают о клинике' })
  expect(within(table).getByRole('button', { name: '📱 Instagram' })).toBeInTheDocument()
  // Скрытый — в списке, с пометкой: у пациентов и в истории он остаётся
  expect(within(table).getByText('📣 Реклама').closest('tr')).toHaveTextContent('скрыт')

  await user.click(within(table).getByRole('button', { name: 'Ниже: Instagram' }))
  expect(await within(table).findByRole('button', { name: 'Выше: Instagram' })).toBeEnabled()
  expect(moved).toEqual({ direction: 1 })

  await user.click(within(table).getByRole('button', { name: '+ Добавить' }))
  const panel = await screen.findByRole('complementary', { name: 'Новый вариант' })
  await user.type(within(panel).getByRole('textbox', { name: 'Название' }), 'YouTube')
  await user.click(within(within(panel).getByRole('group', { name: 'Подсказки эмодзи' })).getByRole('button', { name: '▶️' }))
  expect(within(panel).getByRole('textbox', { name: 'Эмодзи' })).toHaveValue('▶️')
  await user.click(within(panel).getByRole('button', { name: 'Добавить' }))
  expect(await within(table).findByRole('button', { name: '▶️ YouTube' })).toBeInTheDocument()
  expect(created).toEqual({ emoji: '▶️', title: 'YouTube', titleKy: '' })

  await user.click(within(table).getByRole('button', { name: '🤝 Посоветовали знакомые' }))
  const edit = await screen.findByRole('complementary', { name: 'Вариант' })
  await user.click(within(edit).getByRole('checkbox', { name: /Предлагать/ }))
  await user.click(within(edit).getByRole('button', { name: 'Сохранить' }))
  expect(await within(edit).findByRole('status')).toHaveTextContent('Вариант сохранён')
  expect(updated).toEqual({ emoji: '🤝', title: 'Посоветовали знакомые', titleKy: 'Тааныштар сунушташты', active: false })
})

test('«Откуда узнают о клинике»: не админ только смотрит', async () => {
  server.use(http.get('*/api/patient/me', () => HttpResponse.json({ ...me, admin: false, reception: true })))
  renderApp()
  const table = await screen.findByRole('table', { name: 'Откуда узнают о клинике' })
  expect(within(table).getByText('📱 Instagram')).toBeInTheDocument()
  expect(within(table).queryByRole('button')).toBeNull()
  expect(screen.getByText(/Список меняет руководитель клиники/)).toBeInTheDocument()
})
