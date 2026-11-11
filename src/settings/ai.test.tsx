import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, openItem, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { waitForSlow } from '../test/wait'

type Setting = Schemas['VisitReportControllerAiSetting']
type Change = Schemas['VisitReportControllerAiChange']

/** Три согласия клиники на сервере — каждое меняется только своим адресом. */
function backend(reports: Setting, dictation: Setting, who: Schemas['BookingViewsMe'] = me,
  usage: Schemas['AiUsageStoreCounter'] = { month: '2026-11', used: 120, limit: 600 }, post: Setting = { available: reports.available, on: false },
  bot: Setting = { available: reports.available, on: false }) {
  const puts: [string, Change][] = []
  const state = { 'visit-report-ai': reports, 'dictation-ai': dictation, 'post-ai': post, 'bot-ai': bot }
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(who)),
    http.get('*/api/clinic/ai-usage', () => HttpResponse.json(usage)),
    http.get('*/api/clinic/:what', ({ params }) => HttpResponse.json(state[params.what as keyof typeof state])),
    http.put('*/api/clinic/:what', async ({ params, request }) => {
      const key = params.what as keyof typeof state
      const body = (await request.json()) as Change
      puts.push([key, body])
      state[key] = { ...state[key], on: Boolean(body.on) }
      // Как сервер: выключили общий ИИ — выключились и ответы в боте
      if (key === 'visit-report-ai' && !body.on) state['bot-ai'] = { ...state['bot-ai'], on: false }
      return HttpResponse.json(state[key])
    }),
  )
  return puts
}

afterEach(() => { window.location.hash = '' })

test('«ИИ-помощник»: диктовка включается отдельно от отчётов, с подписью, что уходит в ИИ', async () => {
  const puts = backend({ available: true, on: true }, { available: true, on: false })
  renderApp()
  openItem('ai')
  const dictation = await screen.findByRole('region', { name: 'ИИ разбирает голосовую диктовку' })
  const reports = screen.getByRole('region', { name: 'ИИ пишет отчёты пациенту' })
  expect(dictation).toHaveTextContent('В ИИ уходит текст диктовки — без имени и телефона пациента')
  const reportBox = within(reports).getByRole('checkbox')
  await waitForSlow(() => expect(reportBox).toBeChecked())
  const box = within(dictation).getByRole('checkbox')
  expect(box).not.toBeChecked()

  await userEvent.click(box)
  await waitForSlow(() => expect(box).toBeChecked())
  expect(puts).toEqual([['dictation-ai', { on: true }]])
  // Отчёты не тронуты
  expect(reportBox).toBeChecked()

  await userEvent.click(reportBox)
  await waitForSlow(() => expect(reportBox).not.toBeChecked())
  expect(box).toBeChecked()
  expect(puts).toEqual([['dictation-ai', { on: true }], ['visit-report-ai', { on: false }]])
})

test('«ИИ для постов «до / после»» — отдельный переключатель: подпись про фото, остальные не трогает', async () => {
  const puts = backend({ available: true, on: true }, { available: true, on: false })
  renderApp()
  openItem('ai')
  const post = await screen.findByRole('region', { name: 'ИИ для постов «до / после»' })
  expect(post).toHaveTextContent('ИИ не меняет фото — только подбирает кадр и пишет текст')
  expect(post).toHaveTextContent('В ИИ уходят уменьшенные копии двух выбранных фото')
  const box = within(post).getByRole('checkbox')
  await waitForSlow(() => expect(box).toBeEnabled())
  expect(box).not.toBeChecked()
  await userEvent.click(box)
  await waitForSlow(() => expect(box).toBeChecked())
  expect(puts).toEqual([['post-ai', { on: true }]])
  expect(within(screen.getByRole('region', { name: 'ИИ разбирает голосовую диктовку' })).getByRole('checkbox')).not.toBeChecked()
})

test('ИИ на сервере не подключён — переключатели не нажать', async () => {
  backend({ available: false, on: false }, { available: false, on: false })
  renderApp()
  openItem('ai')
  const dictation = await screen.findByRole('region', { name: 'ИИ разбирает голосовую диктовку' })
  await waitForSlow(() => expect(dictation).toHaveTextContent('ИИ на сервере не подключён'))
  expect(within(dictation).getByRole('checkbox')).toBeDisabled()
})

test('пункт «ИИ-помощник» — только у администратора', async () => {
  backend({ available: true, on: false }, { available: true, on: false }, { ...me, admin: false })
  renderApp()
  openItem('')
  expect(await screen.findByRole('heading', { name: 'Настройки' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /ИИ-помощник/ })).not.toBeInTheDocument()
})

test('лимит ИИ клинике пока не показываем: счётчика «N из M» нет', async () => {
  backend({ available: true, on: true }, { available: true, on: false })
  renderApp()
  openItem('ai')
  await screen.findByRole('region', { name: 'ИИ пишет отчёты пациенту' })
  expect(screen.queryByRole('region', { name: 'ИИ в этом месяце' })).not.toBeInTheDocument()
  expect(screen.queryByText(/использовано/)).not.toBeInTheDocument()
})

test('«ИИ отвечает пациентам в боте»: предупреждение, без общего согласия не нажать, выключили общий — выключился и бот', async () => {
  const puts = backend({ available: true, on: false }, { available: true, on: false })
  renderApp()
  openItem('ai')
  const bot = await screen.findByRole('region', { name: 'ИИ отвечает пациентам в боте' })
  expect(bot).toHaveTextContent('без имени, телефона и медкарты')
  expect(bot).toHaveTextContent('без проверки сотрудником')
  const box = within(bot).getByRole('checkbox')
  await waitForSlow(() => expect(bot).toHaveTextContent('Сначала включите «ИИ пишет отчёты пациенту»'))
  expect(box).toBeDisabled()

  const reportBox = within(screen.getByRole('region', { name: 'ИИ пишет отчёты пациенту' })).getByRole('checkbox')
  await userEvent.click(reportBox)
  await waitForSlow(() => expect(box).toBeEnabled())
  await userEvent.click(box)
  await waitForSlow(() => expect(box).toBeChecked())

  await userEvent.click(reportBox)
  await waitForSlow(() => expect(box).not.toBeChecked())
  expect(puts).toEqual([['visit-report-ai', { on: true }], ['bot-ai', { on: true }], ['visit-report-ai', { on: false }]])
})
