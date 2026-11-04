import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { addDays, todayIn } from '../lib/time'
import { appointment, me, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { choose } from '../test/select'

/** Приём через n дней в time — вымышленный пациент. */
function later(id: number, doctorId: number, days: number, time: string, name: string, extra: Partial<Schemas['AppointmentView']> = {}) {
  const a = appointment(id, doctorId, time, name, extra)
  const start = new Date(`${addDays(todayIn(), days)}T${time}:00+06:00`)
  return { ...a, startAt: start.toISOString(), endAt: new Date(start.getTime() + 30 * 60000).toISOString() }
}

afterEach(() => {
  window.location.hash = ''
})

test('«Пациенты → Записаны»: будущие записи всех врачей по дням, без отменённых; «не подтвердили», врач, период', async () => {
  const asked: string[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments/range', ({ request }) => {
      const q = new URL(request.url).searchParams
      asked.push(`${q.get('doctorId')}:${q.get('days')}`)
      return HttpResponse.json(q.get('doctorId') === '1'
        ? [later(1, 1, 1, '10:00', 'Айгуль Т.', { serviceName: 'Лечение кариеса', reply: 'CONFIRMED' }),
            later(2, 1, 1, '12:00', 'Отменённая К.', { status: 'CANCELLED' }),
            later(3, 1, 3, '09:00', 'Бакыт М.')]
        : [later(4, 2, 1, '11:00', 'Нурлан К.', { status: 'REQUESTED' })])
    }),
  )
  window.location.hash = '/patients'
  renderApp()
  await userEvent.click(await screen.findByRole('tab', { name: 'Записаны' }))
  const list = await screen.findByRole('region', { name: 'Записанные пациенты' })
  expect(await within(list).findByText('Айгуль Т.')).toBeInTheDocument()
  expect(list).toHaveTextContent('Записей: 3')
  expect(within(list).queryByText('Отменённая К.')).toBeNull()
  // По дням и по времени: завтра 10:00 Айгуль, 11:00 Нурлан (заявка) — потом через 3 дня Бакыт
  const names = within(list).getAllByRole('listitem').map((li) => li.querySelector('strong')?.textContent)
  expect(names).toEqual(['Айгуль Т.', 'Нурлан К.', 'Бакыт М.'])
  expect(list).toHaveTextContent('Придёт')
  expect(list).toHaveTextContent('Заявка — подтвердите')
  expect(asked).toEqual(expect.arrayContaining(['1:7', '2:7']))

  // Только кто не подтвердил: Айгуль (придёт) уходит
  await userEvent.click(within(list).getByRole('checkbox', { name: /не подтвердил/ }))
  expect(within(list).queryByText('Айгуль Т.')).toBeNull()
  expect(list).toHaveTextContent('Записей: 2')

  // Один врач и месяц — запрос с days=31 только по нему
  await choose(within(list).getByRole('combobox', { name: 'Врач' }), 'Дастан Т.')
  await userEvent.click(within(list).getByRole('button', { name: 'Месяц' }))
  expect(await within(list).findByText('Нурлан К.')).toBeInTheDocument()
  expect(within(list).queryByText('Бакыт М.')).toBeNull()
  expect(asked).toContain('2:31')
})
