import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { createQueryClient } from '../api/queryClient'
import { readDeepLink } from '../lib/deepLink'
import { addDays, todayIn, weekStart } from '../lib/time'
import { findSub, me, openItem, querySub, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { OnDuty } from './OnDuty'
import { waitForSlow } from '../test/wait'

// Вымышленные сотрудники клиники
const people: Schemas['ShiftServicePerson'][] = [
  { telegramId: 501, fullName: 'Айпери', role: 'RECEPTION' },
  { telegramId: 502, fullName: 'Бермет', role: 'RECEPTION' },
  { telegramId: 503, fullName: 'Асель', role: 'ASSISTANT' },
]
const monday = weekStart(todayIn())
const tuesday = addDays(monday, 1)
const shifts: Schemas['ShiftServiceShiftView'][] = [
  { id: 1, telegramId: 501, day: monday, startTime: '09:00:00', endTime: '15:00:00' },
  { id: 2, telegramId: 502, day: monday, startTime: '15:00:00', endTime: '21:00:00', note: 'вечер' },
]
const dayLong = (date: string) => {
  const text = new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${date}T00:00:00Z`))
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function schedule(canEdit: boolean, mine: number): Schemas['ShiftControllerSchedule'] {
  return { people, shifts, canEdit, me: mine }
}

beforeEach(() => {
  window.location.hash = '/settings/shifts'
})
afterEach(() => {
  window.location.hash = ''
  vi.restoreAllMocks()
})

test('админ, неделя по датам: врачи и персонал одной сеткой; смена сотрудника — добавить, изменить, удалить', async () => {
  const sent: unknown[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/shifts', () => HttpResponse.json(schedule(true, 111))),
    http.post('*/api/shifts', async ({ request }) => {
      sent.push(await request.json())
      return HttpResponse.json({ id: 3, telegramId: 502, day: tuesday, startTime: '10:00:00', endTime: '16:00:00' }, { status: 201 })
    }),
    http.delete('*/api/shifts/:id', ({ params }) => {
      sent.push(`delete ${String(params.id)}`)
      return new HttpResponse(null, { status: 204 })
    }),
  )
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  const user = userEvent.setup()
  renderApp()

  const table = await screen.findByRole('table', { name: 'График на неделю' })
  // Врачи и сотрудники вместе, роль серым
  expect(within(table).getByRole('row', { name: /Айгерим Садыкова \(вы\)/ })).toBeInTheDocument()
  expect(within(table).getByRole('row', { name: /Дастан Т\./ })).toBeInTheDocument()
  expect(within(table).getByRole('row', { name: /Асель/ })).toBeInTheDocument()
  const aiperi = within(table).getByRole('row', { name: /Айпери/ })
  expect(within(aiperi).getByRole('button', { name: `Айпери, ${dayLong(monday)}: смена 09:00–15:00 — изменить` })).toHaveTextContent('9–15')

  await user.click(within(table).getByRole('button', { name: `Добавить смену: Бермет, ${dayLong(tuesday)}` }))
  const form = await screen.findByRole('form', { name: 'Новая смена' })
  const start = within(form).getByLabelText('С')
  const end = within(form).getByLabelText('До')
  await user.clear(start)
  await user.type(start, '10:00')
  await user.clear(end)
  await user.type(end, '16:00')
  await user.click(within(form).getByRole('button', { name: 'Добавить смену' }))
  await waitForSlow(() => expect(sent).toEqual([{ telegramId: 502, day: tuesday, startTime: '10:00', endTime: '16:00' }]))
  expect(screen.queryByRole('form', { name: 'Новая смена' })).not.toBeInTheDocument()

  await user.click(within(aiperi).getByRole('button', { name: /смена 09:00–15:00/ }))
  const edit = await screen.findByRole('form', { name: 'Изменить смену' })
  await user.click(within(edit).getByRole('button', { name: 'Удалить' }))
  await waitForSlow(() => expect(sent).toContain('delete 1'))
})

test('пересечение: текст ошибки сервера под временем', async () => {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/shifts', () => HttpResponse.json(schedule(true, 111))),
    http.post('*/api/shifts', () => HttpResponse.json({ status: 422, detail: 'Проверьте поля',
      errors: [{ field: 'startTime', message: 'У сотрудника в этот день уже есть смена в это время' }] }, { status: 422 })),
  )
  const user = userEvent.setup()
  renderApp()
  const table = await screen.findByRole('table', { name: 'График на неделю' })
  await user.click(within(table).getByRole('button', { name: `Добавить смену: Айпери, ${dayLong(monday)}` }))
  const form = await screen.findByRole('form', { name: 'Новая смена' })
  await user.click(within(form).getByRole('button', { name: 'Добавить смену' }))
  expect(await within(form).findByText('У сотрудника в этот день уже есть смена в это время')).toBeInTheDocument()
})

test('админ: «Повторить эту неделю» на выбранное число недель', async () => {
  let body: unknown
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/shifts', () => HttpResponse.json(schedule(true, 111))),
    http.post('*/api/shifts/copy-week', async ({ request }) => {
      body = await request.json()
      return HttpResponse.json({ created: 7, skipped: 1 } satisfies Schemas['ShiftServiceCopyResult'])
    }),
  )
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
  const user = userEvent.setup()
  renderApp()

  await user.click(await screen.findByRole('button', { name: 'Повторить эту неделю на 4 недели' }))
  expect(confirm).toHaveBeenCalled()
  expect(await screen.findByRole('status')).toHaveTextContent('Добавлено смен: 7 · пропущено (уже занято): 1')
  expect(body).toEqual({ weekStart: monday, weeks: 4 })
})

test('регистратура: смены персонала только смотрит, своя строка подсвечена; перерыв врачу на дату — может', async () => {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json({ ...me, admin: false, reception: true, doctorId: undefined })),
    http.get('*/api/shifts', () => HttpResponse.json(schedule(false, 501))),
  )
  renderApp()

  const table = await screen.findByRole('table', { name: 'График на неделю' })
  const mine = within(table).getByRole('row', { name: /Айпери \(вы\)/ })
  expect(mine).toHaveAttribute('aria-current', 'true')
  expect(within(mine).getByText('9–15')).toBeInTheDocument()
  expect(within(mine).queryAllByRole('button')).toHaveLength(0)
  expect(within(table).getByRole('button', { name: `Перерыв или выходной: Дастан Т., ${dayLong(monday)}` })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Повторить эту неделю/ })).not.toBeInTheDocument()
})

test('ассистент: график только для чтения', async () => {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json({ ...me, admin: false, doctorId: undefined, assistantOf: [1] })),
    http.get('*/api/shifts', () => HttpResponse.json(schedule(false, 503))),
  )
  renderApp()
  const table = await screen.findByRole('table', { name: 'График на неделю' })
  expect(screen.getByText(/График ведёт руководитель клиники.*Ваша строка подсвечена/)).toBeInTheDocument()
  expect(within(table).queryAllByRole('button')).toHaveLength(0)
  // Врачей ассистент здесь не видит, как раньше в «Часах врачей»
  expect(within(table).queryByText('Дастан Т.')).not.toBeInTheDocument()
})

test('пусто: «В графике пока никого» — «+ Добавить сотрудника» открывает общую форму', async () => {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json({ ...me, doctorId: undefined, doctors: [] })),
    http.get('*/api/shifts', () => HttpResponse.json({ people: [], shifts: [], canEdit: true, me: 111 } satisfies Schemas['ShiftControllerSchedule'])),
  )
  const user = userEvent.setup()
  renderApp()
  expect(await screen.findByText('В графике пока никого')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '+ Добавить сотрудника' }))
  expect(await screen.findByRole('complementary', { name: 'Новый сотрудник' })).toBeInTheDocument()
})

test('«Рабочее время»: вкладки «График» и «Перерывы и выходные»; старые адреса — на свои места', async () => {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/shifts', () => HttpResponse.json(schedule(true, 111))),
  )
  window.location.hash = '/clinic'
  renderApp()
  expect(await findSub('Рабочее время')).toBeInTheDocument()
  expect(querySub(/График смен/)).not.toBeInTheDocument()
  await userEvent.click(await findSub('Рабочее время'))
  expect(await screen.findByRole('tab', { name: 'График' })).toHaveAttribute('aria-selected', 'true')
  expect(screen.queryByRole('tab', { name: 'Врачи' })).not.toBeInTheDocument()
  expect(screen.queryByRole('tab', { name: 'Смены персонала' })).not.toBeInTheDocument()
  expect(await screen.findByRole('table', { name: 'Обычная неделя' })).toBeInTheDocument()
  expect(screen.getByRole('form', { name: 'Часы клиники' })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Неделя по датам' }))
  expect(await screen.findByRole('table', { name: 'График на неделю' })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('tab', { name: 'Перерывы и выходные' }))
  expect(screen.getByRole('tab', { name: 'Перерывы и выходные' })).toHaveAttribute('aria-selected', 'true')
  // Назад в «График» — на той же неделе по датам
  await userEvent.click(screen.getByRole('tab', { name: 'График' }))
  expect(await screen.findByRole('table', { name: 'График на неделю' })).toBeInTheDocument()

  // Старые адреса — закладки и кнопки бота: #/settings/timeoff, #/settings/shifts, #/clinic/hours
  openItem('timeoff')
  expect(await screen.findByRole('tab', { name: 'Перерывы и выходные' })).toHaveAttribute('aria-selected', 'true')
  openItem('shifts')
  expect(await screen.findByRole('tab', { name: 'График' })).toHaveAttribute('aria-selected', 'true')
  expect(await screen.findByRole('table', { name: 'График на неделю' })).toBeInTheDocument()
  openItem('hours')
  expect(await screen.findByRole('table', { name: 'Обычная неделя' })).toBeInTheDocument()
})

test('обычная неделя: врачи и сотрудники одним списком; один редактор сохраняет врача в его часы, сотрудника — в staff_hours', async () => {
  const weekly: Schemas['ShiftServiceWeekly'][] = [
    { telegramId: 501, custom: true, days: [{ weekday: 'MONDAY', start: '10:00:00', end: '14:00:00' }, { weekday: 'TUESDAY', start: '10:00:00', end: '14:00:00' }] },
    { telegramId: 502, custom: false, days: [{ weekday: 'TUESDAY', start: '09:00:00', end: '18:00:00' }] },
    { telegramId: 503, custom: false, days: [] },
  ]
  const saved: Record<string, unknown> = {}
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/shifts', () => HttpResponse.json({ ...schedule(true, 111), weekly })),
    http.get('*/api/shifts/weekly/503', () => HttpResponse.json(weekly[2]!)),
    http.put('*/api/shifts/weekly/503', async ({ request }) => {
      saved.staff = await request.json()
      return HttpResponse.json({ telegramId: 503, custom: true, days: [{ weekday: 'MONDAY', start: '09:00:00', end: '18:00:00' }] } satisfies Schemas['ShiftServiceWeekly'])
    }),
    http.get('*/api/doctors/2/hours', () => HttpResponse.json({ custom: true, days: [{ weekday: 'FRIDAY', start: '18:00:00', end: '08:00:00' }] } satisfies Schemas['DoctorHoursView'])),
    http.put('*/api/doctors/2/hours', async ({ request }) => {
      saved.doctor = await request.json()
      return HttpResponse.json({ custom: true, days: [{ weekday: 'FRIDAY', start: '18:00:00', end: '08:00:00' }] } satisfies Schemas['DoctorHoursView'])
    }),
  )
  window.location.hash = '/clinic/hours'
  const user = userEvent.setup()
  renderApp()
  const list = await screen.findByRole('table', { name: 'Обычная неделя' })
  const aiperi = within(list).getByRole('row', { name: /Айпери/ })
  expect(aiperi).toHaveTextContent('10–14')
  expect(within(list).getByRole('row', { name: /Бермет.*как у клиники/ })).toHaveTextContent('9–18')
  // Ночная смена врача — «18–8 🌙»
  expect(await within(list).findByText('18–8 🌙')).toBeInTheDocument()
  // Свой врач (Айгерим) раскрыт сразу — закроем, чтобы на странице был один редактор
  await user.click(within(list).getByRole('button', { name: 'Айгерим Садыкова (вы)' }))

  // Сотрудник: нажатие на строку целиком (не на имя) открывает редактор
  await user.click(within(list).getByRole('row', { name: /Асель/ }).querySelector('td')!)
  await user.click(await screen.findByRole('button', { name: 'Свои часы' }))
  await user.click(screen.getByRole('checkbox', { name: 'Понедельник' }))
  await user.click(screen.getByRole('button', { name: 'Сохранить часы' }))
  expect(await screen.findByText('Часы работы сохранены')).toBeInTheDocument()
  expect(saved.staff).toEqual({ days: [{ weekday: 'MONDAY', start: '09:00', end: '18:00' }] })
  await user.click(within(list).getByRole('button', { name: 'Асель' }))

  // Врач: тот же редактор, ночная смена — можно, сохраняет в часы врача
  await user.click(within(list).getByRole('button', { name: 'Дастан Т.' }))
  expect(await screen.findByText('🌙 до утра след. дня')).toBeInTheDocument()
  await user.click(screen.getByRole('checkbox', { name: 'Суббота' }))
  await user.click(screen.getByRole('button', { name: 'Сохранить часы' }))
  await waitForSlow(() => expect(saved.doctor).toEqual({ days: [
    { weekday: 'FRIDAY', start: '18:00', end: '08:00' }, { weekday: 'SATURDAY', start: '09:00', end: '18:00' }] }))
})

test('сотрудник: ночной график нельзя — «в пределах суток»', async () => {
  const weekly: Schemas['ShiftServiceWeekly'][] = [{ telegramId: 503, custom: true, days: [{ weekday: 'MONDAY', start: '09:00:00', end: '18:00:00' }] }]
  let put = false
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json({ ...me, doctorId: undefined })),
    http.get('*/api/shifts', () => HttpResponse.json({ ...schedule(true, 111), weekly })),
    http.get('*/api/shifts/weekly/503', () => HttpResponse.json(weekly[0]!)),
    http.put('*/api/shifts/weekly/503', () => { put = true; return HttpResponse.json(weekly[0]!) }),
  )
  window.location.hash = '/clinic/hours'
  const user = userEvent.setup()
  renderApp()
  await user.click(await screen.findByRole('button', { name: 'Асель' }))
  const end = await screen.findByRole('textbox', { name: 'Понедельник: до' })
  await user.clear(end)
  await user.type(end, '08:00')
  await user.click(screen.getByRole('button', { name: 'Сохранить часы' }))
  expect(await screen.findByText('Понедельник: конец — позже начала (у персонала смена в пределах суток)')).toBeInTheDocument()
  expect(put).toBe(false)
})

test('врач: в «Графике» только он из врачей, персонал — без правки; выходной на дату ставит себе и убирает', async () => {
  const sent: unknown[] = []
  const vacation: Schemas['TimeOffView'] = { id: 77, doctorId: 1, firstDay: monday, lastDay: tuesday, title: 'Отпуск', emoji: '🏖️' }
  const holiday: Schemas['TimeOffView'] = { id: 78, firstDay: tuesday, lastDay: tuesday, title: 'Праздник', emoji: '🎉' }
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json({ ...me, admin: false, doctorId: 1 })),
    http.get('*/api/shifts', () => HttpResponse.json(schedule(false, 111))),
    http.get('*/api/time-off', () => HttpResponse.json([vacation, holiday])),
    http.post('*/api/time-off', async ({ request }) => {
      sent.push(await request.json())
      return HttpResponse.json({ id: 90 } satisfies Schemas['TimeOffView'], { status: 201 })
    }),
    http.delete('*/api/time-off/:id', ({ params }) => {
      sent.push(`delete ${String(params.id)}`)
      return new HttpResponse(null, { status: 204 })
    }),
  )
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  const user = userEvent.setup()
  renderApp()
  const table = await screen.findByRole('table', { name: 'График на неделю' })
  expect(within(table).queryByText('Дастан Т.')).not.toBeInTheDocument()
  expect(within(within(table).getByRole('row', { name: /Айпери/ })).queryAllByRole('button')).toHaveLength(0)
  const mine = within(table).getByRole('row', { name: /Айгерим Садыкова \(вы\)/ })
  // Отпуск понедельник–вторник и праздник всей клиники во вторник — поверх часов
  expect(await within(mine).findByRole('button', { name: `Айгерим Садыкова, ${dayLong(monday)}: Отпуск — открыть` })).toHaveTextContent('🏖️ Отпуск')
  expect(within(mine).getByRole('button', { name: `Айгерим Садыкова, ${dayLong(tuesday)}: Праздник — открыть` })).toBeInTheDocument()

  // Свой отпуск — удалить можно (целиком, с подтверждением); общий праздник клиники — только руководитель
  await user.click(within(mine).getByRole('button', { name: `Айгерим Садыкова, ${dayLong(tuesday)}: Праздник — открыть` }))
  expect(await screen.findByText(/Выходной всей клиники убирает руководитель/)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Удалить' })).not.toBeInTheDocument()
  await user.click(within(mine).getByRole('button', { name: `Айгерим Садыкова, ${dayLong(monday)}: Отпуск — открыть` }))
  await user.click(await screen.findByRole('button', { name: 'Удалить' }))
  await waitForSlow(() => expect(sent).toContain('delete 77'))

  // Новый: часть дня в среду — запись «Перерывов и выходных» на одну дату
  const wednesday = addDays(monday, 2)
  await user.click(within(mine).getByRole('button', { name: `Перерыв или выходной: Айгерим Садыкова, ${dayLong(wednesday)}` }))
  const form = await screen.findByRole('form', { name: 'Перерыв или выходной на дату' })
  expect(screen.getByText(/Рабочие часы врача — в его недельном графике/)).toBeInTheDocument()
  await user.click(within(form).getByRole('button', { name: 'Часть дня' }))
  await user.click(within(form).getByRole('button', { name: 'Добавить' }))
  await waitForSlow(() => expect(sent).toContainEqual({ doctorId: 1, firstDay: wednesday, lastDay: wednesday, title: 'Ушёл раньше', emoji: '🚪', startTime: '15:00', endTime: '18:00' }))
})

test('из ячейки врача — к его недельному графику', async () => {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/shifts', () => HttpResponse.json(schedule(true, 111))),
  )
  const user = userEvent.setup()
  renderApp()
  const table = await screen.findByRole('table', { name: 'График на неделю' })
  await user.click(within(table).getByRole('button', { name: `Перерыв или выходной: Дастан Т., ${dayLong(monday)}` }))
  await user.click(await screen.findByRole('button', { name: '«Обычная неделя» — Дастан Т.' }))
  const list = await screen.findByRole('table', { name: 'Обычная неделя' })
  expect(within(list).getByRole('button', { name: 'Дастан Т.' })).toHaveAttribute('aria-expanded', 'true')
})

test('«На смене» в сводке дня: имена и время коротко; смен нет — блока нет', async () => {
  server.use(http.get('*/api/shifts', ({ request }) => {
    const from = new URL(request.url).searchParams.get('from')
    return HttpResponse.json(from === monday ? schedule(false, 1) : { people, shifts: [], canEdit: false, me: 1 })
  }))
  const client = createQueryClient({ queries: { retry: false } })
  const { unmount } = render(<QueryClientProvider client={client}><OnDuty date={monday} /></QueryClientProvider>)
  expect(await screen.findByRole('region', { name: 'На смене' })).toHaveTextContent('Айпери 09–15 · Бермет 15–21')
  unmount()
  render(<QueryClientProvider client={client}><OnDuty date={tuesday} /></QueryClientProvider>)
  await new Promise((r) => setTimeout(r, 50))
  expect(screen.queryByRole('region', { name: 'На смене' })).not.toBeInTheDocument()
})

test('кнопка утренней сводки «Открыть график смен» (?screen=shifts) открывает «Клиника → Рабочее время»', () => {
  expect(readDeepLink('?screen=shifts')).toEqual({ page: 'clinic', tab: 'shifts' })
})

test('«На смене»: смены нет — свой недельный график; «как у клиники» не перечисляем', async () => {
  server.use(http.get('*/api/shifts', () => HttpResponse.json({
    people, shifts: [], canEdit: false, me: 1,
    weekly: [
      { telegramId: 501, custom: true, days: [{ weekday: 'TUESDAY', start: '10:00:00', end: '14:00:00' }] },
      { telegramId: 502, custom: false, days: [{ weekday: 'TUESDAY', start: '09:00:00', end: '18:00:00' }] },
    ],
  } satisfies Schemas['ShiftControllerSchedule'])))
  const client = createQueryClient({ queries: { retry: false } })
  render(<QueryClientProvider client={client}><OnDuty date={tuesday} /></QueryClientProvider>)
  const block = await screen.findByRole('region', { name: 'На смене' })
  expect(block).toHaveTextContent('Айпери 10–14')
  expect(block).not.toHaveTextContent('Бермет')
})
