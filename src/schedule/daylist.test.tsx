import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import { slotInstant, todayIn } from '../lib/time'
import { appointment, me, renderApp } from '../test/fixtures'
import { server } from '../test/server'

/** Телефон: экран уже 760px — «День» списком. */
beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('max-width'), media: query, addEventListener() {}, removeEventListener() {}, onchange: null,
    addListener() {}, removeListener() {}, dispatchEvent: () => false,
  }))
})
afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

const at = (time: string) => slotInstant(todayIn(), Number(time.slice(0, 2)) * 60 + Number(time.slice(3)))

function backend() {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments', ({ request }) => {
      const doctorId = Number(new URL(request.url).searchParams.get('doctorId'))
      return HttpResponse.json(doctorId === 1 ? [appointment(10, 1, '10:00', 'Бакыт М.')] : [appointment(11, 2, '12:00', 'Нурлан К.')])
    }),
    http.get('*/api/appointments/counts', () => HttpResponse.json([])),
    http.get('*/api/slots', ({ request }) => {
      const doctorId = Number(new URL(request.url).searchParams.get('doctorId'))
      return HttpResponse.json({
        workingDay: true, breaks: [],
        free: doctorId === 1 ? [{ start: at('13:00'), end: at('15:00') }] : [{ start: at('09:00'), end: at('12:00') }],
      })
    }),
  )
}

test('телефон, «Все врачи» — список: приёмы обоих врачей и свободные окна с именем врача', async () => {
  backend()
  localStorage.setItem('crm.schedule.view', 'all')
  renderApp()
  expect(await screen.findByRole('button', { name: /10:00–10:30, Бакыт М\./ })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /12:00–12:30, Нурлан К\./ })).toBeInTheDocument()
  expect(screen.queryByRole('group', { name: 'Дастан Т.' })).not.toBeInTheDocument() // не сетка

  await userEvent.click(screen.getByRole('button', { name: /Свободно с 09:00 до 12:00 у врача Дастан/ }))
  const panel = screen.getByRole('complementary', { name: 'Новая запись' })
  expect(within(panel).getByLabelText('Врач')).toHaveValue('2')
})

test('телефон, один врач — только его приёмы и окна', async () => {
  backend()
  localStorage.setItem('crm.schedule.view', '1')
  renderApp()
  expect(await screen.findByRole('button', { name: /10:00–10:30, Бакыт М\./ })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /12:00–12:30, Нурлан К\./ })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Свободно с 13:00 до 15:00, записать/ })).toBeInTheDocument()
})
