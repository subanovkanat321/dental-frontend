import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { addDays, todayIn } from '../lib/time'
import { appointment, me, renderApp, findSub } from '../test/fixtures'
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
  await userEvent.click(await findSub('Записаны'))
  const list = await screen.findByRole('region', { name: 'Записанные пациенты' })
  expect(await within(list).findByText('Айгуль Т.')).toBeInTheDocument()
  // Фильтры и «Записей: N» — в строке шапки «Пациентов» (PageHead), список — под ней
  expect(screen.getByText('Записей: 3')).toBeInTheDocument()
  expect(within(list).queryByText('Отменённая К.')).toBeNull()
  // По дням и по времени: завтра 10:00 Айгуль, 11:00 Нурлан (заявка) — потом через 3 дня Бакыт
  const names = within(list).getAllByRole('listitem').map((li) => li.querySelector('strong')?.textContent)
  expect(names).toEqual(['Айгуль Т.', 'Нурлан К.', 'Бакыт М.'])
  expect(list).toHaveTextContent('Придёт')
  expect(list).toHaveTextContent('Заявка — подтвердите')
  expect(asked).toEqual(expect.arrayContaining(['1:7', '2:7']))

  // Только кто не подтвердил: Айгуль (придёт) уходит
  await userEvent.click(screen.getByRole('checkbox', { name: /не подтвердил/ }))
  expect(within(list).queryByText('Айгуль Т.')).toBeNull()
  expect(await screen.findByText('Записей: 2')).toBeInTheDocument()

  // Один врач и месяц — запрос с days=31 только по нему
  await choose(screen.getByRole('combobox', { name: 'Врач' }), 'Дастан Т.')
  await userEvent.click(screen.getByRole('button', { name: 'Месяц' }))
  expect(await within(list).findByText('Нурлан К.')).toBeInTheDocument()
  expect(within(list).queryByText('Бакыт М.')).toBeNull()
  expect(asked).toContain('2:31')
})

test('кнопка сводки «📲 Напомнить» (?screen=booked&day=tomorrow&unconfirmed=1&doctor=2): «Записаны» на завтра, только кто не подтвердил, этот врач', async () => {
  const asked: string[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments/range', ({ request }) => {
      const q = new URL(request.url).searchParams
      asked.push(`${q.get('doctorId')}:${q.get('from')}:${q.get('days')}`)
      return HttpResponse.json([later(4, 2, 1, '11:00', 'Нурлан К.'), later(5, 2, 1, '12:00', 'Айгуль Т.', { reply: 'CONFIRMED' })])
    }),
  )
  window.history.replaceState(null, '', '/?screen=booked&day=tomorrow&unconfirmed=1&doctor=2&v=abc')
  renderApp()
  const list = await screen.findByRole('region', { name: 'Записанные пациенты' })
  expect(await within(list).findByText('Нурлан К.')).toBeInTheDocument()
  expect(within(list).queryByText('Айгуль Т.')).toBeNull()
  expect(screen.getByRole('button', { name: 'Завтра' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('checkbox', { name: /не подтвердил/ })).toBeChecked()
  expect(screen.getByRole('combobox', { name: 'Врач' })).toHaveTextContent('Дастан Т.')
  expect(asked).toEqual([`2:${addDays(todayIn(), 1)}:1`])
  // Адрес чистый: ссылку не открыть повторно обновлением страницы
  expect(window.location.search).toBe('')
  expect(window.location.hash).toBe('#/patients/booked')
  window.history.replaceState(null, '', '/')
})

test('«WhatsApp» в строке неподтверждённого: готовый текст напоминания и отметка «напомнили»; у подтвердивших и заявок кнопки нет', async () => {
  const calls: string[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments/range', ({ request }) => HttpResponse.json(new URL(request.url).searchParams.get('doctorId') === '1'
      ? [later(1, 1, 1, '10:00', 'Бакыт М.', { patient: { id: 1, fullName: 'Бакыт М.', phone: '996700111222', telegram: true }, reminderOpenedAt: new Date().toISOString() }),
          later(2, 1, 1, '11:00', 'Айгуль Т.', { reply: 'CONFIRMED' }),
          later(3, 1, 1, '12:00', 'Нурлан К.', { status: 'REQUESTED' })]
      : [])),
    http.post('*/api/appointments/:id/reminder-opened', ({ params }) => {
      calls.push(`opened:${String(params.id)}`)
      return new HttpResponse(null, { status: 204 })
    }),
  )
  const opened: string[] = []
  vi.spyOn(window, 'open').mockImplementation((url) => { opened.push(String(url)); return null })
  window.location.hash = '/patients'
  renderApp()
  await userEvent.click(await findSub('Записаны'))
  const list = await screen.findByRole('region', { name: 'Записанные пациенты' })
  // Telegram-пациент, бот уже писал, ответа нет — WhatsApp всё равно можно
  const wa = await within(list).findByRole('button', { name: /Напомнить в WhatsApp: Бакыт М\., 10:00/ })
  expect(within(list).queryByRole('button', { name: /WhatsApp: Айгуль/ })).toBeNull()
  expect(within(list).queryByRole('button', { name: /WhatsApp: Нурлан/ })).toBeNull()
  await vi.waitFor(() => expect(wa).toBeEnabled()) // ждёт настройки: без них в тексте нет подписи
  await userEvent.click(wa)
  expect(opened[0]).toContain('phone=996700111222')
  expect(decodeURIComponent(opened[0]!)).toContain('Стоматология «Тест»')
  await vi.waitFor(() => expect(calls).toEqual(['opened:1']))
  vi.restoreAllMocks()
})
