import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, openItem, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { choose } from '../test/select'
import { waitForSlow } from '../test/wait'

type Settings = Schemas['AutoComebacksSettings']
type View = Schemas['AutoComebacksView']

afterEach(() => { window.location.hash = '' })

const OFF: Settings = { enabled: false, plan: true, recall: true, noShow: true, cancelled: true, sendHour: 11, dailyLimit: 20 }

test('«Настройки → Привлечение пациентов → Позвать снова»: выключено; включить, причина, час и лимит — сохраняются сразу', async () => {
  const puts: Settings[] = []
  let state: View = { settings: OFF, lastRun: { day: '2026-11-26', sent: 5, failed: 1, noTelegram: 7 } }
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/clinic/comeback-auto', () => HttpResponse.json(state)),
    http.put('*/api/clinic/comeback-auto', async ({ request }) => {
      const body = (await request.json()) as Settings
      puts.push(body)
      state = { ...state, settings: body }
      return HttpResponse.json(state)
    }),
  )
  renderApp()
  openItem('comeback-auto')
  const box = await screen.findByRole('region', { name: 'Звать пациентов автоматически' })
  const on = within(box).getByRole('checkbox', { name: /Звать пациентов автоматически/ })
  expect(on).not.toBeChecked()
  // Выключено — причины, час и лимит не меняются
  expect(within(box).getByRole('checkbox', { name: /Пора на осмотр/ })).toBeDisabled()
  expect(within(box).getByRole('status')).toHaveTextContent('Последний раз — чт 26 нояб: позвали 5 · не доставлено 1 · без Telegram 7.')

  await userEvent.click(on)
  await waitForSlow(() => expect(on).toBeChecked())
  await userEvent.click(within(box).getByRole('checkbox', { name: /Пора на осмотр/ }))
  await waitForSlow(() => expect(puts).toHaveLength(2))
  await choose(within(box).getByLabelText('Во сколько звать'), '10:00')
  await waitForSlow(() => expect(puts).toHaveLength(3))
  await choose(within(box).getByLabelText('Не больше в день'), '5 пациентов')
  await waitForSlow(() => expect(puts).toHaveLength(4))
  expect(puts[3]).toEqual({ ...OFF, enabled: true, recall: false, sendHour: 10, dailyLimit: 5 })
  // Вкладка — в «Привлечении пациентов», рядом с «Днями рождения»
  expect(screen.getByRole('tab', { name: /Позвать/ })).toHaveAttribute('aria-selected', 'true')
})

test('«Позвать снова» в настройках: врачу без прав руководителя вкладки нет, ошибка сервера — под формой', async () => {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/clinic/comeback-auto', () => HttpResponse.json({ settings: OFF } satisfies View)),
    http.put('*/api/clinic/comeback-auto', () => HttpResponse.json(
      { status: 403, title: 'Forbidden', detail: 'Звать пациентов от имени клиники настраивает руководитель' }, { status: 403 })),
  )
  const { unmount } = renderApp()
  openItem('comeback-auto')
  const box = await screen.findByRole('region', { name: 'Звать пациентов автоматически' })
  await userEvent.click(within(box).getByRole('checkbox', { name: /Звать пациентов автоматически/ }))
  expect(await within(box).findByRole('alert')).toHaveTextContent('настраивает руководитель')
  unmount()

  server.use(http.get('*/api/patient/me', () => HttpResponse.json({ ...me, admin: false })))
  renderApp()
  openItem('attract')
  expect(await screen.findByRole('tab', { name: /Откуда/ })).toBeInTheDocument()
  expect(screen.queryByRole('tab', { name: /Позвать/ })).toBeNull()
})
