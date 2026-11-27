import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** «⋯» этапа плана (StepMenu): «Действия с этапом: 36 · Удаление зуба» — номер зуба не важен, ищем по услуге. */
export function stepMenuName(title: string): RegExp {
  return new RegExp(`^Действия с этапом: (\\d+ · )?${esc(title)}$`)
}

/**
 * Открыть «⋯» этапа и вернуть пункт меню по началу подписи («Изменить», «Врач», «Выше», «Удалить этап»): у пунктов
 * под подписью мелкая подсказка, она входит в имя. nth — какой из этапов с такой услугой.
 */
export async function stepMenuItem(scope: HTMLElement, title: string, item: string, nth = 0): Promise<HTMLElement> {
  const button = within(scope).getAllByRole('button', { name: stepMenuName(title) })[nth]
  if (!button) throw new Error(`Нет «⋯» у этапа «${title}»`)
  await userEvent.click(button)
  return screen.getByRole('menuitem', { name: new RegExp(`^${esc(item)}`) })
}
