import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, openItem, renderApp } from '../test/fixtures'
import { server } from '../test/server'

type Setting = Schemas['VisitReportControllerAiSetting']
type Change = Schemas['VisitReportControllerAiChange']

/** Два согласия клиники на сервере — каждое меняется только своим адресом. */
function backend(reports: Setting, dictation: Setting, who: Schemas['BookingViewsMe'] = me) {
  const puts: [string, Change][] = []
  const state = { 'visit-report-ai': reports, 'dictation-ai': dictation }
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
