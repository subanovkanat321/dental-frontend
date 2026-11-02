import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/**
 * Выбрать пункт в нашем выпадающем списке (layout/Select.tsx) — вместо userEvent.selectOptions:
 * открыть поле и нажать пункт по тексту или по значению (как у selectOptions).
 */
export async function choose(field: HTMLElement, option: string) {
  await userEvent.click(field)
  const list = await screen.findByRole('listbox')
  const items = within(list).getAllByRole('option')
  const item = items.find((o) => o.textContent?.replace(/✓$/, '').trim() === option.trim()
    || o.dataset.value === option
    || o.textContent?.replace(/✓$/, '').replace(/·/g, ' · ').replace(/\s+/g, ' ').includes(option))
  if (!item) throw new Error(`Нет пункта «${option}» среди: ${items.map((o) => o.textContent).join(' | ')}`)
  await userEvent.click(item)
}

/** Текст выбранного пункта в поле. */
export function chosen(field: HTMLElement): string {
  return field.textContent ?? ''
}
