import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp, openItem } from '../test/fixtures'
import { server } from '../test/server'
import { waitForSlow } from '../test/wait'

beforeEach(() => {
  window.location.hash = '/settings/questions'
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/service-types', () => HttpResponse.json([])),
  )
})
afterEach(() => {
  window.location.hash = ''
})

test('анкета: разделы, порядок, новый вопрос с плашкой', async () => {
  let list: Schemas['AnamnesisQuestion'][] = [
    { id: 1, section: 'QUESTION', kind: 'CHECK', title: 'Аллергия?', alert: true, active: true, answers: 4, position: 0 },
    { id: 2, section: 'QUESTION', kind: 'TEXT', title: 'Принимает лекарства?', active: true, alert: false, position: 0, answers: 0 },
  ]
  let moved: unknown = null
  let created: unknown = null
  server.use(
    http.get('*/api/anamnesis/questions', () => HttpResponse.json(list)),
    http.post('*/api/anamnesis/questions/:id/move', async ({ request }) => {
      moved = await request.json()
      list = [list[1]!, list[0]!]
      return HttpResponse.json(list)
    }),
    http.post('*/api/anamnesis/questions', async ({ request }) => {
      created = await request.json()
      list = [...list, { id: 3, position: 3, answers: 0, alert: false, active: true, ...(created as Schemas['AnamnesisQuestionRequest']) }]
      return HttpResponse.json(list)
    }),
  )
  const user = userEvent.setup()
  renderApp()
  const table = await screen.findByRole('table', { name: 'Анкета пациента' })
  expect(within(table).getByText('в плашке · ответов: 4')).toBeInTheDocument()
  expect(within(table).getByRole('button', { name: 'Выше: Аллергия?' })).toBeDisabled()

  await user.click(within(table).getByRole('button', { name: 'Ниже: Аллергия?' }))
  expect(await within(table).findByRole('button', { name: 'Выше: Аллергия?' })).toBeEnabled()
  expect(moved).toEqual({ direction: 1 })

  const add = within(table).getAllByRole('button', { name: '+ Добавить' })
  await user.click(add[1]!) // «Болезни»
  const panel = await screen.findByRole('complementary', { name: 'Новый вопрос' })
  expect(within(panel).getByText('Раздел: Болезни')).toBeInTheDocument()
  await user.type(within(panel).getByRole('textbox', { name: 'Вопрос' }), 'Диабет')
  await user.click(within(panel).getByRole('checkbox', { name: /в плашке/ }))
  await user.click(within(panel).getByRole('button', { name: 'Добавить' }))
  expect(await within(table).findByRole('button', { name: 'Диабет' })).toBeInTheDocument()
  expect(created).toEqual({ section: 'DISEASE', title: 'Диабет', label: '', hint: '', kind: 'CHECK', alert: true, active: true })
})

test('новости: опубликовать с подтверждением и убрать', async () => {
  let news: Schemas['NewsServiceNews'][] = [{ id: 1, text: 'Работаем в субботу', createdAt: '2026-10-30T04:00:00Z', recipients: 10, delivered: 9 }]
  let posted: unknown = null
  server.use(
    http.get('*/api/news', () => HttpResponse.json({ news, subscribers: 12 } satisfies Schemas['NewsControllerStaffNews'])),
    http.post('*/api/news', async ({ request }) => {
      posted = await request.json()
      const n = { id: 2, text: 'Скидка на чистку', createdAt: '2026-10-31T04:00:00Z', recipients: 12, delivered: 0 }
      news = [n, ...news]
      return HttpResponse.json(n)
    }),
    http.delete('*/api/news/:id', ({ params }) => {
      news = news.filter((n) => String(n.id) !== params.id)
      return new HttpResponse(null, { status: 204 })
    }),
  )
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
  const user = userEvent.setup()
  renderApp()
  openItem('patient-news')
  expect(await screen.findByText(/в бот: 9 из 10/)).toBeInTheDocument()
  await user.type(screen.getByRole('textbox', { name: 'Текст новости' }), 'Скидка на чистку')
  await user.click(screen.getByRole('button', { name: 'Опубликовать и разослать' }))
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining('12 подписчикам'))
  expect(await screen.findByText('Опубликовано · в бот — 12 подписчикам')).toBeInTheDocument()
  expect(posted).toEqual({ text: 'Скидка на чистку' })

  const old = (await screen.findByText('Работаем в субботу')).closest('li')!
  await user.click(within(old as HTMLElement).getByRole('button', { name: 'Убрать из приложения' }))
  await waitForSlow(() => expect(screen.queryByText('Работаем в субботу')).not.toBeInTheDocument())
})

test('не админ: в «Настройках» нет новостей для пациентов, тарифа и сотрудников', async () => {
  server.use(http.get('*/api/patient/me', () => HttpResponse.json({ ...me, admin: false })))
  window.location.hash = '/settings'
  renderApp()
  expect(await screen.findByRole('button', { name: /Анкета пациента/ })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Памятки после процедур/ })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Новости для пациентов/ })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Тариф и оплата/ })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Сотрудники/ })).not.toBeInTheDocument()
})
