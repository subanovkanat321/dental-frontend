/// <reference types="node" />
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { addDays, todayIn } from '../lib/time'
import { me, openItem, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { datesText, groupOf, rowsOf, timeOffWhen, titleFor, toRanges, weekdaysText, BREAK_KINDS } from './timeOffTexts'

type TimeOff = Schemas['TimeOffView']
type Body = Schemas['TimeOffControllerRequest']

afterEach(() => {
  window.location.hash = ''
})

/** Фальшивый бэкенд перерывов: список в памяти, каждый POST — в posted. */
function backend(initial: TimeOff[] = [], who: Schemas['BookingViewsMe'] = me) {
  const state = { list: [...initial], posted: [] as Body[], deleted: [] as string[] }
  let next = 100
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(who)),
    http.get('*/api/doctors/admin', () => HttpResponse.json([])),
    http.get('*/api/time-off', () => HttpResponse.json(state.list)),
    http.post('*/api/time-off', async ({ request }) => {
      const body = (await request.json()) as Body
      state.posted.push(body)
      const t: TimeOff = { id: next++, ...body }
      state.list = [...state.list, t]
      return HttpResponse.json(t, { status: 201 })
    }),
    http.delete('*/api/time-off/:id', ({ params }) => {
      state.deleted.push(String(params.id))
      state.list = state.list.filter((t) => String(t.id) !== params.id)
      return new HttpResponse(null, { status: 204 })
    }),
  )
  return state
}

/** Строки списка — текстом целиком: время и название в строке — отдельные куски (переносы на телефоне). */
const lines = (list: HTMLElement) => within(list).queryAllByRole('listitem').map((li) => li.querySelector('.timeoff-text > span')?.textContent)

async function openTab() {
  const user = userEvent.setup()
  renderApp()
  openItem('timeoff')
  await screen.findByRole('heading', { name: 'Перерывы' })
  return user
}

test('подписи: когда, дни недели, даты, периоды, название по умолчанию, группа', () => {
  expect(timeOffWhen({ weekday: 'FRIDAY', startTime: '12:00:00', endTime: '14:00:00' })).toBe('Каждую пятницу, 12:00–14:00')
  expect(timeOffWhen({ weekday: 'FRIDAY' })).toBe('Каждую пятницу, весь день')
  expect(timeOffWhen({ firstDay: '2026-11-12', lastDay: '2026-11-20' })).toBe('12–20 ноября')
  expect(datesText('2026-10-28', '2026-11-03')).toBe('28 октября – 3 ноября')
  expect(datesText('2026-03-21', '2026-03-21')).toBe('21 марта')
  expect(weekdaysText(['FRIDAY', 'MONDAY', 'WEDNESDAY'])).toBe('Пн, ср, пт')
  expect(weekdaysText(['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'])).toBe('По будням')
  expect(toRanges(['2026-03-23', '2026-03-21', '2026-03-22', '2026-05-01'])).toEqual([['2026-03-21', '2026-03-23'], ['2026-05-01', '2026-05-01']])
  expect(titleFor(BREAK_KINDS[0]!, '  ', 'Перерыв')).toBe('Обед')
  expect(titleFor(BREAK_KINDS[3]!, '', 'Перерыв')).toBe('Перерыв')
  expect(groupOf({ weekday: 'FRIDAY', startTime: '12:00:00', endTime: '13:00:00' })).toBe('break')
  expect(groupOf({ weekday: 'SUNDAY' })).toBe('dayOff')
  expect(groupOf({ firstDay: '2026-03-21', lastDay: '2026-03-21', emoji: '🎉' })).toBe('dayOff')
  expect(groupOf({ firstDay: '2026-11-12', lastDay: '2026-11-20', emoji: '🏖️' })).toBe('leave')
  // Обед пн и вт — одна строка; у другого врача — своя
  const rows = rowsOf([
    { id: 1, weekday: 'TUESDAY', startTime: '13:00:00', endTime: '14:00:00', title: 'Обед', emoji: '🍽️', doctorId: 1 },
    { id: 2, weekday: 'MONDAY', startTime: '13:00:00', endTime: '14:00:00', title: 'Обед', emoji: '🍽️', doctorId: 1 },
    { id: 3, weekday: 'MONDAY', startTime: '13:00:00', endTime: '14:00:00', title: 'Обед', emoji: '🍽️', doctorId: 2 },
  ])
  expect(rows.map((r) => [r.ids, r.when])).toEqual([[[2, 1], 'Пн, вт, 13:00–14:00'], [[3], 'Каждый понедельник, 13:00–14:00']])
})

test('«＋ Перерыв»: тип чипом, несколько дней — по записи на день, название не набирать', async () => {
  const state = backend()
  const user = await openTab()
  await user.click(screen.getByRole('button', { name: '＋ Перерыв' }))
  const form = screen.getByRole('form', { name: 'Новый перерыв' })
  // Время не спрашиваем только у выходных: здесь оно есть, «Весь день» больше нет
  expect(within(form).queryByRole('checkbox')).not.toBeInTheDocument()
  await user.click(within(form).getByRole('button', { name: /Намаз/ }))
  // По умолчанию пн–пт; оставим пятницу
  for (const day of ['Понедельник', 'Вторник', 'Среда', 'Четверг']) await user.click(within(form).getByRole('button', { name: day }))
  await user.click(within(form).getByRole('button', { name: 'Суббота' }))
  await user.click(within(form).getByRole('button', { name: 'Добавить перерыв' }))
  expect(await screen.findByText('Перерыв добавлен на 2 дн.')).toBeInTheDocument()
  expect(state.posted).toEqual([
    { doctorId: 1, weekday: 'FRIDAY', startTime: '13:00', endTime: '14:00', title: 'Намаз', emoji: '🕌' },
    { doctorId: 1, weekday: 'SATURDAY', startTime: '13:00', endTime: '14:00', title: 'Намаз', emoji: '🕌' },
  ])
  // Форма закрылась, в «Перерывах» — одна строка на оба дня
  expect(screen.queryByRole('form', { name: 'Новый перерыв' })).not.toBeInTheDocument()
  const list = await screen.findByRole('list', { name: 'Перерывы' })
  await vi.waitFor(() => expect(lines(list)).toEqual(['Пт, сб, 13:00–14:00 — 🕌 Намаз']))
})

test('«＋ Перерыв»: «Другое» без названия — «Перерыв»; без дней — подсказка, запроса нет', async () => {
  const state = backend()
  const user = await openTab()
  await user.click(screen.getByRole('button', { name: '＋ Перерыв' }))
  const form = screen.getByRole('form', { name: 'Новый перерыв' })
  for (const day of ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница']) await user.click(within(form).getByRole('button', { name: day }))
  await user.click(within(form).getByRole('button', { name: 'Добавить перерыв' }))
  expect(within(form).getByRole('alert')).toHaveTextContent('Выберите хотя бы один день')
  expect(state.posted).toEqual([])

  await user.click(within(form).getByRole('button', { name: /Другое/ }))
  await user.click(within(form).getByRole('button', { name: 'Среда' }))
  await user.click(within(form).getByRole('button', { name: 'Добавить перерыв' }))
  expect(await screen.findByText('Перерыв добавлен')).toBeInTheDocument()
  expect(state.posted).toEqual([{ doctorId: 1, weekday: 'WEDNESDAY', startTime: '13:00', endTime: '14:00', title: 'Перерыв', emoji: '⏸️' }])
})

test('«＋ Выходной день»: каждое воскресенье — весь день, без времени, название «Выходной»', async () => {
  const state = backend()
  const user = await openTab()
  await user.click(screen.getByRole('button', { name: '＋ Выходной день' }))
  const form = screen.getByRole('form', { name: 'Новый выходной день' })
  expect(within(form).queryByLabelText('С')).not.toBeInTheDocument()
  await user.click(within(form).getByRole('button', { name: 'Добавить выходной' }))
  expect(await screen.findByText('Выходной добавлен')).toBeInTheDocument()
  expect(state.posted).toEqual([{ doctorId: 1, weekday: 'SUNDAY', title: 'Выходной', emoji: '⏸️' }])
  const list = await screen.findByRole('list', { name: 'Выходные дни' })
  expect(lines(list)).toEqual(['Каждое воскресенье, весь день — ⏸️ Выходной'])
})

test('«＋ Выходной день»: такой уже есть — ответ сервера «Уже есть…», второй строки нет', async () => {
  const state = backend()
  server.use(http.post('*/api/time-off', () => HttpResponse.json(
    { detail: 'Уже есть: «⏸️ Выходной» — в это время. Второй раз добавлять не нужно', code: 'duplicate-time-off' }, { status: 409 })))
  const user = await openTab()
  await user.click(screen.getByRole('button', { name: '＋ Выходной день' }))
  const form = screen.getByRole('form', { name: 'Новый выходной день' })
  await user.click(within(form).getByRole('button', { name: 'Добавить выходной' }))
  expect(await within(form).findByText(/Уже есть: «⏸️ Выходной»/)).toBeInTheDocument()
  expect(state.list).toEqual([])
})

test('«＋ Выходной день» → «Одна дата / праздник»: две даты подряд — один период «Нооруз»', async () => {
  const state = backend()
  const user = await openTab()
  await user.click(screen.getByRole('button', { name: '＋ Выходной день' }))
  const form = screen.getByRole('form', { name: 'Новый выходной день' })
  await user.click(within(form).getByRole('button', { name: 'Одна дата / праздник' }))
  // Праздник — сразу значок 🎉
  expect(within(form).getByRole('button', { name: /Праздник/ })).toHaveAttribute('aria-pressed', 'true')
  await user.click(within(form).getByRole('button', { name: '＋ Ещё дата' }))
  await user.type(within(form).getByRole('textbox', { name: 'Название — можно не менять' }), 'Нооруз')
  await user.click(within(form).getByRole('button', { name: 'Добавить выходной' }))
  expect(await screen.findByText('Выходной добавлен')).toBeInTheDocument()
  const today = todayIn()
  expect(state.posted).toEqual([{ doctorId: 1, firstDay: today, lastDay: addDays(today, 1), title: 'Нооруз', emoji: '🎉' }])
  const list = await screen.findByRole('list', { name: 'Выходные дни' })
  expect(within(list).getByText('🎉 Нооруз')).toBeInTheDocument()
})

test('«＋ Отпуск / больничный»: период дат, тип чипом = название, без времени', async () => {
  const state = backend()
  const user = await openTab()
  await user.click(screen.getByRole('button', { name: '＋ Отпуск / больничный' }))
  const form = screen.getByRole('form', { name: 'Отпуск или больничный' })
  await user.click(within(form).getByRole('button', { name: /Больничный/ }))
  await user.click(within(form).getByRole('button', { name: 'Добавить' }))
  expect(await screen.findByText('Больничный — добавлено')).toBeInTheDocument()
  expect(state.posted).toEqual([{ doctorId: 1, firstDay: todayIn(), lastDay: todayIn(), title: 'Больничный', emoji: '🤒' }])
  const list = await screen.findByRole('list', { name: 'Отпуска и больничные' })
  expect(within(list).getByText('🤒 Больничный')).toBeInTheDocument()
})

test('списки по группам; строка из нескольких дней удаляется целиком', async () => {
  const state = backend([
    { id: 1, weekday: 'FRIDAY', startTime: '12:00:00', endTime: '14:00:00', title: 'Джума-намаз', emoji: '🕌' },
    { id: 2, doctorId: 1, weekday: 'MONDAY', startTime: '13:00:00', endTime: '14:00:00', title: 'Обед', emoji: '🍽️' },
    { id: 3, doctorId: 1, weekday: 'TUESDAY', startTime: '13:00:00', endTime: '14:00:00', title: 'Обед', emoji: '🍽️' },
    { id: 4, doctorId: 2, weekday: 'FRIDAY', title: 'Выходной', emoji: '⏸️' },
    { id: 5, doctorId: 1, firstDay: '2026-11-12', lastDay: '2026-11-20', title: 'Отпуск', emoji: '🏖️' },
  ])
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  const user = await openTab()
  const breaks = await screen.findByRole('list', { name: 'Перерывы' })
  expect(within(breaks).getAllByRole('listitem')).toHaveLength(2)
  expect(within(breaks).getByText('Все врачи')).toBeInTheDocument()
  expect(lines(breaks)).toEqual(['Каждую пятницу, 12:00–14:00 — 🕌 Джума-намаз', 'Пн, вт, 13:00–14:00 — 🍽️ Обед'])
  expect(lines(screen.getByRole('list', { name: 'Выходные дни' }))).toEqual(['Каждую пятницу, весь день — ⏸️ Выходной'])
  expect(lines(screen.getByRole('list', { name: 'Отпуска и больничные' }))).toEqual(['12–20 ноября — 🏖️ Отпуск'])

  await user.click(within(breaks).getByRole('button', { name: 'Удалить: Обед' }))
  await vi.waitFor(() => expect(state.deleted).toEqual(['2', '3']))
  await vi.waitFor(() => expect(screen.queryByText('🍽️ Обед')).not.toBeInTheDocument())
})

test('ассистент: перерывы и выходные только смотрит — без кнопок и «Удалить»', async () => {
  backend([{ id: 1, doctorId: 2, weekday: 'FRIDAY', startTime: '12:00:00', endTime: '14:00:00', title: 'Джума-намаз', emoji: '🕌' }],
    { ...me, admin: false, doctorId: undefined, assistantOf: [2] })
  await openTab()
  expect(await screen.findByText(/Джума-намаз/)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '＋ Перерыв' })).not.toBeInTheDocument()
  expect(screen.getByText(/ставят врач, регистратура или руководитель/)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Удалить/ })).not.toBeInTheDocument()
})

test('телефон 390px: поля «С/До» не шире колонки, кнопки-действия в столбик', () => {
  const styles = readFileSync('src/styles.css', 'utf8')
  const timeoffCss = readFileSync('src/team/timeoff.css', 'utf8')
  // jsdom не считает раскладку — проверяем правила, из-за которых «До» вылезало за карточку
  expect(styles).toMatch(/\.row \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/)
  expect(styles).toMatch(/\.field \{ display: grid; grid-template-columns: minmax\(0, 1fr\)/)
  expect(styles).toMatch(/\.field input \{ min-width: 0; max-width: 100%; \}/)
  expect(timeoffCss).toMatch(/@media \(max-width: 640px\) \{\s*\.timeoff-actions \.btn \{ flex: 1 1 100%; \}/)
})
