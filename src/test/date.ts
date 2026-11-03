import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']

/**
 * Выбрать дату в нашем календаре (layout/DateInput.tsx) — вместо userEvent.type в поле даты:
 * открыть поле → выбор года (страница лет, стрелками) → месяц → день. Дата рождения открывается
 * сразу на выборе года, обычная дата — на днях: тогда сначала заголовок месяца, затем год.
 */
export async function pickDate(field: HTMLElement, date: string) {
  const [y, m] = date.split('-').map(Number) as [number, number]
  await userEvent.click(field)
  const dialog = await screen.findByRole('dialog')
  const toMonths = within(dialog).queryByRole('button', { name: /Выбрать месяц и год/ })
  if (toMonths) await userEvent.click(toMonths)
  const toYears = within(dialog).queryByRole('button', { name: /— Выбрать год/ })
  if (toYears) await userEvent.click(toYears)
  const range = () => (within(dialog).getByText(/^\d{4}–\d{4}$/).textContent ?? '').split('–').map(Number) as [number, number]
  while (range()[0] > y) await userEvent.click(within(dialog).getByRole('button', { name: 'Раньше' }))
  while (range()[1] < y) await userEvent.click(within(dialog).getByRole('button', { name: 'Позже' }))
  await userEvent.click(within(dialog).getByRole('button', { name: String(y) }))
  await userEvent.click(within(dialog).getByRole('button', { name: new RegExp(`^${MONTHS[m - 1]}`, 'i') }))
  const day = dialog.querySelector<HTMLButtonElement>(`[data-date="${date}"]`)
  if (!day) throw new Error(`Нет дня ${date} в календаре`)
  await userEvent.click(day)
}
