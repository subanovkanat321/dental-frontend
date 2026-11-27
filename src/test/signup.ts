import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/** /start: шаг 1 «Найдите свою клинику» → «Моей клиники нет — заполнить вручную» → форма регистрации. */
export async function manualForm(): Promise<HTMLElement> {
  await userEvent.click(await screen.findByRole('button', { name: 'Моей клиники нет — заполнить вручную' }))
  return screen.findByRole('form', { name: 'Регистрация клиники' })
}
