import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { Join } from '../site/Join'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'

const filled: Schemas['JoinCaseCase'] = {
  title: 'Пилот в клинике в Бишкеке', text: 'Пациенты записываются в боте, напоминания уходят сами.',
  metrics: [{ value: '120', label: 'записей через бота за месяц' }], shown: true,
}

test('/join: блок кейса есть, только когда владелец его заполнил', async () => {
  server.use(http.get('*/web/tariffs', () => HttpResponse.json({ pilotMonths: 3, tariffs: [] })))
  const empty = render(<Join />)
  expect(await screen.findByText(/Попробовать — бесплатно/)).toBeInTheDocument()
  expect(screen.queryByRole('region', { name: 'Как работает в клинике' })).not.toBeInTheDocument()
  empty.unmount()

  server.use(http.get('*/web/case', () => HttpResponse.json(filled)))
  render(<Join />)
  const block = await screen.findByRole('region', { name: 'Как работает в клинике' })
  expect(within(block).getByRole('heading', { name: 'Пилот в клинике в Бишкеке' })).toBeInTheDocument()
  expect(within(block).getByText('120')).toBeInTheDocument()
  expect(within(block).getByText('записей через бота за месяц')).toBeInTheDocument()
})

test('/join: заполнен только заголовок (shown = false) — блока нет', async () => {
  server.use(
    http.get('*/web/tariffs', () => HttpResponse.json({ pilotMonths: 3, tariffs: [] })),
    http.get('*/web/case', () => HttpResponse.json({ title: 'Черновик', metrics: [], shown: false } satisfies Schemas['JoinCaseCase'])),
  )
  render(<Join />)
  expect(await screen.findByText(/Попробовать — бесплатно/)).toBeInTheDocument()
  expect(screen.queryByText('Черновик')).not.toBeInTheDocument()
})

test('«Платформа → Настройки»: владелец пишет кейс и цифры', async () => {
  let saved: Schemas['JoinCaseRequest'] | null = null
  window.location.hash = '/platform'
  server.use(
    http.get('*/web/config', () => HttpResponse.json({ botUsername: 'tish_test_bot' })),
    http.get('*/api/patient/me', () => HttpResponse.json({ ...me, owner: true, platform: true })),
    http.get('*/api/platform/clinics', () => HttpResponse.json([])),
    http.get('*/api/platform/applications', () => HttpResponse.json([])),
    http.get('*/api/platform/agreements/statuses', () => HttpResponse.json({})),
    http.get('*/api/platform/pay-requests', () => HttpResponse.json([])),
    http.get('*/api/platform-info', () => HttpResponse.json({})),
    http.get('*/web/tariffs', () => HttpResponse.json({ pilotMonths: 3, tariffs: [] })),
    http.put('*/api/platform/case', async ({ request }) => {
      saved = await request.json() as Schemas['JoinCaseRequest']
      return HttpResponse.json(filled)
    }),
  )
  const user = userEvent.setup()
  renderApp()
  await user.click(await screen.findByRole('tab', { name: 'Настройки' }))
  const form = await screen.findByRole('form', { name: 'Кейс' })
  await user.type(within(form).getByRole('textbox', { name: 'Заголовок' }), 'Пилот в клинике в Бишкеке')
  await user.type(within(form).getByRole('textbox', { name: 'Короткая история' }), 'Пациенты записываются в боте.')
  const first = within(form).getByRole('group', { name: 'Цифра 1' })
  await user.type(within(first).getByRole('textbox', { name: 'Цифра 1' }), '120')
  await user.type(within(first).getByRole('textbox', { name: 'Подпись' }), 'записей через бота за месяц')
  await user.click(within(form).getByRole('button', { name: 'Сохранить кейс' }))
  expect(await within(form).findByRole('status')).toHaveTextContent('блок виден на /join')
  expect(saved).toEqual({ title: 'Пилот в клинике в Бишкеке', text: 'Пациенты записываются в боте.',
    metrics: [{ value: '120', label: 'записей через бота за месяц' }] })
  window.location.hash = ''
})
