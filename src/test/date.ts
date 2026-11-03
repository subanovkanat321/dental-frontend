import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']

/**
 * Выбрать дату в нашем календаре (layout/DateInput.tsx) — вместо userEvent.type в поле даты:
 * открыть поле, заголовок месяца → год стрелками → месяц → день.
 */
export async function pickDate(field: HTMLElement, date: string) {
  const [y, m] = date.split('-').map(Number) as [number, number]
  await userEvent.click(field)
  const dialog = await screen.findByRole('dialog')
  await userEvent.click(within(dialog).getByRole('button', { name: /Выбрать месяц и год/ }))
  const year = () => Number(within(dialog).getByText(/^\d{4}$/).textContent)
  while (year() < y) await userEvent.click(within(dialog).getByRole('button', { name: 'Следующий год' }))
  while (year() > y) await userEvent.click(within(dialog).getByRole('button', { name: 'Предыдущий год' }))
  await userEvent.click(within(dialog).getByRole('button', { name: new RegExp(`^${MONTHS[m - 1]}`, 'i') }))
  const day = dialog.querySelector<HTMLButtonElement>(`[data-date="${date}"]`)
  if (!day) throw new Error(`Нет дня ${date} в календаре`)
  await userEvent.click(day)
}
