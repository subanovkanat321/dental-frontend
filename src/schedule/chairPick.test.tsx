import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { addDays, slotInstant, todayIn } from '../lib/time'
import { appointment, me, openItem, renderApp } from '../test/fixtures'
import { choose } from '../test/select'
import { server } from '../test/server'

/**
 * Выбор кресла у приёма (V210). Врачи и пациенты — вымышленные: «Кресло 1» — у Айгерим (№1) и Дастана (№2),
 * «Кресло 2» пока пустое. В 09:00 завтра «Кресло 1» занято приёмом Айгерим.
 */
beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('min-width'), media: query, addEventListener() {}, removeEventListener() {}, onchange: null,
    addListener() {}, removeListener() {}, dispatchEvent: () => false,
  }))
})
afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
  window.location.hash = ''
})

type Create = Schemas['AppointmentRequestsCreate']
type Chair = Schemas['ChairOverview']

const TWO: Chair[] = [
  { id: 5, name: 'Кресло 1', doctorIds: [1, 2], overlaps: [], mode: 'WARN' },
  { id: 6, name: 'Кресло 2', doctorIds: [], overlaps: [], mode: 'WARN' },
]

const OPTIONS: Schemas['ChairOptionView'][] = [
  { id: 5, name: 'Кресло 1', own: true, state: 'BUSY', doctorName: 'Айгерим Садыкова', strict: false },
  { id: 6, name: 'Кресло 2', own: false, state: 'FREE', strict: false },
]

type Check = Schemas['ChairCheckView']

const nine = () => slotInstant(addDays(todayIn(), 1), 9 * 60)
const nineThirty = () => slotInstant(addDays(todayIn(), 1), 9 * 60 + 30)

/**
 * chair-check глазами сервера: «Кресло 1» в 09:00 занято приёмом Айгерим — только «занято» (и это её часы, но «время
 * Айгерим» сервер в этом случае не присылает); «Кресло 2» — основное кресло Бакыта: ему придёт уведомление.
 */
function busyCheck(chairId: number | null): Check {
  if (chairId === 6) return { strict: false, notified: ['Бакыт Осмонов'] }
  return {
    strict: false, notified: [],
    busy: { chairName: 'Кресло 1', doctorName: 'Айгерим Садыкова', start: nine(), end: nineThirty() },
    freeChair: { id: 6, name: 'Кресло 2', notified: ['Бакыт Осмонов'] },
  }
}

function backend(created: (body: Create) => Response, chairs: Chair[] = TWO, appointments: Schemas['AppointmentView'][] = [],
  check: (chairId: number | null) => Check = busyCheck) {
  const posts: Create[] = []
  server.use(
    http.get('*/api/appointments/chair-check', ({ request }) => {
      const chairId = new URL(request.url).searchParams.get('chairId')
      return HttpResponse.json(check(chairId ? Number(chairId) : null))
    }),
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments', () => HttpResponse.json(appointments)),
    http.get('*/api/chairs', () => HttpResponse.json(chairs)),
    http.get('*/api/appointments/chair-options', () => HttpResponse.json(OPTIONS)),
    http.get('*/api/slots', ({ request }) => {
      const date = new URL(request.url).searchParams.get('date')!
      return HttpResponse.json({
        workingDay: true, workStart: '09:00:00', workEnd: '18:00:00', breaks: [], chairBusy: [],
        starts: [slotInstant(date, 9 * 60)], free: [{ start: slotInstant(date, 9 * 60), end: slotInstant(date, 18 * 60) }],
      } satisfies Schemas['SlotsView'])
    }),
    http.get('*/api/service-types', () => HttpResponse.json([])),
    http.post('*/api/patients/search', () => HttpResponse.json([{ id: 7, fullName: 'Нурлан К.', phone: '996700111222' }])),
    http.post('*/api/appointments', async ({ request }) => {
      const body = (await request.json()) as Create
      posts.push(body)
      return created(body)
    }),
  )
  return posts
}

/** «Следующий день» → колонка Дастана → «Свободно» → пациент. */
async function openNew() {
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Следующий день' }))
  const column = await screen.findByRole('group', { name: 'Дастан Т.' })
  await userEvent.click(await within(column).findByRole('button', { name: 'Свободно с 09:00 до 18:00, записать' }))
  const panel = await screen.findByRole('complementary', { name: 'Новая запись' })
  await within(panel).findByRole('group', { name: 'Свободное время' })
  await userEvent.type(within(panel).getByLabelText('Найти пациента'), 'Нур')
  await userEvent.click(await within(panel).findByRole('button', { name: /Нурлан К\./ }))
  return panel
}

const ok = (body: Create) => HttpResponse.json(appointment(30, body.doctorId, '09:00', 'Нурлан К.', { chairId: body.chairId }), { status: 201 })

test('одно кресло — поля «Кресло» нет и chairId не уходит', async () => {
  const posts = backend(ok, [TWO[0]!])
  const panel = await openNew()

  expect(within(panel).queryByRole('combobox', { name: /Кресло/ })).not.toBeInTheDocument()
  await userEvent.click(within(panel).getByRole('button', { name: 'Записать' }))
  await waitFor(() => expect(posts).toHaveLength(1))
  expect(posts[0]!.chairId).toBeUndefined()
})

test('два кресла: кресло занято приёмом — одна строка «занято: приём …» без «время врача», кнопка ставит свободное и говорит об уведомлении', async () => {
  const posts = backend(ok)
  const panel = await openNew()

  const field = await within(panel).findByRole('combobox', { name: /Кресло/ })
  await waitFor(() => expect(field).toHaveTextContent('Кресло 1 (кресло врача) — занято (Айгерим Садыкова)'))
  // В подписи занятого кресла — только «занято», без «время …»
  expect(field).not.toHaveTextContent('время')
  const hint = await within(panel).findByText(/«Кресло 1» занято: приём Айгерим Садыкова 09:00–09:30/)
  expect(hint).toHaveTextContent('Свободно «Кресло 2» — записать в «Кресло 2». Врачу кресла (Бакыт Осмонов) придёт уведомление.')
  expect(within(panel).queryByText(/время врача/)).not.toBeInTheDocument()
  expect(within(panel).getAllByRole('status').filter((n) => /Кресло 1/.test(n.textContent ?? ''))).toHaveLength(1)

  await userEvent.click(within(hint).getByRole('button', { name: 'записать в «Кресло 2»' }))
  expect(field).toHaveTextContent('Кресло 2 — свободно')
  expect(await within(panel).findByText('🔔 Врачу кресла (Бакыт Осмонов) придёт уведомление.')).toBeInTheDocument()
  expect(within(panel).queryByText(/занято: приём/)).not.toBeInTheDocument()

  await userEvent.click(within(panel).getByRole('button', { name: 'Записать' }))
  await waitFor(() => expect(posts).toHaveLength(1))
  expect(posts[0]!.chairId).toBe(6)
})

const busy409 = (extra: Record<string, unknown> = {}) => HttpResponse.json({
  title: 'Conflict', status: 409, code: 'time-taken', detail: 'Кресло занято: «Кресло 1» в это время у врача Айгерим Садыкова',
  chairId: 5, chairName: 'Кресло 1', doctorName: 'Айгерим Садыкова', busyStart: nine(), busyEnd: nineThirty(),
  freeChairId: 6, freeChairName: 'Кресло 2', freeChairNotified: ['Бакыт Осмонов'], ...extra,
}, { status: 409 })

test('409 «кресло занято» — одно окно «занято: приём … Свободно «Кресло 2» — записать туда?» и повтор в свободное', async () => {
  const posts = backend((body) => body.chairId === 6 ? ok(body) : busy409())
  const panel = await openNew()
  // Сотрудник не стал менять кресло в поле — сервер подскажет сам
  await within(panel).findByRole('combobox', { name: /Кресло/ })
  await userEvent.click(within(panel).getByRole('button', { name: 'Записать' }))

  const dialog = await screen.findByRole('alertdialog')
  expect(dialog).toHaveTextContent('«Кресло 1» занято: приём Айгерим Садыкова 09:00–09:30. Свободно «Кресло 2» — записать туда?'
    + ' Врачу кресла (Бакыт Осмонов) придёт уведомление.')
  expect(dialog).not.toHaveTextContent('время врача')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Записать в «Кресло 2»' }))

  await waitFor(() => expect(posts).toHaveLength(2))
  expect(posts[0]!.chairId).toBe(5)
  expect(posts[1]!.chairId).toBe(6)
  await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Новая запись' })).not.toBeInTheDocument())
})

test('свободное кресло — в часы его врача: согласились в одном окне — без второго «Коллега предупреждён?»', async () => {
  const posts = backend((body) => body.chairId === 6 ? ok(body) : busy409({ freeChairColleague: 'Бакыт Осмонов' }))
  const panel = await openNew()
  await within(panel).findByRole('combobox', { name: /Кресло/ })
  await userEvent.click(within(panel).getByRole('button', { name: 'Записать' }))

  const dialog = await screen.findByRole('alertdialog')
  expect(dialog).toHaveTextContent('Свободно «Кресло 2» (часы врача Бакыт Осмонов) — записать туда? Врачу кресла (Бакыт Осмонов) придёт уведомление.')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Записать в «Кресло 2»' }))

  await waitFor(() => expect(posts).toHaveLength(2))
  expect(posts[1]).toMatchObject({ chairId: 6, confirmChairTime: true })
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
})

test('отказались от свободного кресла — ответ сервера под формой, без второй строки о том же кресле', async () => {
  backend(() => busy409())
  const panel = await openNew()
  await within(panel).findByText(/«Кресло 1» занято: приём/)
  await userEvent.click(within(panel).getByRole('button', { name: 'Записать' }))
  await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Отмена' }))

  expect(await within(panel).findByText('Кресло занято: «Кресло 1» в это время у врача Айгерим Садыкова')).toBeInTheDocument()
  expect(within(panel).queryByText(/занято: приём/)).not.toBeInTheDocument()
})

test('кресло пустое, но часы коллеги — «время врача», без «занято»', async () => {
  backend(ok, TWO, [], () => ({
    strict: false, notified: [],
    colleague: { doctorId: 1, doctorName: 'Айгерим Садыкова', chairName: 'Кресло 1', start: nine(), end: nineThirty() },
  }))
  server.use(http.get('*/api/appointments/chair-options', () => HttpResponse.json([
    { id: 5, name: 'Кресло 1', own: true, state: 'COLLEAGUE_TIME', doctorName: 'Айгерим Садыкова', strict: false },
    { id: 6, name: 'Кресло 2', own: false, state: 'FREE', strict: false },
  ] satisfies Schemas['ChairOptionView'][])))
  const panel = await openNew()

  const field = await within(panel).findByRole('combobox', { name: /Кресло/ })
  await waitFor(() => expect(field).toHaveTextContent('Кресло 1 (кресло врача) — время Айгерим Садыкова'))
  expect(await within(panel).findByText(/09:00–09:30 — время врача Айгерим Садыкова/)).toBeInTheDocument()
  expect(within(panel).queryByText(/занято/)).not.toBeInTheDocument()
})

test('карточка: кресло приёма видно, «сменить» — то же поле и PUT /chair', async () => {
  const tomorrow = addDays(todayIn(), 1)
  const a = {
    ...appointment(40, 2, '10:00', 'Бакыт М.', { version: 3, chairId: 6, chairManual: true }),
    startAt: slotInstant(tomorrow, 10 * 60), endAt: slotInstant(tomorrow, 10 * 60 + 30),
  }
  const sent: Schemas['AppointmentRequestsChair'][] = []
  backend(ok, TWO, [a])
  server.use(
    http.get('*/api/appointments/chair-options', () => HttpResponse.json([
      { id: 5, name: 'Кресло 1', own: true, state: 'FREE', strict: false },
      { id: 6, name: 'Кресло 2', own: false, state: 'FREE', strict: false },
    ] satisfies Schemas['ChairOptionView'][])),
    http.put('*/api/appointments/:id/chair', async ({ request }) => {
      const body = (await request.json()) as Schemas['AppointmentRequestsChair']
      sent.push(body)
      return HttpResponse.json({ ...a, version: 4, chairId: body.chairId, chairManual: false })
    }),
  )
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Следующий день' }))
  // Не кресло врача — значок на приёме
  const [mark] = await screen.findAllByRole('img', { name: 'В кресле «Кресло 2» (не кресло врача)' })
  await userEvent.click(mark!.closest('button')!)
  const panel = screen.getByRole('complementary', { name: 'Карточка приёма' })

  expect(await within(panel).findByText(/Кресло 2/, { selector: '.appt-chair span' })).toBeInTheDocument()
  expect(within(panel).getByText('· не кресло врача')).toBeInTheDocument()
  await userEvent.click(within(panel).getByRole('button', { name: 'сменить' }))
  const form = within(panel).getByRole('form', { name: 'Кресло приёма' })
  await choose(within(form).getByRole('combobox', { name: /Кресло/ }), 'Кресло 1 (кресло врача) — свободно')
  await userEvent.click(within(form).getByRole('button', { name: 'Сохранить' }))

  await waitFor(() => expect(sent).toEqual([{ version: 3, chairId: 5 }]))
})

test('«Клиника → Кресла»: «Без кресла: Дастан Т. — назначить ›» назначает кресло', async () => {
  let chairs: Chair[] = [
    { id: 5, name: 'Кресло 1', doctorIds: [1], overlaps: [], mode: 'WARN' },
    { id: 6, name: 'Кресло 2', doctorIds: [], overlaps: [], mode: 'WARN' },
  ]
  const assigned: string[] = []
  backend(ok, chairs)
  server.use(
    http.get('*/api/chairs', () => HttpResponse.json(chairs)),
    http.put('*/api/doctors/:id/chair', async ({ params, request }) => {
      const { chairId } = (await request.json()) as Schemas['ChairAssignmentControllerChairRequest']
      assigned.push(`${params.id}→${chairId}`)
      chairs = chairs.map((c) => (c.id === chairId ? { ...c, doctorIds: [...(c.doctorIds ?? []), Number(params.id)] } : c))
      return HttpResponse.json(chairs)
    }),
  )
  renderApp()
  openItem('chairs')

  const block = await screen.findByRole('region', { name: 'Врачи без кресла' })
  expect(block).toHaveTextContent('Без кресла: Дастан Т.')
  // Первым — кресло, где меньше врачей
  await choose(within(block).getByRole('combobox', { name: 'Назначить кресло: Дастан Т.' }), 'Кресло 2 (пустое)')

  await waitFor(() => expect(assigned).toEqual(['2→6']))
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Врачи без кресла' })).not.toBeInTheDocument())
})
