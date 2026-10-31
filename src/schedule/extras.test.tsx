import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { todayIn } from '../lib/time'
import { appointment, me, renderApp } from '../test/fixtures'
import { server } from '../test/server'

type Appointment = Schemas['AppointmentView']

/** Один приём на день; изменения — как на сервере. */
function backend(start: Appointment) {
  let a = { ...start }
  const sent: { path: string; body: unknown }[] = []
  const save = async (path: string, request: Request, change: (body: Record<string, unknown>) => Partial<Appointment>) => {
    const body = (await request.json()) as Record<string, unknown>
    sent.push({ path, body })
    a = { ...a, ...change(body), version: a.version! + 1 }
    return HttpResponse.json(a)
  }
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments', ({ request }) => HttpResponse.json(
      new URL(request.url).searchParams.get('doctorId') === String(a.doctorId) ? [a] : [])),
    http.post('*/api/appointments/:id/reschedule', ({ request }) => save('reschedule', request, (b) => ({ startAt: b.startAt as string }))),
    http.post('*/api/appointments/:id/transfer', ({ request }) => save('transfer', request, (b) => ({ doctorId: b.doctorId as number }))),
    http.put('*/api/appointments/:id/service', ({ request }) => save('service', request, () => ({ serviceName: 'Чистка' }))),
    http.put('*/api/appointments/:id/comment', ({ request }) => save('comment', request, (b) => ({ comment: (b.comment as string) || undefined }))),
    http.get('*/api/service-types', () => HttpResponse.json([{ id: 5, name: 'Чистка', durationMinutes: 60, active: true, priceSom: 3000 }])),
  )
  return sent
}

async function openCard(name: RegExp) {
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name }))
  return screen.getByRole('complementary', { name: 'Карточка приёма' })
}

test('перенести на другое время у того же врача — /reschedule с версией', async () => {
  const sent = backend(appointment(10, 1, '15:00', 'Бакыт М.', { version: 2 }))
  const panel = await openCard(/Бакыт М\./)
  await userEvent.click(within(panel).getByRole('button', { name: 'Перенести или передать врачу' }))
  const form = within(panel).getByRole('form', { name: 'Перенос записи' })
  await userEvent.clear(within(form).getByLabelText('Время'))
  await userEvent.type(within(form).getByLabelText('Время'), '16:30')
  await userEvent.click(within(form).getByRole('button', { name: 'Перенести' }))

  await vi.waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0]).toEqual({ path: 'reschedule', body: { version: 2, startAt: new Date(`${todayIn()}T16:30:00+06:00`).toISOString(), durationMinutes: 30 } })
  expect(await screen.findByRole('button', { name: /16:30/ })).toBeInTheDocument()
})

test('передать другому врачу — /transfer с врачом', async () => {
  const sent = backend(appointment(10, 1, '15:00', 'Бакыт М.'))
  const panel = await openCard(/Бакыт М\./)
  await userEvent.click(within(panel).getByRole('button', { name: 'Перенести или передать врачу' }))
  const form = within(panel).getByRole('form', { name: 'Перенос записи' })
  await userEvent.selectOptions(within(form).getByLabelText('Врач'), 'Дастан Т.')
  await userEvent.click(within(form).getByRole('button', { name: 'Перенести' }))
  await vi.waitFor(() => expect(sent.map((x) => x.path)).toEqual(['transfer']))
  expect(sent[0]!.body).toMatchObject({ doctorId: 2, durationMinutes: 30 })
})

test('услуга и комментарий меняются прямо в карточке', async () => {
  const sent = backend(appointment(10, 1, '15:00', 'Бакыт М.'))
  const panel = await openCard(/Бакыт М\./)
  await userEvent.click(within(panel).getAllByRole('button', { name: 'изменить' })[0]!)
  const service = within(panel).getByRole('form', { name: 'Услуга приёма' })
  await userEvent.selectOptions(within(service).getByLabelText('Услуга'), 'Чистка · 3000 сом')
  await userEvent.click(within(service).getByRole('button', { name: 'Сохранить' }))
  expect(await within(panel).findByText('Чистка')).toBeInTheDocument()

  await userEvent.click(within(panel).getByRole('button', { name: '＋ Комментарий' }))
  await userEvent.type(within(panel).getByLabelText('Комментарий'), 'Аллергия на лидокаин')
  await userEvent.click(within(within(panel).getByRole('form', { name: 'Комментарий к записи' })).getByRole('button', { name: 'Сохранить' }))
  expect(await within(panel).findByText('Аллергия на лидокаин')).toBeInTheDocument()
  expect(sent.map((x) => x.path)).toEqual(['service', 'comment'])
  expect(sent[0]!.body).toEqual({ serviceTypeId: 5 })
})

test('материалы на приёме: списать со склада, ещё −1, вернуть', async () => {
  backend(appointment(10, 1, '09:00', 'Бакыт М.', { status: 'DONE', paidSom: 1000, paymentMethod: 'CASH' }))
  let used = 0
  const moves: number[] = []
  server.use(
    http.get('*/api/supplies', () => HttpResponse.json([{ id: 3, name: 'Анестетик', unit: 'карп.', quantity: 5 - used, minQuantity: 1, low: false }])),
    http.get('*/api/appointments/:id/supplies', () => HttpResponse.json(used ? [{ supplyId: 3, name: 'Анестетик', unit: 'карп.', used }] : [])),
    http.post('*/api/appointments/:id/supplies/:supplyId', async ({ request }) => {
      const { delta } = (await request.json()) as { delta: number }
      moves.push(delta)
      used -= delta
      return HttpResponse.json({ supply: { id: 3 }, used: [] })
    }),
  )
  const panel = await openCard(/Бакыт М\./)
  const box = within(panel).getByRole('region', { name: 'Материалы на приёме' })
  await userEvent.selectOptions(await within(box).findByLabelText('Материал со склада'), 'Анестетик · осталось 5 карп.')
  await userEvent.click(within(box).getByRole('button', { name: 'Списать 1' }))
  expect(await within(box).findByText(/Анестетик — /)).toHaveTextContent('Анестетик — 1 карп.')
  await userEvent.click(within(box).getByRole('button', { name: 'Списать ещё 1: Анестетик' }))
  await userEvent.click(await within(box).findByRole('button', { name: 'Вернуть 1: Анестетик' }))
  await vi.waitFor(() => expect(moves).toEqual([-1, -1, 1]))
})
