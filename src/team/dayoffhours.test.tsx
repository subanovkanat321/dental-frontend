import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, openItem, renderApp } from '../test/fixtures'
import { choose } from '../test/select'
import { server } from '../test/server'
import type { Weekday } from './texts'

type TimeOff = Schemas['TimeOffView']

afterEach(() => {
  window.location.hash = ''
})

const WEEKDAYS: Weekday[] = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY']
const hoursOf = (days: Weekday[]): Schemas['DoctorHoursView'] => ({ custom: true, days: days.map((weekday) => ({ weekday, start: '09:00:00', end: '18:00:00' })) })

/** Фальшивый бэкенд: выходные, часы врачей (у Айгерим — пн–пт), часы клиники (пн–сб); все запросы записываем. */
function backend(timeOff: TimeOff[], hours: Partial<Record<number, Schemas['DoctorHoursView']>> = {}) {
  const state = { list: [...timeOff], deleted: [] as string[], posted: [] as unknown[], hours: [] as unknown[] }
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/doctors/admin', () => HttpResponse.json([])),
    http.get('*/api/clinic', () => HttpResponse.json({ workStart: '09:00:00', workEnd: '18:00:00', workDays: [...WEEKDAYS, 'SATURDAY'] } satisfies Schemas['ClinicView'])),
    http.get('*/api/time-off', () => HttpResponse.json(state.list)),
    http.post('*/api/time-off', async ({ request }) => {
      state.posted.push(await request.json())
      return HttpResponse.json({ id: 99 } satisfies TimeOff, { status: 201 })
    }),
    http.delete('*/api/time-off/:id', ({ params }) => {
      state.deleted.push(String(params.id))
      state.list = state.list.filter((t) => String(t.id) !== params.id)
      return new HttpResponse(null, { status: 204 })
    }),
    http.get('*/api/doctors/:id/hours', ({ params }) => HttpResponse.json(hours[Number(params.id)] ?? hoursOf(WEEKDAYS))),
    http.put('*/api/doctors/:id/hours', async ({ request }) => {
      const body = (await request.json()) as Schemas['DoctorHoursControllerRequest']
      state.hours.push(body)
      return HttpResponse.json({ custom: true, days: body.days } satisfies Schemas['DoctorHoursView'])
    }),
  )
  return state
}

/** «Рабочее время → Врачи»: открыты часы «моего» врача (Айгерим). */
async function openHours() {
  const user = userEvent.setup()
  renderApp()
  openItem('hours')
  const hours = await screen.findByRole('group', { name: 'Часы работы' })
  return { user, hours }
}

const fridayOff: TimeOff = { id: 7, doctorId: 1, weekday: 'FRIDAY', title: 'Выходной', emoji: '⏸️' }

test('часы врача: день с еженедельным выходным — нерабочий, подпись откуда; галочка → «Отмена» — ничего', async () => {
  const state = backend([fridayOff])
  const { user, hours } = await openHours()
  const friday = await within(hours).findByRole('checkbox', { name: 'Пятница' })
  await vi.waitFor(() => expect(friday).not.toBeChecked())
  expect(within(hours).getByRole('checkbox', { name: 'Четверг' })).toBeChecked()
  expect(within(hours).getByText('⏸️ Выходной — из «Перерывы и выходные»')).toBeInTheDocument()
  // Вместо часов — подпись: полей времени у пятницы нет
  expect(within(hours).queryByLabelText('Пятница: с')).not.toBeInTheDocument()

  await user.click(friday)
  const dialog = await screen.findByRole('alertdialog')
  expect(dialog).toHaveTextContent('В пятницу у Айгерим Садыкова стоит выходной «⏸️ Выходной». Сделать пятницу рабочей? Выходной удалится.')
  await user.click(within(dialog).getByRole('button', { name: 'Отмена' }))
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  expect(friday).not.toBeChecked()
  expect(state.deleted).toEqual([])
  expect(state.hours).toEqual([])
})

test('часы врача: галочка на день с выходным → «Сделать рабочей» — выходной удалён, часы сохранены с пятницей', async () => {
  const state = backend([fridayOff, { id: 8, doctorId: 2, weekday: 'MONDAY', title: 'Выходной', emoji: '⏸️' }])
  const { user, hours } = await openHours()
  const friday = await within(hours).findByRole('checkbox', { name: 'Пятница' })
  await vi.waitFor(() => expect(friday).not.toBeChecked())
  // Выходной другого врача на часы Айгерим не влияет
  expect(within(hours).getByRole('checkbox', { name: 'Понедельник' })).toBeChecked()

  await user.click(friday)
  await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Сделать рабочей' }))
  expect(await within(hours).findByText('Часы работы сохранены')).toBeInTheDocument()
  expect(state.deleted).toEqual(['7'])
  expect(state.hours).toEqual([{ days: WEEKDAYS.map((weekday) => ({ weekday, start: '09:00', end: '18:00' })) }])
  await vi.waitFor(() => expect(friday).toBeChecked())
  expect(within(hours).queryByText(/из «Перерывы и выходные»/)).not.toBeInTheDocument()
})

test('часы врача: выходной всей клиники — объяснение и переход в «Перерывы и выходные», без удаления', async () => {
  const state = backend([{ id: 9, weekday: 'SATURDAY', title: 'Выходной', emoji: '⏸️' }], { 1: hoursOf([...WEEKDAYS, 'SATURDAY']) })
  const { user, hours } = await openHours()
  const saturday = await within(hours).findByRole('checkbox', { name: 'Суббота' })
  await vi.waitFor(() => expect(saturday).not.toBeChecked())
  expect(within(hours).getByText('⏸️ Выходной — из «Перерывы и выходные» (вся клиника)')).toBeInTheDocument()
  // В часах клиники суббота тоже нерабочая — серым, с подписью
  const clinic = screen.getByRole('group', { name: 'Рабочие дни клиники' })
  expect(within(clinic).getByRole('button', { name: 'Суббота' })).toHaveAttribute('aria-pressed', 'false')
  expect(within(clinic).getByRole('button', { name: 'Пятница' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByText('В субботу: ⏸️ Выходной — из «Перерывы и выходные»')).toBeInTheDocument()

  await user.click(saturday)
  const dialog = await screen.findByRole('alertdialog')
  expect(dialog).toHaveTextContent('В субботу выходной у всей клиники — уберите его в «Перерывы и выходные» (это затронет всех врачей)')
  await user.click(within(dialog).getByRole('button', { name: 'Открыть «Перерывы и выходные»' }))
  expect(await screen.findByRole('heading', { name: 'Выходные дни' })).toBeInTheDocument()
  expect(state.deleted).toEqual([])
  expect(state.hours).toEqual([])
})

test('«＋ Выходной день → Каждую неделю» на нерабочий по часам день — подсказка, без запроса; рабочий — сохраняем, нерабочий пропускаем', async () => {
  const state = backend([])
  const user = userEvent.setup()
  renderApp()
  openItem('timeoff')
  await user.click(await screen.findByRole('button', { name: '＋ Выходной день' }))
  const form = screen.getByRole('form', { name: 'Новый выходной день' })
  // По умолчанию воскресенье, а Айгерим работает пн–пт
  expect(await within(form).findByText('В воскресенье Айгерим Садыкова и так не работает (часы работы)')).toBeInTheDocument()
  expect(within(form).getByRole('button', { name: 'Добавить выходной' })).toBeDisabled()

  // «Все врачи» — по часам клиники (пн–сб)
  await choose(within(form).getByRole('combobox', { name: 'Для кого' }), 'Все врачи')
  expect(await within(form).findByText('В воскресенье клиника и так не работает (часы клиники)')).toBeInTheDocument()
  await choose(within(form).getByRole('combobox', { name: 'Для кого' }), 'Айгерим Садыкова')

  await user.click(within(form).getByRole('button', { name: 'Пятница' }))
  expect(await within(form).findByText('В воскресенье Айгерим Садыкова и так не работает (часы работы) — этот день пропустим')).toBeInTheDocument()
  await user.click(within(form).getByRole('button', { name: 'Добавить выходной' }))
  expect(await screen.findByText('Выходной добавлен')).toBeInTheDocument()
  expect(state.posted).toEqual([{ doctorId: 1, weekday: 'FRIDAY', title: 'Выходной', emoji: '⏸️' }])
})

test('«Выходные дни»: еженедельный выходной на рабочий день — «вместо рабочих часов 09:00–18:00»', async () => {
  backend([fridayOff, { id: 10, doctorId: 1, weekday: 'SUNDAY', title: 'Отдых', emoji: '⏸️' }])
  renderApp()
  openItem('timeoff')
  const list = await screen.findByRole('list', { name: 'Выходные дни' })
  const [friday, sunday] = within(list).getAllByRole('listitem')
  // Время — неразрывным куском (на телефоне не переносится внутри «09:00–18:00»)
  expect(await within(friday!).findByText((_, el) => el?.textContent === 'вместо рабочих часов 09:00–18:00' && el.classList.contains('hint'))).toBeInTheDocument()
  expect(within(friday!).getByText('09:00–18:00')).toHaveClass('nowrap')
  // Воскресенье и так нерабочее — подписи нет
  expect(within(sunday!).queryByText(/вместо рабочих часов/)).not.toBeInTheDocument()
})
