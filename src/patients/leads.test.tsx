import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { addDays, slotInstant, todayIn } from '../lib/time'
import { appointment, findSub, me, openBooked, renderApp } from '../test/fixtures'
import { server } from '../test/server'

type Lead = Schemas['LeadView']

afterEach(() => {
  window.location.hash = ''
})

/** Вымышленные обращения: номера из диапазона +996 700 000 0xx (как в демо). */
function lead(id: number, extra: Partial<Lead>): Lead {
  const now = new Date().toISOString()
  return {
    id, phone: `9967000000${String(id).padStart(2, '0')}`, channel: 'CALL', status: 'NEW', due: false, overdue: false, responsibleId: 111, responsibleName: 'Айгерим',
    createdByName: 'Айгерим', createdAt: now, updatedAt: now, statusTitle: 'Новое', mine: true, ...extra,
  }
}

const aigul = { id: 2, fullName: 'Айгуль Т.', phone: '996700000091', telegram: false }

function backend(list: Lead[]) {
  const posted: { url: string; body: unknown }[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/patients/recent', () => HttpResponse.json([])),
    http.get('*/api/leads/summary', () => HttpResponse.json({ attention: 2 } satisfies Schemas['LeadControllerSummary'])),
    http.get('*/api/leads', () => HttpResponse.json(list)),
    http.get('*/api/leads/:id', ({ params }) => HttpResponse.json(list.find((l) => l.id === Number(params.id))!)),
    http.get('*/api/tasks/assignees', () => HttpResponse.json([{ telegramId: 111, fullName: 'Айгерим', role: 'руководитель', me: true },
      { telegramId: 222, fullName: 'Айпери', role: 'регистратура', me: false }] satisfies Schemas['TaskControllerAssignee'][])),
    http.post('*/api/leads/:id/status', async ({ request, params }) => {
      const body = await request.json()
      posted.push({ url: `status ${String(params.id)}`, body })
      return HttpResponse.json(list.find((l) => l.id === Number(params.id))!)
    }),
    http.post('*/api/leads', async ({ request }) => {
      const body = await request.json()
      posted.push({ url: 'create', body })
      return HttpResponse.json(lead(99, {}), { status: 201 })
    }),
    http.post('*/api/patients/search', () => HttpResponse.json([aigul] satisfies Schemas['PatientView'][])),
  )
  return posted
}

test('«Обращения»: «Перезвонить сегодня» сверху (просрочено — красным), число у подраздела; «Позвонить» → «Не дозвонились» → «Завтра 10:00»', async () => {
  const yesterday = slotInstant(addDays(todayIn(), -1), 11 * 60)
  const posted = backend([
    lead(1, { fullName: 'Нурлан', status: 'NO_ANSWER', callbackAt: yesterday, due: true, overdue: true, wish: 'Болит зуб' }),
    lead(2, { channel: 'INSTAGRAM', wish: 'Цена отбеливания' }),
    lead(3, { fullName: 'Гулина', status: 'REFUSED', refuseReason: 'Дорого', closedAt: new Date().toISOString() }),
  ])
  window.location.hash = '/patients'
  renderApp()
  await userEvent.click(await findSub(/Обращения · 2/))

  const due = await screen.findByRole('region', { name: 'Перезвонить сегодня' })
  expect(due).toHaveTextContent('Нурлан')
  expect(due).toHaveTextContent('Звонок · Болит зуб')
  expect(within(due).getByText(/перезвонить вчера, 11:00/)).toHaveClass('overdue')
  // Без имени — номер вместо имени; откуда и что хочет — серой строкой
  const fresh = screen.getByRole('region', { name: 'Новые' })
  expect(fresh).toHaveTextContent('+996 700 000 002')
  expect(fresh).toHaveTextContent('Instagram · Цена отбеливания')
  // Отказавшиеся — свёрнуто внизу
  expect(screen.getByRole('region', { name: 'Отказались — за 30 дней' })).not.toHaveTextContent('Гулина')

  const call = within(due).getByRole('link', { name: 'Позвонить: Нурлан' })
  expect(call).toHaveAttribute('href', 'tel:+996700000001')
  call.addEventListener('click', (e) => e.preventDefault())
  await userEvent.click(call)
  const result = await within(due).findByRole('group', { name: 'Чем закончился разговор' })
  await userEvent.click(within(result).getByRole('button', { name: 'Не дозвонились' }))
  await userEvent.click(within(result).getByRole('button', { name: 'Завтра 10:00' }))
  await waitFor(() => expect(posted).toEqual([{ url: 'status 1', body: { status: 'NO_ANSWER', callbackAt: slotInstant(addDays(todayIn(), 1), 600) } }]))
})

test('«Отказался» — с причиной', async () => {
  const posted = backend([lead(1, { fullName: 'Нурлан' })])
  window.location.hash = '/patients/leads'
  renderApp()
  const call = await screen.findByRole('link', { name: 'Позвонить: Нурлан' })
  call.addEventListener('click', (e) => e.preventDefault())
  await userEvent.click(call)
  await userEvent.click(await screen.findByRole('button', { name: 'Отказался' }))
  await userEvent.type(screen.getByLabelText('Причина отказа'), 'Далеко')
  await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
  await waitFor(() => expect(posted).toEqual([{ url: 'status 1', body: { status: 'REFUSED', reason: 'Далеко' } }]))
})

test('«＋ Обращение»: номер, «Это Айгуль Т.? Связать», откуда, что хочет, перезвонить — один запрос', async () => {
  const posted = backend([])
  window.location.hash = '/patients/leads'
  renderApp()
  expect(await screen.findByText('Открытых обращений нет')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: '＋ Обращение' }))
  const dialog = await screen.findByRole('dialog', { name: 'Новое обращение' })
  await userEvent.type(within(dialog).getByLabelText('Телефон'), '700000091')
  await userEvent.click(await within(dialog).findByRole('button', { name: 'Это Айгуль Т.? Связать' }))
  expect(dialog).toHaveTextContent('Карточка: Айгуль Т.')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Instagram' }))
  await userEvent.type(within(dialog).getByLabelText('Что хочет'), 'Брекеты')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Завтра 10:00' }))
  await userEvent.click(within(dialog).getByRole('button', { name: 'Добавить' }))
  await waitFor(() => expect(posted).toEqual([{ url: 'create', body: {
    phone: '+996700000091', fullName: 'Айгуль Т.', channel: 'INSTAGRAM', wish: 'Брекеты',
    callbackAt: slotInstant(addDays(todayIn(), 1), 600), patientId: 2,
  } }]))
})

test('«Записать» из итога звонка — «Новая запись» на карточку обращения; запись уходит с fromLeadId', async () => {
  backend([lead(5, { fullName: 'Айгуль Т.', patientId: 2, patientName: 'Айгуль Т.', status: 'THINKING' })])
  const at = (t: string) => slotInstant(todayIn(), Number(t.slice(0, 2)) * 60)
  const created: unknown[] = []
  server.use(
    http.get('*/api/appointments', () => HttpResponse.json([])),
    http.get('*/api/appointments/by-patient/2', () => HttpResponse.json({ patient: aigul, done: 0, noShow: 0, cancelled: 0, upcoming: [], past: [] })),
    http.get('*/api/slots', () => HttpResponse.json({ workingDay: true, breaks: [], starts: [at('23:00')], free: [{ start: at('23:00'), end: at('23:00') }] })),
    http.post('*/api/appointments', async ({ request }) => {
      created.push(await request.json())
      return HttpResponse.json(appointment(55, 1, '10:00', 'Айгуль Т.'), { status: 201 })
    }),
  )
  window.location.hash = '/patients/leads'
  renderApp()
  const call = await screen.findByRole('link', { name: 'Позвонить: Айгуль Т.' })
  call.addEventListener('click', (e) => e.preventDefault())
  await userEvent.click(call)
  await userEvent.click(await screen.findByRole('button', { name: 'Записать' }))
  const form = await screen.findByRole('complementary', { name: 'Новая запись' })
  expect(form).toHaveTextContent('Айгуль Т.')
  await userEvent.click(await within(form).findByRole('button', { name: /^23:00/ }))
  await userEvent.click(within(form).getByRole('button', { name: /^Записать( ·|$)/ }))
  expect(await openBooked()).toBeInTheDocument()
  expect(created).toEqual([expect.objectContaining({ patientId: 2, fromLeadId: 5 })])
})

test('ассистенту «Обращений» нет', async () => {
  server.use(http.get('*/api/patient/me', () => HttpResponse.json({ ...me, admin: false, doctorId: undefined, assistantOf: [1] })),
    http.get('*/api/patients/recent', () => HttpResponse.json([])))
  window.location.hash = '/patients'
  renderApp()
  await findSub('Все')
  expect(screen.queryByRole('link', { name: /Обращения/ })).toBeNull()
})
