import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { minutesOf, slotInstant } from '../lib/time'
import { appointment, me, openItem, renderApp } from '../test/fixtures'
import { server } from '../test/server'

/**
 * Часы коллеги по креслу (V187) в «Расписании» на компьютере и «Настройки → Кресла». Врачи и пациенты —
 * вымышленные: у Дастана (№2) общее «Кресло 1» с Айгерим (№1), её часы — 15:00–18:00.
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

type Check = Schemas['ChairCheckView']

/** Часы Айгерим глазами сервера (chair-check): 15:00–18:00 и вечер 22:00–23:30 — у Дастана (№2) общее кресло. */
function herTime(doctorId: number, startAt: string, endAt: string, strict = false): Check {
  const [s, e] = [minutesOf(startAt), minutesOf(endAt)]
  const hit = [[15 * 60, 18 * 60], [22 * 60, 23 * 60 + 30]].find(([a, b]) => s < b! && e > a!)
  if (doctorId !== 2 || !hit) return { colleague: undefined, strict, notified: [] }
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bishkek' }).format(new Date(startAt))
  const start = slotInstant(day, Math.max(s, hit[0]!))
  const end = slotInstant(day, Math.min(e, hit[1]!))
  return { colleague: { doctorId: 1, doctorName: 'Айгерим Садыкова', chairName: 'Кресло 1', start, end }, strict, notified: [] }
}

function backend(created: (body: Create) => Response, chairs: Schemas['ChairOverview'][] = [{ id: 5, name: 'Кресло 1', doctorIds: [1, 2], overlaps: [], mode: 'WARN' }],
  check: (doctorId: number, startAt: string, endAt: string) => Check = herTime) {
  const posts: Create[] = []
  server.use(
    http.get('*/api/appointments/chair-check', ({ request }) => {
      const q = new URL(request.url).searchParams
      return HttpResponse.json(check(Number(q.get('doctorId')), q.get('startAt')!, q.get('endAt')!))
    }),
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments', () => HttpResponse.json([])),
    http.get('*/api/chairs', () => HttpResponse.json(chairs)),
    http.get('*/api/slots', ({ request }) => {
      const url = new URL(request.url)
      const date = url.searchParams.get('date')!
      const doctorId = Number(url.searchParams.get('doctorId'))
      return HttpResponse.json({
        workingDay: true, workStart: '09:00:00', workEnd: '18:00:00', breaks: [],
        starts: doctorId === 2 ? [slotInstant(date, 15 * 60)] : [],
        free: doctorId === 2 ? [{ start: slotInstant(date, 15 * 60), end: slotInstant(date, 18 * 60) }] : [],
        chairBusy: [],
        chairTime: doctorId === 2
          ? [{ start: slotInstant(date, 15 * 60), end: slotInstant(date, 18 * 60), doctorId: 1, doctorName: 'Айгерим Садыкова', chairName: 'Кресло 1' }]
          : [],
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

function colleagueTime(strict: boolean, detail: string) {
  return HttpResponse.json({
    title: 'Conflict', status: 409, detail, code: 'chair-colleague-time', strict,
    chairId: 5, chairName: 'Кресло 1', doctorId: 1, doctorName: 'Айгерим Садыкова',
  }, { status: 409 })
}

/** «Следующий день» → колонка Дастана → «Свободно» с 15:00 → пациент → «Записать». */
async function bookAtThree() {
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Следующий день' }))
  const column = await screen.findByRole('group', { name: 'Дастан Т.' })
  await userEvent.click(await within(column).findByRole('button', { name: 'Свободно с 15:00 до 18:00, записать' }))
  const panel = await screen.findByRole('complementary', { name: 'Новая запись' })
  await within(panel).findByRole('group', { name: 'Свободное время' })
  await userEvent.type(within(panel).getByLabelText('Найти пациента'), 'Нур')
  await userEvent.click(await within(panel).findByRole('button', { name: /Нурлан К\./ }))
  await userEvent.click(within(panel).getByRole('button', { name: 'Записать' }))
  return panel
}

test('часы коллеги по креслу — своей штриховкой «🪑 время Айгерим», и «Свободно» под ней нажимается', async () => {
  backend(() => HttpResponse.json({}, { status: 500 }))
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Следующий день' }))

  const column = await screen.findByRole('group', { name: 'Дастан Т.' })
  const band = await within(column).findByRole('note', { name: '15:00–18:00: время Айгерим Садыкова' })
  expect(band).toHaveTextContent('🪑 время Айгерим Садыкова')
  expect(band).toHaveClass('grid-colleague')
  expect(band).not.toHaveClass('grid-chair')
  // У Айгерим (без коллег в её часах) полосы нет
  const own = await screen.findByRole('group', { name: 'Айгерим Садыкова' })
  expect(within(own).queryByRole('note', { name: /время/ })).not.toBeInTheDocument()
})

test('выбрали время коллеги — подсказка в форме сразу, до «Записать»', async () => {
  backend(() => HttpResponse.json({}, { status: 500 }))
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Следующий день' }))
  const column = await screen.findByRole('group', { name: 'Дастан Т.' })
  await userEvent.click(await within(column).findByRole('button', { name: 'Свободно с 15:00 до 18:00, записать' }))
  const panel = await screen.findByRole('complementary', { name: 'Новая запись' })
  expect(await within(panel).findByText(/15:00–15:30 — время врача Айгерим Садыкова \(Кресло 1\)/)).toBeInTheDocument()
})

/** «Следующий день» → колонка Дастана → «Свободно» → «Другое время» → ввести время руками. */
async function otherTime(time: string) {
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Следующий день' }))
  const column = await screen.findByRole('group', { name: 'Дастан Т.' })
  await userEvent.click(await within(column).findByRole('button', { name: 'Свободно с 15:00 до 18:00, записать' }))
  const panel = await screen.findByRole('complementary', { name: 'Новая запись' })
  await userEvent.click(await within(panel).findByRole('button', { name: 'Другое время' }))
  const input = within(panel).getByLabelText('Время', { selector: 'input' })
  // Значение целиком: user-event печатает в <input type="time"> jsdom по цифре и путает минуты (22:43 → 22:04)
  fireEvent.change(input, { target: { value: time } })
  return panel
}

test('«Другое время» вне часов врача, но в часы коллеги (22:43) — подсказка от сервера', async () => {
  backend(() => HttpResponse.json({}, { status: 500 }))
  const panel = await otherTime('22:43')
  // В chairTime слотов Дастана вечера нет — подсказку даёт chair-check
  expect(await within(panel).findByRole('status')).toHaveTextContent(
    '🪑 22:43–23:13 — время врача Айгерим Садыкова (Кресло 1). Предупредите коллегу: после «Записать» спросим, предупреждён ли он.')
})

test('«Запрещать» — подсказка, что записать нельзя', async () => {
  backend(() => HttpResponse.json({}, { status: 500 }), undefined, (d, s, e) => herTime(d, s, e, true))
  const panel = await otherTime('22:43')
  expect(await within(panel).findByText('🪑 Это время врача Айгерим Садыкова — записать нельзя, пусть Айгерим Садыкова поставит себе перерыв.'))
    .toBeInTheDocument()
})

test('без коллеги в это время — подсказки нет', async () => {
  const asked: string[] = []
  backend(() => HttpResponse.json({}, { status: 500 }), undefined, (d, s, e) => { asked.push(s); return herTime(d, s, e) })
  const panel = await otherTime('20:00')
  // Сервер спросили про 20:00 — и он ответил «никого»
  await waitFor(() => expect(asked.map(minutesOf)).toContain(20 * 60))
  expect(within(panel).queryByText(/🪑/)).not.toBeInTheDocument()
})

test('перенос «Другим временем» в часы коллеги — та же подсказка, «после «Перенести»»', async () => {
  backend(() => HttpResponse.json({}, { status: 500 }))
  const a = appointment(10, 2, '10:00', 'Бакыт М.')
  server.use(http.get('*/api/appointments', ({ request }) =>
    HttpResponse.json(new URL(request.url).searchParams.get('doctorId') === '2' ? [a] : [])))
  renderApp()
  // Блок приёма в сетке (у него подпись «10:00–10:30, Бакыт М.»), а не «Следующий» в полосе дня
  await userEvent.click(await screen.findByRole('button', { name: /10:00–10:30, Бакыт М\./ }))
  const panel = screen.getByRole('complementary', { name: 'Карточка приёма' })
  await userEvent.click(within(panel).getByRole('button', { name: 'Перенести или передать врачу' }))
  const form = within(panel).getByRole('form', { name: 'Перенос записи' })
  if (!within(form).queryByLabelText('Время', { selector: 'input' })) await userEvent.click(within(form).getByRole('button', { name: 'Другое время' }))
  fireEvent.change(within(form).getByLabelText('Время', { selector: 'input' }), { target: { value: '22:43' } })
  expect(await within(form).findByText(/22:43–23:13 — время врача Айгерим Садыкова \(Кресло 1\)\. Предупредите коллегу: после «Перенести»/))
    .toBeInTheDocument()
})

test('«Предупреждать»: окно «Коллега предупреждён?», «Записать» — тот же запрос с confirmChairTime', async () => {
  const detail = 'Это время врача Айгерим Садыкова (Кресло 1). Коллега предупреждён?'
  const posts = backend((body) => body.confirmChairTime
    ? HttpResponse.json({ id: 40, doctorId: 2, startAt: body.startAt, endAt: body.startAt, status: 'SCHEDULED', reply: 'NONE', version: 0, patient: { id: 7, fullName: 'Нурлан К.' } }, { status: 201 })
    : colleagueTime(false, detail))
  await bookAtThree()

  const dialog = await screen.findByRole('alertdialog')
  expect(dialog).toHaveTextContent(detail)
  expect(within(dialog).getByRole('button', { name: 'Отмена' })).toBeInTheDocument()
  await userEvent.click(within(dialog).getByRole('button', { name: 'Записать' }))

  await waitFor(() => expect(posts).toHaveLength(2))
  expect(posts[0]!.confirmChairTime).toBeUndefined()
  expect(posts[1]).toMatchObject({ doctorId: 2, patientId: 7, confirmChairTime: true })
  expect(posts[1]!.startAt).toBe(posts[0]!.startAt)
})

test('«Предупреждать», «Отмена» — второй раз не шлём, под формой — что не записали', async () => {
  const posts = backend(() => colleagueTime(false, 'Это время врача Айгерим Садыкова (Кресло 1). Коллега предупреждён?'))
  const panel = await bookAtThree()

  await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Отмена' }))

  await waitFor(() => expect(within(panel).getByRole('alert')).toHaveTextContent('Не записали: это время врача Айгерим Садыкова'))
  expect(posts).toHaveLength(1)
})

test('«Запрещать»: окно без кнопки «Записать», повтора нет', async () => {
  const detail = 'Это время врача Айгерим Садыкова. Чтобы записать — пусть Айгерим Садыкова поставит себе перерыв на это время'
  const posts = backend(() => colleagueTime(true, detail))
  const panel = await bookAtThree()

  const dialog = await screen.findByRole('alertdialog')
  expect(dialog).toHaveTextContent(detail)
  expect(within(dialog).queryByRole('button', { name: 'Записать' })).not.toBeInTheDocument()
  expect(within(dialog).queryByRole('button', { name: 'Отмена' })).not.toBeInTheDocument()
  await userEvent.click(within(dialog).getByRole('button', { name: 'Понятно' }))

  await waitFor(() => expect(within(panel).getByRole('alert')).toHaveTextContent(detail))
  expect(posts).toHaveLength(1)
})

test('«Клиника → Кресла»: переименовать, режим «Запрещать», удалить пустое', async () => {
  let chairs: Schemas['ChairOverview'][] = [
    { id: 5, name: 'Кресло 1', doctorIds: [1, 2], overlaps: [], mode: 'WARN' },
    { id: 6, name: 'Кабинет 2', doctorIds: [], overlaps: [], mode: 'WARN' },
  ]
  const calls: string[] = []
  backend(() => HttpResponse.json({}, { status: 500 }), chairs)
  server.use(
    http.get('*/api/chairs', () => HttpResponse.json(chairs)),
    http.put('*/api/chairs/:id/mode', async ({ params, request }) => {
      const { mode } = (await request.json()) as Schemas['ChairControllerModeRequest']
      calls.push(`mode ${params.id} ${mode}`)
      chairs = chairs.map((c) => (c.id === Number(params.id) ? { ...c, mode } : c))
      return HttpResponse.json({ id: Number(params.id), name: 'Кресло 1', doctorIds: [1, 2], mode } satisfies Schemas['ChairsChair'])
    }),
    http.put('*/api/chairs/:id', async ({ params, request }) => {
      const { name } = (await request.json()) as Schemas['ChairControllerNameRequest']
      calls.push(`name ${params.id} ${name}`)
      chairs = chairs.map((c) => (c.id === Number(params.id) ? { ...c, name } : c))
      return HttpResponse.json({ id: Number(params.id), name, doctorIds: [1, 2], mode: 'WARN' } satisfies Schemas['ChairsChair'])
    }),
    http.delete('*/api/chairs/:id', ({ params }) => {
      calls.push(`delete ${params.id}`)
      chairs = chairs.filter((c) => c.id !== Number(params.id))
      return new HttpResponse(null, { status: 204 })
    }),
  )
  renderApp()
  openItem('chairs')

  const first = await screen.findByRole('region', { name: 'Кресло 1' })
  expect(within(first).getByRole('list', { name: 'Врачи: Кресло 1' })).toHaveTextContent('🪑 Айгерим Садыкова✕🪑 Дастан Т.✕')
  // Удалить можно и кресло с врачами — с подтверждением (ChairsPage, chairs.test)
  expect(within(first).getByRole('button', { name: 'Удалить кресло' })).toBeInTheDocument()
  expect(within(first).getByRole('radio', { name: /Предупреждать/ })).toBeChecked()

  await userEvent.click(within(first).getByRole('radio', { name: /Запрещать/ }))
  await waitFor(() => expect(calls).toContain('mode 5 STRICT'))
  await waitFor(() => expect(within(first).getByRole('radio', { name: /Запрещать/ })).toBeChecked())

  const name = within(first).getByLabelText('Название')
  await userEvent.clear(name)
  await userEvent.type(name, 'Кабинет 1')
  await userEvent.click(within(first).getByRole('button', { name: 'Сохранить' }))
  await waitFor(() => expect(calls).toContain('name 5 Кабинет 1'))

  const empty = screen.getByRole('region', { name: 'Кабинет 2' })
  expect(empty).toHaveTextContent('Пустое')
  await userEvent.click(within(empty).getByRole('button', { name: 'Удалить кресло' }))
  await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Удалить' }))
  await waitFor(() => expect(calls).toContain('delete 6'))
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Кабинет 2' })).not.toBeInTheDocument())
})
