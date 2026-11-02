import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { readDeepLink } from '../lib/deepLink'
import { me, openItem, renderApp } from '../test/fixtures'
import { server } from '../test/server'

afterEach(() => {
  window.location.hash = ''
})

const survey: Schemas['SurveyForm'] = {
  id: 5, title: 'Как вам Tish?', intro: 'Пара минут — читаем каждый ответ.',
  questions: [
    { id: 51, type: 'NPS', text: 'Порекомендуете ли Tish коллегам?', options: [], required: true },
    { id: 52, type: 'RATING', text: 'Насколько удобно?', options: [], required: false },
    { id: 53, type: 'MULTI', text: 'Что полезнее всего?', options: ['Расписание', 'Касса', 'Склад'], required: false },
    { id: 54, type: 'TEXT', text: 'Чего не хватает?', options: [], required: false },
    { id: 55, type: 'CONTACT', text: 'Можно с вами связаться?', options: [], required: false },
  ],
}

function staffBackend(current: Schemas['SurveyAnswersCurrent'], who: Schemas['BookingViewsMe'] = me) {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(who)),
    http.get('*/api/appointments', () => HttpResponse.json([])),
    http.get('*/api/surveys/current', () => HttpResponse.json(current)),
  )
}

test('приглашение над «Расписанием»: «Позже» прячет его, нажатие ведёт в опрос', async () => {
  staffBackend({ survey })
  let later = false
  server.use(http.post('*/api/surveys/5/later', () => {
    later = true
    return HttpResponse.json({ snoozedUntil: '2026-11-05T10:00:00Z' } satisfies Schemas['SurveyControllerLater'])
  }))
  renderApp()
  const invite = await screen.findByRole('button', { name: /Команда Tish просит вашего мнения: «Как вам Tish\?»/ })
  await userEvent.click(screen.getByRole('button', { name: 'Позже' }))
  expect(later).toBe(true)
  expect(invite).not.toBeInTheDocument()
})

test('приглашение открывает «Настройки → Отзыв о Tish»', async () => {
  staffBackend({ survey })
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: /просит вашего мнения/ }))
  expect(window.location.hash).toBe('#/settings/survey')
  expect(await screen.findByRole('form', { name: 'Как вам Tish?' })).toBeInTheDocument()
})

test('«Позже» действует — приглашения нет, хотя опрос ждёт ответа', async () => {
  let asked = false
  staffBackend({})
  server.use(http.get('*/api/surveys/current', () => {
    asked = true
    return HttpResponse.json({ survey, snoozedUntil: '2026-11-05T10:00:00Z' } satisfies Schemas['SurveyAnswersCurrent'])
  }))
  renderApp()
  await waitFor(() => expect(asked).toBe(true))
  await new Promise((r) => setTimeout(r, 50))
  expect(screen.queryByText(/просит вашего мнения/)).not.toBeInTheDocument()
})

test('ответ: обязательный вопрос подсвечен, отправка — ответы по видам вопросов, затем «Спасибо»', async () => {
  staffBackend({ survey })
  let sent: Schemas['SurveyControllerResponses'] | null = null
  server.use(http.post('*/api/surveys/5/responses', async ({ request }) => {
    sent = await request.json() as Schemas['SurveyControllerResponses']
    return new HttpResponse(null, { status: 204 })
  }))
  openItem('survey')
  renderApp()
  const form = await screen.findByRole('form', { name: 'Как вам Tish?' })
  const user = userEvent.setup()

  await user.click(within(form).getByRole('button', { name: 'Отправить ответ' }))
  expect(await within(form).findByText('Ответьте на этот вопрос')).toBeInTheDocument()
  expect(sent).toBeNull()

  await user.click(within(within(form).getByRole('group', { name: 'Порекомендуете ли Tish коллегам?' })).getByRole('button', { name: '9' }))
  expect(within(form).queryByText('Ответьте на этот вопрос')).not.toBeInTheDocument()
  await user.click(within(form).getByRole('button', { name: '4 из 5' }))
  await user.click(within(form).getByRole('checkbox', { name: 'Расписание' }))
  await user.click(within(form).getByRole('checkbox', { name: 'Склад' }))
  await user.type(within(form).getByRole('textbox', { name: 'Чего не хватает?' }), 'Отчёта по неделе')
  await user.click(within(within(form).getByRole('group', { name: 'Можно с вами связаться?' })).getByRole('button', { name: 'Да' }))
  await user.click(within(form).getByRole('button', { name: 'Отправить ответ' }))

  expect(await screen.findByRole('heading', { name: 'Спасибо!' })).toBeInTheDocument()
  expect(sent).toEqual({ answers: [
    { questionId: 51, number: 9 },
    { questionId: 52, number: 4 },
    { questionId: 53, choices: [0, 2] },
    { questionId: 54, text: 'Отчёта по неделе' },
    { questionId: 55, number: 1 },
  ] })
})

test('сервер отклонил ответ — ошибка под вопросом', async () => {
  staffBackend({ survey })
  server.use(http.post('*/api/surveys/5/responses', () => HttpResponse.json(
    { status: 422, detail: 'Проверьте поля', errors: [{ field: 'question-51', message: 'Оценка — от 0 до 10' }] }, { status: 422 })))
  openItem('survey')
  renderApp()
  const form = await screen.findByRole('form', { name: 'Как вам Tish?' })
  await userEvent.click(within(within(form).getByRole('group', { name: 'Порекомендуете ли Tish коллегам?' })).getByRole('button', { name: '10' }))
  await userEvent.click(within(form).getByRole('button', { name: 'Отправить ответ' }))
  expect(await within(form).findByText('Оценка — от 0 до 10')).toBeInTheDocument()
})

test('опросов нет — спасибо и путь в техподдержку', async () => {
  staffBackend({})
  openItem('survey')
  renderApp()
  expect(await screen.findByText('Сейчас опросов нет — спасибо, что заглянули!')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Написать в техподдержку' })).toBeInTheDocument()
})

test('кнопка бота «Пройти опрос» (?screen=survey) открывает пункт «Настроек»', () => {
  expect(readDeepLink('?screen=survey')).toEqual({ page: 'settings', tab: 'survey' })
})
