import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { ask } from '../lib/confirm'
import { ConfirmHost } from './Confirm'

function Page({ question, onAnswer }: { question: string; onAnswer: (ok: boolean) => void }) {
  return <><ConfirmHost /><button type="button" onClick={() => void ask(question).then(onAnswer)}>Действие</button></>
}

test('своё окно вместо системного: вопрос, «Отмена» и кнопка по первому слову; Esc — отмена', async () => {
  const answers: boolean[] = []
  render(<Page question="Удалить запись насовсем?" onAnswer={(ok) => answers.push(ok)} />)
  const user = userEvent.setup()

  await user.click(screen.getByRole('button', { name: 'Действие' }))
  const dialog = screen.getByRole('alertdialog', { name: 'Подтверждение' })
  expect(dialog).toHaveTextContent('Удалить запись насовсем?')
  // Опасное действие — красная кнопка «Удалить», фокус на ней
  expect(within(dialog).getByRole('button', { name: 'Удалить' })).toHaveClass('danger')
  expect(within(dialog).getByRole('button', { name: 'Удалить' })).toHaveFocus()
  await user.click(within(dialog).getByRole('button', { name: 'Отмена' }))
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'Действие' }))
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'Действие' }))
  await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Удалить' }))
  expect(answers).toEqual([false, false, true])
})

test('«Отменить запись?» — вторая кнопка «Не отменять», а не «Отмена»', async () => {
  render(<Page question="Отменить запись Тест Т.? Время освободится." onAnswer={() => {}} />)
  await userEvent.click(screen.getByRole('button', { name: 'Действие' }))
  const dialog = screen.getByRole('alertdialog')
  expect(within(dialog).getByRole('button', { name: 'Отменить' })).toBeInTheDocument()
  expect(within(dialog).getByRole('button', { name: 'Не отменять' })).toBeInTheDocument()
  expect(within(dialog).queryByRole('button', { name: 'Отмена' })).toBeNull()
})

test('вопрос не с глагола — кнопка «Да», обычного цвета', async () => {
  render(<Page question="Это другой человек?" onAnswer={() => {}} />)
  await userEvent.click(screen.getByRole('button', { name: 'Действие' }))
  const ok = within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Да' })
  expect(ok).toHaveClass('primary')
})
