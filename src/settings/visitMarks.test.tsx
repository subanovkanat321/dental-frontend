import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, openItem, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { waitForSlow } from '../test/wait'

type View = Schemas['VisitSettingsControllerVisitSettingsView']

function backend(who: Schemas['BookingViewsMe'] = me) {
  const puts: View[] = []
  let state: View = { markArrival: false }
  let meCalls = 0
  server.use(
    http.get('*/api/patient/me', () => { meCalls++; return HttpResponse.json(who) }),
    http.get('*/api/clinic/visit-settings', () => HttpResponse.json(state)),
    http.put('*/api/clinic/visit-settings', async ({ request }) => {
      const body = (await request.json()) as View
      puts.push(body)
      state = body
      return HttpResponse.json(state)
    }),
  )
  return { puts, meCalls: () => meCalls }
}

afterEach(() => { window.location.hash = '' })

test('«Настройки → Приём → Отметки приёма»: по умолчанию выключено; включение сохраняется сразу и обновляет «me»', async () => {
  const { puts, meCalls } = backend()
  renderApp()
  openItem('visit-marks')
  const box = await screen.findByRole('region', { name: 'Отметки приёма' })
  const toggle = within(box).getByRole('checkbox', { name: 'Отмечать приход пациента (Пришёл / В кресле)' })
  await waitForSlow(() => expect(box).toHaveTextContent('Выключено: главная кнопка в день приёма — сразу «✅ Приём состоялся»'))
  expect(toggle).not.toBeChecked()
  const before = meCalls()
  await userEvent.click(toggle)
  await waitForSlow(() => expect(toggle).toBeChecked())
  expect(puts).toEqual([{ markArrival: true }])
  expect(box).toHaveTextContent('«🟢 Пришёл» → «💺 Начать приём» → «✅ Приём состоялся»')
  // Расписание берёт настройку из clinic.markArrival — «me» запрошен заново
  await waitForSlow(() => expect(meCalls()).toBeGreaterThan(before))
})

test('пункта «Отметки приёма» нет у не-руководителя', async () => {
  backend({ ...me, admin: false })
  renderApp()
  openItem('visit-marks')
  expect(screen.queryByRole('region', { name: 'Отметки приёма' })).not.toBeInTheDocument()
})
