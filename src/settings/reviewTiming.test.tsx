import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, openItem, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { waitForSlow } from '../test/wait'

type View = Schemas['ReviewSettingsControllerReviewTimingView']

function backend(timing: View['timing'] = 'TWO_HOURS') {
  const puts: View[] = []
  let state: View = { timing }
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/clinic/review-timing', () => HttpResponse.json(state)),
    http.put('*/api/clinic/review-timing', async ({ request }) => {
      const body = (await request.json()) as View
      puts.push(body)
      state = body
      return HttpResponse.json(state)
    }),
  )
  return puts
}

afterEach(() => { window.location.hash = '' })

test('«Оценка приёма»: по умолчанию — через 2 часа; выбор сохраняется сразу', async () => {
  const puts = backend()
  renderApp()
  openItem('reviews')
  const box = await screen.findByRole('region', { name: 'Когда спрашивать оценку' })
  expect(box).toHaveTextContent('С 21:00 до 9:00 бот не пишет')
  const twoHours = within(box).getByRole('radio', { name: /Через 2 часа после приёма/ })
  await waitForSlow(() => expect(twoHours).toBeChecked())

  await userEvent.click(within(box).getByRole('radio', { name: /На следующий день в 12:00/ }))
  await waitForSlow(() => expect(within(box).getByRole('radio', { name: /На следующий день/ })).toBeChecked())
  expect(puts).toEqual([{ timing: 'NEXT_DAY' }])
  expect(twoHours).not.toBeChecked()
})
