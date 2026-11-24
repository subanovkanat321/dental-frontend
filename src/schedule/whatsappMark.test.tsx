import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { appointment, me, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { waitForSlow } from '../test/wait'

type Appointment = Schemas['AppointmentView']

/** Телефон: «День» списком (как daylist.test). */
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

function backend(list: Appointment[], wa?: Schemas['WhatsAppAdminClinicView']) {
  const reminded: number[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments', ({ request }) => HttpResponse.json(new URL(request.url).searchParams.get('doctorId') === '1' ? list : [])),
    http.get('*/api/appointments/counts', () => HttpResponse.json([])),
    http.get('*/api/slots', () => HttpResponse.json({ workingDay: true, breaks: [], free: [] })),
    ...(wa ? [http.get('*/api/clinic/whatsapp', () => HttpResponse.json(wa))] : []),
    http.post('*/api/appointments/:id/remind-whatsapp', ({ params }) => {
      reminded.push(Number(params.id))
      const a = list.find((x) => x.id === Number(params.id))!
      return HttpResponse.json({ ...a, reminderOpenedAt: new Date().toISOString(), whatsapp: { kind: 'REMINDER', status: 'QUEUED', at: new Date().toISOString() } } satisfies Appointment)
    }),
  )
  return reminded
}

/** «ЧЧ:ММ» через полчаса по Бишкеку; null — уже поздно (приём перешёл бы на завтра). */
function soon(): string | null {
  const parts = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Bishkek', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(Date.now() + 30 * 60000))
  const [h, m] = parts.split(':').map(Number)
  if (h! * 60 + m! > 23 * 60 + 20 || h! * 60 + m! < 60) return null
  return `${String(h).padStart(2, '0')}:${String(Math.floor(m! / 5) * 5).padStart(2, '0')}`
}

test('Tish писал о приёме в WhatsApp: «📲 WhatsApp: доставлено / прочитано / не доставлено» в «Дне» и в карточке', async () => {
  backend([
    appointment(10, 1, '10:00', 'Бакыт М.', { reminderOpenedAt: '2026-11-23T12:00:00Z', whatsapp: { kind: 'REMINDER', status: 'DELIVERED', at: '2026-11-23T12:00:00Z' } }),
    appointment(11, 1, '11:00', 'Айгуль Т.', { whatsapp: { kind: 'CONFIRMATION', status: 'READ', at: '2026-11-23T12:00:00Z' } }),
    appointment(12, 1, '12:00', 'Нурлан С.', { whatsapp: { kind: 'SOON', status: 'FAILED', at: '2026-11-23T12:00:00Z' } }),
    appointment(13, 1, '13:00', 'Мээрим К.'),
  ])
  const user = userEvent.setup()
  renderApp()
  // В строке «Дня» коротко — «WA», полностью — в подсказке
  expect(await screen.findByText('📲 WA: доставлено')).toHaveAttribute('title', '📲 WhatsApp: доставлено')
  expect(screen.getByText('📲 WA: прочитано')).toBeInTheDocument()
  expect(screen.getByText('📲 WA: не доставлено').closest('.wa-mark')).toHaveClass('tone-bad')
  expect(screen.getAllByText(/📲 WA:/)).toHaveLength(3)

  await user.click(screen.getAllByRole('button', { name: /Бакыт М\./ })[0]!)
  const panel = screen.getByRole('complementary', { name: 'Карточка приёма' })
  expect(within(panel).getByText(/📲 WhatsApp: доставлено/)).toHaveTextContent('напоминание накануне')
})

test.skipIf(soon() == null)('клиника подключила WhatsApp и шаблон утверждён — «WA» отправляет напоминание через Tish, а не открывает WhatsApp', async () => {
  const time = soon()!
  const reminded = backend([appointment(20, 1, time, 'Жылдыз А.')], {
    available: true, connected: true, confirmation: true, reminder: true, soon: true, recent: [],
    templates: [{ name: 'appointment_reminder', kind: 'REMINDER', lang: 'ru', status: 'APPROVED' }],
  })
  const opened = vi.spyOn(window, 'open').mockReturnValue(null)
  const user = userEvent.setup()
  renderApp()
  const button = await screen.findByRole('button', { name: new RegExp(`Напомнить в WhatsApp: Жылдыз А\\., ${time}`) })
  await user.click(button)
  await waitForSlow(() => expect(reminded).toEqual([20]))
  expect(await screen.findByText('Напоминание отправлено через WhatsApp')).toBeInTheDocument()
  expect(opened).not.toHaveBeenCalled()
})
