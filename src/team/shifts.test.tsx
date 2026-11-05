import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { createQueryClient } from '../api/queryClient'
import { readDeepLink } from '../lib/deepLink'
import { addDays, todayIn, weekStart } from '../lib/time'
import { me, renderApp, openItem } from '../test/fixtures'
import { server } from '../test/server'
import { OnDuty } from './OnDuty'

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

test('админ: неделя таблицей, добавить смену в ячейку, изменить и удалить', async () => {
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

  const table = await screen.findByRole('table', { name: 'График смен на неделю' })
  const aiperi = within(table).getByRole('row', { name: /Айпери/ })
  expect(within(aiperi).getByRole('button', { name: /09:00–15:00/ })).toBeInTheDocument()
  expect(within(table).getByText('Асель')).toBeInTheDocument()

  await user.click(within(table).getByRole('button', { name: `Добавить смену: Бермет, ${dayLong(tuesday)}` }))
  const form = await screen.findByRole('form', { name: 'Новая смена' })
  const start = within(form).getByLabelText('С')
  const end = within(form).getByLabelText('До')
  await user.clear(start)
  await user.type(start, '10:00')
  await user.clear(end)
  await user.type(end, '16:00')
  await user.click(within(form).getByRole('button', { name: 'Добавить смену' }))
  await vi.waitFor(() => expect(sent).toEqual([{ telegramId: 502, day: tuesday, startTime: '10:00', endTime: '16:00' }]))
  expect(screen.queryByRole('form', { name: 'Новая смена' })).not.toBeInTheDocument()

  await user.click(within(aiperi).getByRole('button', { name: /09:00–15:00/ }))
  const edit = await screen.findByRole('form', { name: 'Изменить смену' })
  await user.click(within(edit).getByRole('button', { name: 'Удалить' }))
  await vi.waitFor(() => expect(sent).toContain('delete 1'))
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
  const table = await screen.findByRole('table', { name: 'График смен на неделю' })
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

test('регистратура: график только для чтения, своя строка подсвечена', async () => {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json({ ...me, admin: false, reception: true, doctorId: undefined })),
    http.get('*/api/shifts', () => HttpResponse.json(schedule(false, 501))),
  )
  renderApp()

  const table = await screen.findByRole('table', { name: 'График смен на неделю' })
  expect(screen.getByText('График смен ведёт администратор клиники. Ваша строка подсвечена.')).toBeInTheDocument()
  const mine = within(table).getByRole('row', { name: /Айпери \(вы\)/ })
  expect(mine).toHaveAttribute('aria-current', 'true')
  expect(within(table).getByText('09:00–15:00')).toBeInTheDocument()
  expect(within(table).queryAllByRole('button')).toHaveLength(0)
  expect(screen.queryByRole('button', { name: /Повторить эту неделю/ })).not.toBeInTheDocument()
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

test('кнопка утренней сводки «Открыть график смен» (?screen=shifts) открывает пункт «Настроек»', () => {
  expect(readDeepLink('?screen=shifts')).toEqual({ page: 'settings', tab: 'shifts' })
})

test('одни врачи — график пуст: объяснение и кнопки «Часы работы врачей» и «Пригласить…»', async () => {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/shifts', () => HttpResponse.json({ people: [], shifts: [], canEdit: true, me: 111 } satisfies Schemas['ShiftControllerSchedule'])),
  )
  renderApp()
  expect(await screen.findByRole('heading', { name: 'В графике пока никого' })).toBeInTheDocument()
  expect(screen.getByText(/Врачи здесь не показываются/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Пригласить регистратуру или ассистента' })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Часы работы врачей' }))
  expect(window.location.hash).toBe('#/settings/hours')
})

test('«Рабочее время» — один пункт: вкладки «Врачи», «Смены персонала», «Перерывы и выходные»; старые адреса открывают свою вкладку', async () => {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/shifts', () => HttpResponse.json(schedule(true, 111))),
  )
  window.location.hash = '/settings'
  renderApp()
  expect(await screen.findByRole('button', { name: /Рабочее время/ })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /График смен/ })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: /Рабочее время/ }))
  expect(await screen.findByRole('tab', { name: 'Врачи' })).toHaveAttribute('aria-selected', 'true')
  // «Перерывы и выходные» — больше не отдельный пункт списка, а вкладка
  expect(screen.queryByRole('button', { name: /Перерывы и выходные/ })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('tab', { name: 'Смены персонала' }))
  expect(await screen.findByRole('table', { name: 'График смен на неделю' })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('tab', { name: 'Перерывы и выходные' }))
  expect(screen.getByRole('tab', { name: 'Перерывы и выходные' })).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByRole('heading', { name: 'Рабочее время' })).toBeInTheDocument()

  // Старые адреса — закладки и кнопки бота: #/settings/timeoff и #/settings/shifts
  openItem('timeoff')
  expect(await screen.findByRole('tab', { name: 'Перерывы и выходные' })).toHaveAttribute('aria-selected', 'true')
  openItem('shifts')
  expect(await screen.findByRole('tab', { name: 'Смены персонала' })).toHaveAttribute('aria-selected', 'true')
})
