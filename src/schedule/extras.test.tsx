import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { todayIn } from '../lib/time'
import { appointment, expand, me, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { choose } from '../test/select'

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
  await userEvent.clear(await within(form).findByLabelText('Время'))
  await userEvent.type(within(form).getByLabelText('Время'), '16:30')
  await userEvent.click(within(form).getByRole('button', { name: 'Перенести' }))

  await vi.waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0]).toEqual({ path: 'reschedule', body: { version: 2, startAt: new Date(`${todayIn()}T16:30:00+06:00`).toISOString(), durationMinutes: 30 } })
  expect(await screen.findByRole('button', { name: /16:30/ })).toBeInTheDocument()
})

test('перенос по сетке свободного времени: старое время приёма не мешает, после — «напомните заново»', async () => {
  const sent = backend(appointment(10, 1, '15:00', 'Бакыт М.', { version: 2 }))
  const asked: URLSearchParams[] = []
  server.use(http.get('*/api/slots', ({ request }) => {
    asked.push(new URL(request.url).searchParams)
    return HttpResponse.json({ workingDay: true, starts: ['15:00', '16:30'].map((t) => new Date(`${todayIn()}T${t}:00+06:00`).toISOString()) })
  }))
  const panel = await openCard(/Бакыт М\./)
  await userEvent.click(within(panel).getByRole('button', { name: 'Перенести или передать врачу' }))
  const form = within(panel).getByRole('form', { name: 'Перенос записи' })
  const grid = await within(form).findByRole('group', { name: 'Свободное время' })
  expect(within(grid).getByRole('button', { name: '15:00' })).toHaveAttribute('aria-pressed', 'true')
  expect(asked.some((q) => q.get('exclude') === '10')).toBe(true)
  await userEvent.click(within(grid).getByRole('button', { name: '16:30' }))
  expect(within(form).getByText('Приём: 16:30–17:00')).toBeInTheDocument()
  await userEvent.click(within(form).getByRole('button', { name: 'Перенести' }))

  expect(await within(panel).findByRole('status')).toHaveTextContent('напомните пациенту заново')
  expect(sent[0]).toMatchObject({ path: 'reschedule', body: { startAt: new Date(`${todayIn()}T16:30:00+06:00`).toISOString() } })
})

test('передать другому врачу — /transfer с врачом', async () => {
  const sent = backend(appointment(10, 1, '15:00', 'Бакыт М.'))
  const panel = await openCard(/Бакыт М\./)
  await userEvent.click(within(panel).getByRole('button', { name: 'Перенести или передать врачу' }))
  const form = within(panel).getByRole('form', { name: 'Перенос записи' })
  server.use(http.get('*/api/slots', () => HttpResponse.json({ workingDay: true, starts: [new Date(`${todayIn()}T15:00:00+06:00`).toISOString()] })))
  await userEvent.click(within(within(form).getByRole('group', { name: 'Врач' })).getByRole('button', { name: 'Дастан Т.' }))
  expect(within(form).getByText(/Новому врачу придёт уведомление/)).toBeInTheDocument()
  // Другой врач — время выбирают заново, по его сетке свободного
  await userEvent.click(await within(form).findByRole('button', { name: '15:00' }))
  await userEvent.click(within(form).getByRole('button', { name: 'Передать' }))
  await vi.waitFor(() => expect(sent.map((x) => x.path)).toEqual(['transfer']))
  expect(sent[0]!.body).toMatchObject({ doctorId: 2, durationMinutes: 30 })
})

test('услуга и комментарий меняются прямо в карточке', async () => {
  const sent = backend(appointment(10, 1, '15:00', 'Бакыт М.'))
  const panel = await openCard(/Бакыт М\./)
  await userEvent.click(within(panel).getAllByRole('button', { name: 'изменить' })[0]!)
  const service = within(panel).getByRole('form', { name: 'Услуга приёма' })
  await choose(within(service).getByLabelText('Услуга'), 'Чистка · 3000 сом')
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
  const box = await expand(within(panel).getByRole('region', { name: 'Материалы на приёме' }))
  await choose(await within(box).findByLabelText('Материал со склада'), 'Анестетик · осталось 5 карп.')
  await userEvent.click(within(box).getByRole('button', { name: 'Списать 1' }))
  expect(await within(box).findByText(/Анестетик — /)).toHaveTextContent('Анестетик — 1 карп.')
  await userEvent.click(within(box).getByRole('button', { name: 'Списать ещё 1: Анестетик' }))
  await userEvent.click(await within(box).findByRole('button', { name: 'Вернуть 1: Анестетик' }))
  await vi.waitFor(() => expect(moves).toEqual([-1, -1, 1]))
})

test('материалы услуги: «Обычно уходит» — поправить, убрать лишнее и «Списать всё» одним запросом', async () => {
  backend(appointment(10, 1, '09:00', 'Бакыт М.', { status: 'DONE', serviceName: 'Пломба' }))
  let used: Schemas['SupplyQueryUsed'][] = []
  let sent: Schemas['ServiceSupplyControllerLines'] | null = null
  server.use(
    http.get('*/api/appointments/:id/supplies/suggested', () => HttpResponse.json([
      { supplyId: 3, name: 'Анестетик', unit: 'карп.', quantity: 1, inStock: 5 },
      { supplyId: 4, name: 'Композит', unit: 'шт', quantity: 1, inStock: 2 },
      { supplyId: 6, name: 'Бонд', unit: 'шт', quantity: 1, inStock: 0 },
    ] satisfies Schemas['ServiceSuppliesItem'][])),
    http.get('*/api/appointments/:id/supplies', () => HttpResponse.json(used)),
    http.post('*/api/appointments/:id/supplies', async ({ request }) => {
      sent = await request.json() as Schemas['ServiceSupplyControllerLines']
      used = [{ supplyId: 3, name: 'Анестетик', unit: 'карп.', used: 2 }, { supplyId: 4, name: 'Композит', unit: 'шт', used: 1 }]
      return HttpResponse.json(used)
    }),
  )
  const panel = await openCard(/Бакыт М\./)
  const box = await expand(within(panel).getByRole('region', { name: 'Материалы на приёме' }))
  expect(await within(box).findByText('Обычно уходит: Анестетик 1 карп., Композит 1 шт, Бонд 1 шт')).toBeInTheDocument()
  // Склад ничего не списал сам — только предложение
  expect(sent).toBeNull()
  expect(within(box).getByText(/на складе 0 шт/)).toBeInTheDocument()

  await userEvent.clear(within(box).getByLabelText('Сколько списать: Анестетик'))
  await userEvent.type(within(box).getByLabelText('Сколько списать: Анестетик'), '2')
  await userEvent.click(within(box).getByRole('button', { name: 'Не списывать: Бонд' }))
  await userEvent.click(within(box).getByRole('button', { name: 'Списать всё' }))

  expect(await within(box).findByText(/Композит — /)).toHaveTextContent('Композит — 1 шт')
  expect(sent).toEqual({ items: [{ supplyId: 3, quantity: 2 }, { supplyId: 4, quantity: 1 }] })
  expect(within(box).queryByRole('button', { name: 'Списать всё' })).not.toBeInTheDocument()
})

test('материалы услуги: уже что-то списали — не предлагаем; «Не нужно» скрывает', async () => {
  backend(appointment(10, 1, '09:00', 'Бакыт М.', { status: 'DONE' }))
  const suggested = [{ supplyId: 3, name: 'Анестетик', unit: 'карп.', quantity: 1, inStock: 5 }] satisfies Schemas['ServiceSuppliesItem'][]
  server.use(http.get('*/api/appointments/:id/supplies/suggested', () => HttpResponse.json(suggested)))
  const panel = await openCard(/Бакыт М\./)
  const box = await expand(within(panel).getByRole('region', { name: 'Материалы на приёме' }))
  await userEvent.click(await within(box).findByRole('button', { name: 'Не нужно' }))
  expect(within(box).queryByText(/Обычно уходит/)).not.toBeInTheDocument()
})

test('материалы услуги: на приёме уже списан материал — список «Обычно уходит» не показываем', async () => {
  backend(appointment(10, 1, '09:00', 'Бакыт М.', { status: 'DONE' }))
  server.use(
    http.get('*/api/appointments/:id/supplies/suggested', () => HttpResponse.json([
      { supplyId: 3, name: 'Анестетик', unit: 'карп.', quantity: 1, inStock: 5 },
    ] satisfies Schemas['ServiceSuppliesItem'][])),
    http.get('*/api/appointments/:id/supplies', () => HttpResponse.json([
      { supplyId: 3, name: 'Анестетик', unit: 'карп.', used: 1 },
    ] satisfies Schemas['SupplyQueryUsed'][])),
  )
  const panel = await openCard(/Бакыт М\./)
  const box = await expand(within(panel).getByRole('region', { name: 'Материалы на приёме' }))
  expect(await within(box).findByText(/Анестетик — /)).toBeInTheDocument()
  expect(within(box).queryByText(/Обычно уходит/)).not.toBeInTheDocument()
})

test('у услуги нет «Обычно уходит» — ссылка «настроить материалы услуги» открывает эту услугу в настройках', async () => {
  backend(appointment(10, 1, '09:00', 'Бакыт М.', { status: 'DONE', serviceName: 'Чистка' }))
  const panel = await openCard(/Бакыт М\./)
  const box = await expand(within(panel).getByRole('region', { name: 'Материалы на приёме' }))
  await userEvent.click(await within(box).findByRole('link', { name: 'настроить материалы услуги' }))
  window.dispatchEvent(new HashChangeEvent('hashchange'))
  const service = await screen.findByRole('complementary', { name: 'Услуга' })
  expect(within(service).getByRole('region', { name: 'Материалы по умолчанию' })).toBeInTheDocument()
})
