import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { appointment, me, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { choose } from '../test/select'

type Row = Schemas['PatientListControllerPatientRow']

/** Вымышленные пациенты: Бакыт был давно, Айгуль — вчера и записана снова, Нурлан — новый. */
const rows: Row[] = [
  { id: 1, fullName: 'Бакыт М.', phone: '996555111222', telegram: true, lastVisit: '2026-01-10T04:00:00Z' },
  { id: 2, fullName: 'Айгуль Т.', phone: '996700333444', telegram: false, lastVisit: '2026-10-30T05:00:00Z', nextVisit: '2026-11-05T06:00:00Z' },
  { id: 3, fullName: 'Нурлан К.', phone: '996777555666', telegram: false },
]

function backend(extra: Parameters<typeof server.use> = []) {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/patients/recent', () => HttpResponse.json(rows)),
    http.get('*/api/appointments', () => HttpResponse.json([])),
    ...extra,
  )
}

beforeEach(() => {
  window.location.hash = '/patients'
})
afterEach(() => {
  window.location.hash = ''
})

const names = () => screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[0]!.textContent?.replace('Telegram', ''))

test('таблица: сначала кто был недавно; сортировка по имени; поиск по имени и по номеру', async () => {
  backend()
  renderApp()
  expect(await screen.findByRole('heading', { name: 'Пациенты' })).toBeInTheDocument()
  await screen.findByText('Айгуль Т.')
  // Не был ни разу — в конце, даже при обратной сортировке
  expect(names()).toEqual(['Айгуль Т.', 'Бакыт М.', 'Нурлан К.'])

  const byName = () => within(screen.getByRole('columnheader', { name: /Пациент/ })).getByRole('button')
  await userEvent.click(byName())
  expect(names()).toEqual(['Айгуль Т.', 'Бакыт М.', 'Нурлан К.'])
  await userEvent.click(byName())
  expect(names()).toEqual(['Нурлан К.', 'Бакыт М.', 'Айгуль Т.'])

  await userEvent.type(screen.getByLabelText('Поиск пациента'), 'бак')
  expect(names()).toEqual(['Бакыт М.'])
  await userEvent.clear(screen.getByLabelText('Поиск пациента'))
  await userEvent.type(screen.getByLabelText('Поиск пациента'), '0700 333')
  expect(names()).toEqual(['Айгуль Т.'])
})

test('нет среди последних — ищем по всей клинике на сервере', async () => {
  let asked: unknown
  backend([http.post('*/api/patients/search', async ({ request }) => {
    asked = await request.json()
    return HttpResponse.json([{ id: 9, fullName: 'Эрмек Давний', phone: '996555999000' }])
  })])
  renderApp()
  await screen.findByText('Айгуль Т.')
  await userEvent.type(screen.getByLabelText('Поиск пациента'), 'Эрмек')
  expect(await screen.findByText('Эрмек Давний')).toBeInTheDocument()
  expect(asked).toEqual({ query: 'эрмек' })
})

test('карточка пациента: визиты, неявки, долг; «Записать» — в «Расписание» с ним в «Новой записи»', async () => {
  const visit = appointment(50, 1, '10:00', 'Айгуль Т.', { status: 'DONE', serviceName: 'Пломба' })
  backend([
    http.get('*/api/appointments/by-patient/2', () => HttpResponse.json({
      patient: { id: 2, fullName: 'Айгуль Т.', phone: '996700333444', telegram: false },
      done: 4, noShow: 1, cancelled: 0,
      upcoming: [appointment(51, 2, '12:00', 'Айгуль Т.')],
      past: [visit],
    })),
    http.get('*/api/appointments/debts', ({ request }) => HttpResponse.json(
      new URL(request.url).searchParams.get('patientId') === '2' ? [{ appointmentId: 50, debtSom: 1500, startAt: visit.startAt }] : [])),
    http.get('*/api/patients/2/notes', () => HttpResponse.json([{ appointmentId: 50, note: 'Пломба 36, контроль через год' }])),
    http.get('*/api/patients/2/expenses', () => HttpResponse.json([{ id: 1, amountSom: 2000, category: 'Зуботехническая лаборатория' }])),
    http.get('*/api/service-types', () => HttpResponse.json([])),
  ])
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Айгуль Т.' }))
  const panel = await screen.findByRole('complementary', { name: 'Карточка пациента' })
  expect(await within(panel).findByText(/Был:/)).toBeInTheDocument()
  expect(panel).toHaveTextContent('Не пришёл: 1')
  expect(panel).toHaveTextContent('Отмен: 0')
  expect(await within(panel).findByRole('button', { name: /Долг 1\s500 сом — приём/ })).toBeInTheDocument()
  expect(panel).toHaveTextContent('Пломба')
  expect(await within(panel).findByText(/Пломба 36, контроль через год/)).toBeInTheDocument()
  expect(await within(panel).findByText(/Расходы по пациенту/)).toHaveTextContent(/2\s000 сом/)
  expect(within(panel).getByRole('list', { name: 'Расходы по пациенту' })).toHaveTextContent(/Зуботехническая лаборатория · 2\s000 сом/)
  expect(within(panel).getByRole('button', { name: 'WhatsApp' })).toBeInTheDocument()
  expect(within(panel).getByRole('button', { name: 'Медкарта и снимки' })).toBeInTheDocument()

  await userEvent.click(within(panel).getByRole('button', { name: '＋ Записать' }))
  const form = await screen.findByRole('complementary', { name: 'Новая запись' })
  expect(within(form).getByText('Айгуль Т.')).toBeInTheDocument()
  expect(window.location.hash).toBe('#/schedule')
})

test('визит в карточке пациента открывает карточку приёма в «Расписании»', async () => {
  const visit = appointment(50, 1, '10:00', 'Айгуль Т.', { status: 'DONE', serviceName: 'Пломба' })
  backend([
    http.get('*/api/appointments/by-patient/2', () => HttpResponse.json({
      patient: { id: 2, fullName: 'Айгуль Т.', phone: '996700333444' }, done: 1, noShow: 0, cancelled: 0, upcoming: [], past: [visit],
    })),
    http.get('*/api/appointments/debts', () => HttpResponse.json([])),
    http.get('*/api/appointments/50', () => HttpResponse.json(visit)),
  ])
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Айгуль Т.' }))
  const panel = await screen.findByRole('complementary', { name: 'Карточка пациента' })
  await userEvent.click(await within(panel).findByRole('button', { name: /Пломба/ }))
  expect(await screen.findByRole('complementary', { name: 'Карточка приёма' })).toHaveTextContent('Айгуль Т.')
  expect(window.location.hash).toBe('#/schedule')
})

test('фильтр по врачу: только его пациенты, сервер получает doctorId', async () => {
  const asked: (string | null)[] = []
  backend()
  server.use(http.get('*/api/patients/recent', ({ request }) => {
    const doctorId = new URL(request.url).searchParams.get('doctorId')
    asked.push(doctorId)
    return HttpResponse.json(doctorId === '2' ? rows.slice(1, 2) : rows)
  }))
  renderApp()
  await screen.findByText('Нурлан К.')
  expect(asked).toEqual([null])
  await choose(screen.getByLabelText('Чьи пациенты'), 'Дастан Т.')
  expect(await screen.findByText('Пациентов врача: 1')).toBeInTheDocument()
  expect(names()).toEqual(['Айгуль Т.'])
  expect(asked).toContain('2')
  await choose(screen.getByLabelText('Чьи пациенты'), 'Все врачи')
  expect(await screen.findByText('Нурлан К.')).toBeInTheDocument()
})
