import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { readDeepLink } from '../lib/deepLink'
import { me, renderApp, findSub } from '../test/fixtures'
import { server } from '../test/server'
import { waitForSlow } from '../test/wait'

type Question = Schemas['PatientQuestionsQuestionView']

afterEach(() => {
  window.location.hash = ''
  vi.restoreAllMocks()
})

/** Вымышленные пациенты: один из базы, другой написал боту впервые. */
const fromCard: Question = {
  id: 5, patientId: 2, patientName: 'Айгуль Т.', patientPhone: '996700333444', status: 'NEW',
  text: 'Здравствуйте\nСколько стоит чистка?', createdAt: '2026-11-03T04:10:00Z', updatedAt: '2026-11-03T04:11:00Z',
}
const stranger: Question = { id: 6, status: 'NEW', text: 'Вы работаете в субботу?', createdAt: '2026-11-03T05:00:00Z' }

function backend({ ai }: { ai: boolean }) {
  let questions = [fromCard, stranger]
  const answers: unknown[] = []
  let drafts = 0
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/patients/recent', () => HttpResponse.json([])),
    http.get('*/api/patient-questions/new-count', () => HttpResponse.json({ count: questions.filter((q) => q.status === 'NEW').length })),
    http.get('*/api/patient-questions', ({ request }) => {
      const done = new URL(request.url).searchParams.get('done') === 'true'
      return HttpResponse.json({ questions: questions.filter((q) => (q.status !== 'NEW') === done), ai, aiAvailable: ai, botAi: false } satisfies Schemas['QuestionControllerQuestionList'])
    }),
    http.get('*/api/patient-questions/:id', ({ params }) => HttpResponse.json(questions.find((q) => q.id === Number(params.id)))),
    http.post('*/api/patient-questions/:id/draft', () => {
      drafts++
      return ai
        ? HttpResponse.json({ text: 'Здравствуйте! Чистка — от 2500 сом, точная стоимость — после осмотра.' } satisfies Schemas['QuestionControllerDraft'])
        : HttpResponse.json({ status: 409, detail: 'ИИ клиники выключен — напишите ответ сами', code: 'ai-unavailable' }, { status: 409 })
    }),
    http.post('*/api/patient-questions/:id/answer', async ({ params, request }) => {
      const body = (await request.json()) as Schemas['QuestionControllerAnswer']
      answers.push(body)
      questions = questions.map((q) => (q.id === Number(params.id)
        ? { ...q, status: 'ANSWERED', answer: body.text, answeredAt: '2026-11-03T06:00:00Z' } : q))
      return HttpResponse.json(questions.find((q) => q.id === Number(params.id)))
    }),
    http.post('*/api/patient-questions/:id/close', ({ params }) => {
      questions = questions.map((q) => (q.id === Number(params.id) ? { ...q, status: 'CLOSED', answeredAt: '2026-11-03T06:00:00Z' } : q))
      return HttpResponse.json(questions.find((q) => q.id === Number(params.id)))
    }),
  )
  return { answers, drafts: () => drafts }
}

test('«Вопросы»: бейдж, список, черновик ИИ правят и отправляют — вопрос уходит в «Отвеченные»', async () => {
  window.location.hash = '/patients'
  const { answers } = backend({ ai: true })
  renderApp()
  // Число новых — у раздела в меню (сумма подразделов: лист ожидания пуст) и у подраздела «Вопросы»
  expect(await screen.findByLabelText('Пациенты: новое — 2')).toHaveTextContent('2')
  await userEvent.click(await findSub('Вопросы · 2'))
  const table = await screen.findByRole('table', { name: 'Вопросы пациентов' })
  expect(table).toHaveTextContent('Айгуль Т.')
  expect(table).toHaveTextContent('Нет в базе клиники')
  expect(table).toHaveTextContent('Вы работаете в субботу?')

  await userEvent.click(within(table).getByRole('button', { name: 'Айгуль Т.' }))
  const panel = await screen.findByRole('complementary', { name: 'Вопрос пациента' })
  expect(await within(panel).findByText(/Сколько стоит чистка/)).toBeInTheDocument()
  await userEvent.click(within(panel).getByRole('button', { name: '✨ Черновик ответа' }))
  const field = within(panel).getByLabelText('Ответ пациенту')
  await waitForSlow(() => expect(field).toHaveValue('Здравствуйте! Чистка — от 2500 сом, точная стоимость — после осмотра.'))
  expect(within(panel).getByText(/проверьте и поправьте/)).toBeInTheDocument()
  // Сотрудник правит черновик — уходит его текст, а не текст ИИ
  await userEvent.type(field, ' Ждём вас!')
  await userEvent.click(within(panel).getByRole('button', { name: 'Отправить' }))
  expect(await within(panel).findByRole('status')).toHaveTextContent('Ответ отправлен пациенту')
  expect(answers).toEqual([{ text: 'Здравствуйте! Чистка — от 2500 сом, точная стоимость — после осмотра. Ждём вас!' }])
  expect(await findSub('Вопросы · 1')).toBeInTheDocument()

  await userEvent.click(screen.getByRole('tab', { name: 'Отвеченные' }))
  expect(await screen.findByRole('table', { name: 'Вопросы пациентов' })).toHaveTextContent('Айгуль Т.')
})

test('без ИИ кнопки черновика нет: отвечают вручную; «Закрыть без ответа» переспрашивает', async () => {
  window.location.hash = '/patients'
  const { answers, drafts } = backend({ ai: false })
  renderApp()
  await userEvent.click(await findSub(/Вопросы/))
  await userEvent.click(await screen.findByRole('button', { name: 'Нет в базе клиники' }))
  const panel = await screen.findByRole('complementary', { name: 'Вопрос пациента' })
  expect(await within(panel).findByText(/впервые/)).toBeInTheDocument()
  expect(within(panel).queryByRole('button', { name: /Черновик/ })).not.toBeInTheDocument()
  expect(within(panel).getByRole('button', { name: 'Отправить' })).toBeDisabled()

  const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
  await userEvent.click(within(panel).getByRole('button', { name: 'Закрыть без ответа' }))
  expect(confirm).toHaveBeenCalledTimes(1)
  await userEvent.click(within(panel).getByRole('button', { name: 'Закрыть без ответа' }))
  expect(await within(panel).findByText(/Закрыт без ответа/)).toBeInTheDocument()
  expect(answers).toEqual([])
  expect(drafts()).toBe(0)
})

test('кнопка уведомления «Открыть вопрос» (?question=ID) ведёт в «Пациенты → Вопросы»', () => {
  expect(readDeepLink('?question=5')).toEqual({ page: 'patients', questionId: 5 })
  expect(readDeepLink('?question=abc')).toBeNull()
})

test('ИИ-администратор бота: «🤖 Ответил ИИ» с текстом в «Отвеченных», «Передано сотрудникам» — в «Ждут ответа»', async () => {
  window.location.hash = '/patients'
  const byAi: Question = {
    id: 7, status: 'ANSWERED', text: 'Где вы находитесь?', createdAt: '2026-11-03T04:00:00Z', answeredAt: '2026-11-03T04:00:05Z',
    answer: 'Мы на Киевской, 1.', aiOutcome: 'ANSWERED', aiAnswer: 'Мы на Киевской, 1.',
  }
  const passed: Question = {
    id: 8, status: 'NEW', text: 'Почему болит зуб?', createdAt: '2026-11-03T05:00:00Z', aiOutcome: 'ESCALATED',
    aiAnswer: 'Это лучше обсудить с врачом на приёме.\n\nПередал администратору — ответим здесь в рабочее время 🙏',
  }
  const questions = [byAi, passed]
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/patients/recent', () => HttpResponse.json([])),
    http.get('*/api/patient-questions/new-count', () => HttpResponse.json({ count: 1 })),
    http.get('*/api/patient-questions', ({ request }) => {
      const done = new URL(request.url).searchParams.get('done') === 'true'
      return HttpResponse.json({ questions: questions.filter((q) => (q.status !== 'NEW') === done), ai: true, aiAvailable: true, botAi: true } satisfies Schemas['QuestionControllerQuestionList'])
    }),
    http.get('*/api/patient-questions/:id', ({ params }) => HttpResponse.json(questions.find((q) => q.id === Number(params.id)))),
  )
  renderApp()
  await userEvent.click(await findSub(/Вопросы/))
  expect(await screen.findByText(/сначала отвечает ИИ-помощник/)).toBeInTheDocument()
  const waiting = await screen.findByRole('table', { name: 'Вопросы пациентов' })
  expect(waiting).toHaveTextContent('Передано сотрудникам')
  await userEvent.click(within(waiting).getByRole('button', { name: 'Нет в базе клиники' }))
  let panel = await screen.findByRole('complementary', { name: 'Вопрос пациента' })
  expect(await within(panel).findByText(/ИИ не стал отвечать сам/)).toBeInTheDocument()
  expect(within(panel).getByRole('region', { name: 'Передано сотрудникам' })).toHaveTextContent('Это лучше обсудить с врачом')
  // Отвечает сотрудник — как обычно
  expect(within(panel).getByLabelText('Ответ пациенту')).toBeInTheDocument()

  await userEvent.click(within(panel).getByRole('button', { name: 'Закрыть' }))
  await userEvent.click(screen.getByRole('tab', { name: 'Отвеченные' }))
  const done = await screen.findByRole('table', { name: 'Вопросы пациентов' })
  await waitForSlow(() => expect(done).toHaveTextContent('🤖 Ответил ИИ'))
  await userEvent.click(within(done).getByRole('button', { name: 'Нет в базе клиники' }))
  panel = await screen.findByRole('complementary', { name: 'Вопрос пациента' })
  const answer = await within(panel).findByRole('region', { name: 'Ответ ИИ' })
  expect(answer).toHaveTextContent('🤖 Ответил ИИ')
  expect(answer).toHaveTextContent('Мы на Киевской, 1.')
  expect(within(panel).queryByLabelText('Ответ пациенту')).not.toBeInTheDocument()
})

test('ИИ записал по «Да» пациента — пометка в списке и в вопросе', async () => {
  window.location.hash = '/patients'
  const booked: Question = {
    id: 9, status: 'ANSWERED', text: 'Запишите на чистку', createdAt: '2026-11-03T04:00:00Z', answeredAt: '2026-11-03T04:00:05Z',
    answer: 'Могу записать вас 👍', aiOutcome: 'ANSWERED', aiAnswer: 'Могу записать вас 👍\n\nЗаписать вас: суббота, 9 ноября, в 10:00 · Профчистка · врач Айгерим?',
    aiAction: 'BOOKED', patientId: 3, patientName: 'Айпери Вымышленная',
  }
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/patients/recent', () => HttpResponse.json([])),
    http.get('*/api/patient-questions/new-count', () => HttpResponse.json({ count: 0 })),
    http.get('*/api/patient-questions', ({ request }) => {
      const done = new URL(request.url).searchParams.get('done') === 'true'
      return HttpResponse.json({ questions: done ? [booked] : [], ai: true, aiAvailable: true, botAi: true } satisfies Schemas['QuestionControllerQuestionList'])
    }),
    http.get('*/api/patient-questions/:id', () => HttpResponse.json(booked)),
  )
  renderApp()
  await userEvent.click(await findSub(/Вопросы/))
  await userEvent.click(await screen.findByRole('tab', { name: 'Отвеченные' }))
  const done = await screen.findByRole('table', { name: 'Вопросы пациентов' })
  await waitForSlow(() => expect(done).toHaveTextContent('🤖 ИИ записал (пациент подтвердил)'))
  await userEvent.click(within(done).getByRole('button', { name: 'Айпери Вымышленная' }))
  const panel = await screen.findByRole('complementary', { name: 'Вопрос пациента' })
  const answer = await within(panel).findByRole('region', { name: 'Ответ ИИ' })
  expect(answer).toHaveTextContent('заявка в расписании')
  expect(answer).toHaveTextContent('Записать вас: суббота, 9 ноября')
})
