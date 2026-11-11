import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../../api/client'
import { me, renderApp, findSub } from '../../test/fixtures'
import { choose } from '../../test/select'
import { server } from '../../test/server'
import { waitForSlow } from '../../test/wait'

const owner = { ...me, owner: true, platform: true }

beforeEach(() => {
  window.location.hash = '/platform'
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(owner)),
    http.get('*/web/config', () => HttpResponse.json({ botUsername: 'tish_test_bot' })),
    http.get('*/api/platform/clinics', () => HttpResponse.json([{ id: 1, name: 'Стоматология «Тест»' }, { id: 2, name: 'Улыбка' }])),
    http.get('*/api/platform/applications', () => HttpResponse.json([])),
    http.get('*/api/platform/agreements/statuses', () => HttpResponse.json({})),
    http.get('*/api/platform/pay-requests', () => HttpResponse.json([])),
  )
})
afterEach(() => {
  window.location.hash = ''
})

const details = (extra: Partial<Schemas['SurveyDetails']> = {}): Schemas['SurveyDetails'] => ({
  id: 7, title: 'Как вам Tish?', intro: 'Пара минут', roles: [], active: false, announce: true, invited: 0, status: 'DRAFT', responses: 0,
  createdAt: '2026-11-02T08:00:00Z',
  questions: [
    { id: 71, type: 'NPS', text: 'Порекомендуете?', options: [], required: true },
    { id: 72, type: 'SINGLE', text: 'Как часто?', options: ['Каждый день', 'Реже'], required: false },
  ],
  ...extra,
})

async function openSurveys() {
  renderApp()
  await userEvent.click(await findSub('Опросы'))
}

test('«Создать из шаблона» — черновик в редакторе; правки уходят одним PUT', async () => {
  let created: unknown = null
  let saved: Schemas['SurveyDefinition'] | null = null
  server.use(
    http.get('*/api/platform/surveys', () => HttpResponse.json([])),
    http.get('*/api/platform/surveys/template', () => HttpResponse.json({ title: 'Как вам Tish?', questions: details().questions!.map((q) => ({ ...q, id: undefined })) })),
    http.post('*/api/platform/surveys', async ({ request }) => {
      created = await request.json()
      return HttpResponse.json(details(), { status: 201 })
    }),
    http.get('*/api/platform/surveys/7', () => HttpResponse.json(details())),
    http.put('*/api/platform/surveys/7', async ({ request }) => {
      saved = await request.json() as Schemas['SurveyDefinition']
      // Как сервер: новый вопрос получил id
      return HttpResponse.json(details({ ...saved, questions: saved.questions!.map((q, i) => ({ ...q, id: q.id ?? 80 + i })) }))
    }),
  )
  await openSurveys()
  expect(await screen.findByText('Опросов пока нет')).toBeInTheDocument()
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Создать из шаблона' }))
  expect(created).toMatchObject({ title: 'Как вам Tish?' })

  const editor = await screen.findByLabelText('Редактор опроса')
  await user.clear(within(editor).getByLabelText('Название'))
  await user.type(within(editor).getByLabelText('Название'), 'Опрос для врачей')
  await user.click(within(editor).getByRole('button', { name: 'Врачи' }))
  await user.click(within(editor).getByRole('button', { name: '+ Вариант' }))
  await user.type(within(editor).getByLabelText('Вариант 3 вопроса 2'), 'Никогда')
  await user.click(within(editor).getByRole('button', { name: '+ Вопрос' }))
  await choose(within(editor).getByRole('combobox', { name: 'Вид вопроса 3' }), 'Свой ответ текстом')
  await user.type(within(editor).getByLabelText('Текст вопроса 3'), 'Чего не хватает?')
  await user.click(within(editor).getByRole('button', { name: 'Сохранить' }))

  await screen.findByText('Опрос сохранён')
  expect(screen.queryByText('Есть несохранённые изменения')).not.toBeInTheDocument()
  expect(saved).toEqual({
    title: 'Опрос для врачей', intro: 'Пара минут', roles: ['DOCTOR'], announce: true,
    questions: [
      { id: 71, type: 'NPS', text: 'Порекомендуете?', options: [], required: true },
      { id: 72, type: 'SINGLE', text: 'Как часто?', options: ['Каждый день', 'Реже', 'Никогда'], required: false },
      { type: 'TEXT', text: 'Чего не хватает?', options: [], required: false },
    ],
  })
})

test('на опрос ответили — вид вопроса и удаление закрыты, уже собранный вариант не убрать', async () => {
  const s = details({ status: 'OPEN', active: true, responses: 3 })
  server.use(
    http.get('*/api/platform/surveys', () => HttpResponse.json([{ id: 7, title: s.title, roles: [], status: 'OPEN', responses: 3 }])),
    http.get('*/api/platform/surveys/7', () => HttpResponse.json(s)),
    http.get('*/api/platform/surveys/7/results', () => HttpResponse.json({ surveyId: 7, responses: 0 })),
  )
  await openSurveys()
  await userEvent.click(await screen.findByRole('button', { name: 'Как вам Tish?' }))
  // С ответами открывается на «Итогах»
  await userEvent.click(await screen.findByRole('tab', { name: 'Вопросы' }))
  const editor = await screen.findByLabelText('Редактор опроса')
  expect(within(editor).getByText(/На опрос уже ответили: 3/)).toBeInTheDocument()
  expect(within(editor).getByRole('combobox', { name: 'Вид вопроса 1' })).toBeDisabled()
  expect(within(editor).queryByRole('button', { name: 'Удалить вопрос 1' })).not.toBeInTheDocument()
  expect(within(editor).queryByRole('button', { name: 'Убрать вариант 1' })).not.toBeInTheDocument()
  // Удалить опрос с ответами нельзя — только остановить
  expect(screen.queryByRole('button', { name: 'Удалить' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Остановить' })).toBeInTheDocument()
})

test('итоги: NPS, распределения, ответы текстом без имён, контакты; фильтр по роли и CSV', async () => {
  const s = details({ status: 'OPEN', active: true, responses: 3,
    questions: [...details().questions!, { id: 73, type: 'TEXT', text: 'Чего не хватает?', options: [] }] })
  const roles: (string | null)[] = []
  let csv = false
  server.use(
    http.get('*/api/platform/surveys', () => HttpResponse.json([{ id: 7, title: s.title, roles: [], status: 'OPEN', responses: 3 }])),
    http.get('*/api/platform/surveys/7', () => HttpResponse.json(s)),
    http.get('*/api/platform/surveys/7/results', ({ request }) => {
      const role = new URL(request.url).searchParams.get('role')
      roles.push(role)
      return HttpResponse.json({
        surveyId: 7, responses: role ? 1 : 3,
        byRole: [{ role: 'DOCTOR', count: 2 }, { role: 'RECEPTION', count: 1 }],
        byClinic: [{ clinicId: 1, clinicName: 'Стоматология «Тест»', count: 2 }, { clinicId: 2, clinicName: 'Улыбка', count: 1 }],
        questions: [
          { questionId: 71, type: 'NPS', text: 'Порекомендуете?', options: [], answered: 3, average: 7.3,
            nps: { score: 33, promoters: 2, passives: 0, detractors: 1 }, counts: [0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 1], texts: [] },
          { questionId: 72, type: 'SINGLE', text: 'Как часто?', options: ['Каждый день', 'Реже'], answered: 3, counts: [2, 1], texts: [] },
          { questionId: 73, type: 'TEXT', text: 'Чего не хватает?', options: [], answered: 1, counts: [],
            texts: [{ text: 'Отчёта по неделе', clinicName: 'Улыбка', roles: ['DOCTOR'], createdAt: '2026-11-02T09:00:00Z' }] },
        ],
        contacts: [{ name: 'Врач Вымышленный', clinicName: 'Улыбка', roles: ['DOCTOR'], createdAt: '2026-11-02T09:00:00Z' }],
      } satisfies Schemas['SurveyResultsResults'])
    }),
    http.get('*/api/platform/surveys/7/results.csv', () => {
      csv = true
      return new HttpResponse('﻿"Дата"', { headers: { 'Content-Type': 'text/csv' } })
    }),
  )
  URL.createObjectURL = vi.fn(() => 'blob:csv')
  URL.revokeObjectURL = vi.fn()
  await openSurveys()
  await userEvent.click(await screen.findByRole('button', { name: 'Как вам Tish?' }))

  const nps = await screen.findByRole('region', { name: 'Итоги: Порекомендуете?' })
  expect(within(nps).getByText('+33')).toBeInTheDocument()
  expect(within(screen.getByRole('list', { name: 'Варианты' })).getByTitle('Каждый день: 2 (67%)')).toBeInTheDocument()
  const text = screen.getByRole('region', { name: 'Итоги: Чего не хватает?' })
  expect(within(text).getByText('Отчёта по неделе')).toBeInTheDocument()
  expect(within(text).getByText(/Улыбка · врач/)).toBeInTheDocument()
  expect(within(screen.getByRole('region', { name: 'Готовы поговорить' })).getByText('Врач Вымышленный')).toBeInTheDocument()

  await choose(screen.getByRole('combobox', { name: 'Роль' }), 'Регистратура')
  await screen.findByText((_, el) => el?.className === 'survey-tile' && el.textContent === 'Ответов1')
  expect(roles).toEqual([null, 'RECEPTION'])

  await userEvent.click(screen.getByRole('button', { name: 'Скачать CSV' }))
  await waitForSlow(() => expect(csv).toBe(true))
})
