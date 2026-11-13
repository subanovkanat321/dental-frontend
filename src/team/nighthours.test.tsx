import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { createQueryClient } from '../api/queryClient'
import { server } from '../test/server'
import { WeekEditor } from './HoursEditor'

/** Ночная смена в «Часах работы» (V186): конец раньше начала — «до утра след. дня», а не ошибка. Врач вымышленный. */
function renderEditor() {
  const client = createQueryClient({ queries: { retry: false } })
  return render(<QueryClientProvider client={client}><WeekEditor who={{ kind: 'doctor', id: 2, name: 'Эрмек Т.' }} /></QueryClientProvider>)
}

test('Пн 18:00 → 08:00: подпись «до утра след. дня», сохраняется как есть', async () => {
  let sent: unknown = null
  server.use(
    http.get('*/api/doctors/:id/hours', () => HttpResponse.json({ custom: true, days: [{ weekday: 'MONDAY', start: '09:00:00', end: '18:00:00' }] } satisfies Schemas['DoctorHoursView'])),
    http.put('*/api/doctors/:id/hours', async ({ request }) => {
      sent = await request.json()
      return HttpResponse.json({ custom: true, days: [{ weekday: 'MONDAY', start: '18:00:00', end: '08:00:00' }] } satisfies Schemas['DoctorHoursView'])
    }),
  )
  const user = userEvent.setup()
  renderEditor()
  const from = await screen.findByLabelText('Понедельник: с')
  expect(screen.queryByText(/до утра след. дня/)).not.toBeInTheDocument()
  await user.clear(from)
  await user.type(from, '18:00')
  const to = screen.getByLabelText('Понедельник: до')
  await user.clear(to)
  await user.type(to, '08:00')
  const row = from.closest('.hours-row') as HTMLElement
  expect(within(row).getByText('🌙 до утра след. дня')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Сохранить часы' }))
  expect(await screen.findByText('Часы работы сохранены')).toBeInTheDocument()
  expect(sent).toEqual({ days: [{ weekday: 'MONDAY', start: '18:00', end: '08:00' }] })
})

test('начало и конец совпадают — понятная ошибка, на сервер не уходит', async () => {
  let calls = 0
  server.use(
    http.get('*/api/doctors/:id/hours', () => HttpResponse.json({ custom: true, days: [{ weekday: 'MONDAY', start: '09:00:00', end: '18:00:00' }] } satisfies Schemas['DoctorHoursView'])),
    http.put('*/api/doctors/:id/hours', () => {
      calls++
      return HttpResponse.json({ custom: true, days: [] })
    }),
  )
  const user = userEvent.setup()
  renderEditor()
  const to = await screen.findByLabelText('Понедельник: до')
  await user.clear(to)
  await user.type(to, '09:00')
  await user.click(screen.getByRole('button', { name: 'Сохранить часы' }))
  expect(await screen.findByText(/Понедельник: начало и конец совпадают/)).toBeInTheDocument()
  expect(calls).toBe(0)
})
