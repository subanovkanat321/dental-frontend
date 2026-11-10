import { screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'

import { appointment, me, renderApp } from '../test/fixtures'
import { server } from '../test/server'

/** Ассистент Дастана (вымышленные): без «Кассы», в расписании — только его врач, может вести приём. */
const assistant = { ...me, admin: false, doctorId: undefined, fullName: 'Асель', assistantOf: [2] }

test('ассистент: только расписание своего врача и без «Кассы»', async () => {
  const asked: string[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(assistant)),
    http.get('*/api/appointments', ({ request }) => {
      const doctorId = new URL(request.url).searchParams.get('doctorId')!
      asked.push(doctorId)
      return HttpResponse.json(doctorId === '2' ? [appointment(10, 2, '10:00', 'Бакыт М.')] : [])
    }),
  )
  renderApp()
  const nav = await screen.findByRole('navigation', { name: 'Разделы' })
  expect(within(nav).queryByRole('button', { name: /^Касса/ })).not.toBeInTheDocument()
  expect(within(nav).getByRole('button', { name: /Расписание/ })).toBeInTheDocument()
  expect(await screen.findByText('Бакыт М.')).toBeInTheDocument()
  // Чужого врача не спрашиваем и не показываем
  expect(asked).not.toContain('1')
  expect(screen.queryByText('Айгерим Садыкова')).not.toBeInTheDocument()
})
