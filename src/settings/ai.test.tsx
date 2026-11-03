import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, openItem, renderApp } from '../test/fixtures'
import { server } from '../test/server'

type Setting = Schemas['VisitReportControllerAiSetting']
type Change = Schemas['VisitReportControllerAiChange']

/** Три согласия клиники на сервере — каждое меняется только своим адресом. */
function backend(reports: Setting, dictation: Setting, who: Schemas['BookingViewsMe'] = me, post: Setting = { available: reports.available, on: false }) {
  const puts: [string, Change][] = []
  const state = { 'visit-report-ai': reports, 'dictation-ai': dictation, 'post-ai': post }
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(who)),
    http.get('*/api/clinic/:what', ({ params }) => HttpResponse.json(state[params.what as keyof typeof state])),
    http.put('*/api/clinic/:what', async ({ params, request }) => {
      const key = params.what as keyof typeof state
      const body = (await request.json()) as Change
      puts.push([key, body])
      state[key] = { ...state[key], on: Boolean(body.on) }
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
  await vi.waitFor(() => expect(reportBox).toBeChecked())
  const box = within(dictation).getByRole('checkbox')
  expect(box).not.toBeChecked()

  await userEvent.click(box)
  await vi.waitFor(() => expect(box).toBeChecked())
  expect(puts).toEqual([['dictation-ai', { on: true }]])
  // Отчёты не тронуты
  expect(reportBox).toBeChecked()

  await userEvent.click(reportBox)
  await vi.waitFor(() => expect(reportBox).not.toBeChecked())
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
  await vi.waitFor(() => expect(box).toBeEnabled())
  expect(box).not.toBeChecked()
  await userEvent.click(box)
  await vi.waitFor(() => expect(box).toBeChecked())
  expect(puts).toEqual([['post-ai', { on: true }]])
  expect(within(screen.getByRole('region', { name: 'ИИ разбирает голосовую диктовку' })).getByRole('checkbox')).not.toBeChecked()
})

test('ИИ на сервере не подключён — переключатели не нажать', async () => {
  backend({ available: false, on: false }, { available: false, on: false })
  renderApp()
  openItem('ai')
  const dictation = await screen.findByRole('region', { name: 'ИИ разбирает голосовую диктовку' })
  await vi.waitFor(() => expect(dictation).toHaveTextContent('ИИ на сервере не подключён'))
  expect(within(dictation).getByRole('checkbox')).toBeDisabled()
})

test('пункт «ИИ-помощник» — только у администратора', async () => {
  backend({ available: true, on: false }, { available: true, on: false }, { ...me, admin: false })
  renderApp()
  openItem('')
  expect(await screen.findByRole('heading', { name: 'Настройки' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /ИИ-помощник/ })).not.toBeInTheDocument()
})
