import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { addDays, slotInstant, todayIn } from '../lib/time'
import { appointment, me, openItem, renderApp } from '../test/fixtures'
import { choose } from '../test/select'
import { server } from '../test/server'
import { warmSchedule } from '../test/wait'

/**
 * Выбор кресла у приёма (V210). Врачи и пациенты — вымышленные: «Кресло 1» — у Айгерим (№1) и Дастана (№2),
 * «Кресло 2» пока пустое. В 09:00 завтра «Кресло 1» занято приёмом Айгерим.
 */
beforeAll(warmSchedule, 60_000)
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

const NONE: Check = { strict: false, freeChairs: [], notified: [] }

/**
 * chair-check глазами сервера: «Кресло 1» в 09:00 занято приёмом Айгерим. Свободны «Кресло 2» (основное у Бакыта — ему
 * придёт уведомление) и «Кресло 3» (часы Эльмиры, «Предупреждать»). «Кресло 4» в режиме «Запрещать» сервер не предлагает.
 */
function busyCheck(chairId: number | null): Check {
  if (chairId === 6) return { ...NONE, notified: ['Бакыт Осмонов'] }
  return {
    strict: false, notified: [],
    busy: { chairName: 'Кресло 1', doctorName: 'Айгерим Садыкова', start: nine(), end: nineThirty() },
    freeChair: { id: 6, name: 'Кресло 2', notified: ['Бакыт Осмонов'] },
    freeChairs: [{ id: 6, name: 'Кресло 2', notified: ['Бакыт Осмонов'] }, { id: 7, name: 'Кресло 3', colleague: 'Эльмира К.', notified: ['Эльмира К.'] }],
  }
}

const FOUR: Chair[] = [
  ...TWO,
  { id: 7, name: 'Кресло 3', doctorIds: [3], overlaps: [], mode: 'WARN' },
  { id: 8, name: 'Кресло 4', doctorIds: [], overlaps: [], mode: 'STRICT' },
]

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

test('одно кресло — про кресла ничего: ни поля, ни подписей, chairId не уходит', async () => {
  const posts = backend(ok, [TWO[0]!], [], () => NONE)
  const panel = await openNew()

  await userEvent.click(within(panel).getByRole('button', { name: 'Записать' }))
  await waitFor(() => expect(posts).toHaveLength(1))
  expect(posts[0]!.chairId).toBeUndefined()
  expect(within(panel).queryByRole('combobox', { name: /Кресло/ })).not.toBeInTheDocument()
  expect(within(panel).queryByText(/кресл/i)).not.toBeInTheDocument()
})

test('несколько кресел, кресло врача свободно — поля «Кресло» нет и chairId не уходит', async () => {
  const posts = backend(ok, FOUR, [], () => NONE)
  const panel = await openNew()

  expect(within(panel).queryByRole('combobox', { name: /Кресло/ })).not.toBeInTheDocument()
  expect(within(panel).queryByText(/кресло врача/i)).not.toBeInTheDocument()
  await userEvent.click(within(panel).getByRole('button', { name: 'Записать' }))
  await waitFor(() => expect(posts).toHaveLength(1))
  expect(posts[0]!.chairId).toBeUndefined()
  expect(within(panel).queryByText(/Свободно:/)).not.toBeInTheDocument()
})

test('кресло врача занято — «Кресло 1 в это время занято (Айгерим). Свободно: [Кресло 2] [Кресло 3]», без «Запрещать»; нажатие отправляет chairId', async () => {
  const posts = backend(ok, FOUR)
  const panel = await openNew()

  const block = await within(panel).findByText('🪑 Кресло 1 в это время занято (Айгерим Садыкова).')
  const conflict = block.closest('.chair-conflict') as HTMLElement
  expect(conflict).toHaveTextContent('Свободно:Кресло 2Кресло 3 · время Эльмира К.')
  // «Кресло 4» — «Запрещать»: сервер его не предлагает, и фронт ничего не добавляет от себя
  expect(within(conflict).queryByRole('button', { name: /Кресло 4/ })).not.toBeInTheDocument()
  expect(within(panel).queryByRole('combobox', { name: /Кресло/ })).not.toBeInTheDocument()

  await userEvent.click(within(conflict).getByRole('button', { name: 'Записать в «Кресло 2»' }))
  const picked = await within(panel).findByText(/Запишем в «Кресло 2»/)
  expect(picked).toHaveTextContent('🪑 Запишем в «Кресло 2». Врачу кресла (Бакыт Осмонов) придёт уведомление. в кресло врача')
  expect(within(panel).queryByText(/в это время занято/)).not.toBeInTheDocument()

  // Передумали — снова кресло врача и блок о занятости
  await userEvent.click(within(picked).getByRole('button', { name: 'в кресло врача' }))
  const again = await within(panel).findByText('🪑 Кресло 1 в это время занято (Айгерим Садыкова).')
  await userEvent.click(within(again.closest('.chair-conflict') as HTMLElement).getByRole('button', { name: 'Записать в «Кресло 2»' }))
  await within(panel).findByText(/Запишем в «Кресло 2»/)

  await userEvent.click(within(panel).getByRole('button', { name: 'Записать' }))
  await waitFor(() => expect(posts).toHaveLength(1))
  expect(posts[0]!.chairId).toBe(6)
})

test('свободных кресел нет — «Свободных кресел на это время нет — выберите другое время»', async () => {
  backend(ok, FOUR, [], (chairId) => ({ ...busyCheck(chairId), freeChair: undefined, freeChairs: [] }))
  const panel = await openNew()

  const block = await within(panel).findByText('🪑 Кресло 1 в это время занято (Айгерим Садыкова).')
  expect(block.closest('.chair-conflict')).toHaveTextContent('Свободных кресел на это время нет — выберите другое время.')
  expect(within(panel).queryByRole('button', { name: /Записать в/ })).not.toBeInTheDocument()
})

const busy409 = (extra: Record<string, unknown> = {}) => HttpResponse.json({
  title: 'Conflict', status: 409, code: 'time-taken', detail: 'Кресло занято: «Кресло 1» в это время у врача Айгерим Садыкова',
  chairId: 5, chairName: 'Кресло 1', doctorName: 'Айгерим Садыкова', busyStart: nine(), busyEnd: nineThirty(),
  freeChairId: 6, freeChairName: 'Кресло 2', freeChairNotified: ['Бакыт Осмонов'], ...extra,
}, { status: 409 })

test('ничего не выбрали и нажали «Записать» — 409 «кресло занято»: окно «Свободно «Кресло 2» — записать туда?» и повтор в свободное', async () => {
  const posts = backend((body) => body.chairId === 6 ? ok(body) : busy409())
  await openNew()
  await userEvent.click(screen.getByRole('button', { name: 'Записать' }))

  const dialog = await screen.findByRole('alertdialog')
  expect(dialog).toHaveTextContent('«Кресло 1» занято: приём Айгерим Садыкова 09:00–09:30. Свободно «Кресло 2» — записать туда?'
    + ' Врачу кресла (Бакыт Осмонов) придёт уведомление.')
  expect(dialog).not.toHaveTextContent('время врача')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Записать в «Кресло 2»' }))

  await waitFor(() => expect(posts).toHaveLength(2))
  // Первый раз — без кресла: сервер сам посадил бы в кресло врача
  expect(posts[0]!.chairId).toBeUndefined()
  expect(posts[1]!.chairId).toBe(6)
  await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Новая запись' })).not.toBeInTheDocument())
})

test('свободное кресло — в часы его врача: согласились в одном окне — без второго «Коллега предупреждён?»', async () => {
  const posts = backend((body) => body.chairId === 6 ? ok(body) : busy409({ freeChairColleague: 'Бакыт Осмонов' }))
  await openNew()
  await userEvent.click(screen.getByRole('button', { name: 'Записать' }))

  const dialog = await screen.findByRole('alertdialog')
  expect(dialog).toHaveTextContent('Свободно «Кресло 2» (часы врача Бакыт Осмонов) — записать туда? Врачу кресла (Бакыт Осмонов) придёт уведомление.')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Записать в «Кресло 2»' }))

  await waitFor(() => expect(posts).toHaveLength(2))
  expect(posts[1]).toMatchObject({ chairId: 6, confirmChairTime: true })
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
})

test('отказались от свободного кресла — ответ сервера под формой, без второго блока о том же кресле', async () => {
  backend(() => busy409())
  const panel = await openNew()
  await within(panel).findByText(/Кресло 1 в это время занято/)
  await userEvent.click(within(panel).getByRole('button', { name: 'Записать' }))
  await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Отмена' }))

  expect(await within(panel).findByText('Кресло занято: «Кресло 1» в это время у врача Айгерим Садыкова')).toBeInTheDocument()
  expect(within(panel).queryByText(/в это время занято \(/)).not.toBeInTheDocument()
})

test('кресло пустое, но часы коллеги («Предупреждать») — «занято (часы врача …)», можно и сюда, и свободные кресла', async () => {
  backend(ok, TWO, [], () => ({
    strict: false, notified: [],
    colleague: { doctorId: 1, doctorName: 'Айгерим Садыкова', chairName: 'Кресло 1', start: nine(), end: nineThirty() },
    freeChairs: [{ id: 6, name: 'Кресло 2', notified: [] }],
  }))
  const panel = await openNew()

  const text = await within(panel).findByText(/Кресло 1 в это время занято \(часы врача Айгерим Садыкова, 09:00–09:30\)/)
  expect(text).toHaveTextContent('Можно и сюда — после «Записать» спросим, предупреждён ли коллега.')
  expect(text.closest('.chair-conflict')).toHaveTextContent('Свободно:Кресло 2')
})

test('часы коллеги в «Запрещать» — «сюда записать нельзя», свободные — кнопками', async () => {
  backend(ok, TWO, [], () => ({
    strict: true, notified: [],
    colleague: { doctorId: 1, doctorName: 'Айгерим Садыкова', chairName: 'Кресло 1', start: nine(), end: nineThirty() },
    freeChairs: [{ id: 6, name: 'Кресло 2', notified: [] }],
  }))
  const panel = await openNew()

  const text = await within(panel).findByText(/Сюда записать нельзя\./)
  expect(text).not.toHaveTextContent('Можно и сюда')
  expect(within(text.closest('.chair-conflict') as HTMLElement).getByRole('button', { name: 'Записать в «Кресло 2»' })).toBeInTheDocument()
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
