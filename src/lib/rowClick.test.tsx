import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { rowOpen } from './rowClick'

function List({ open, other, readOnly = false }: { open: () => void; other: () => void; readOnly?: boolean }) {
  return (
    <ul>
      <li {...rowOpen(!readOnly && open, 'item')}>
        <button type="button" className="row-link" onClick={open}>Адгезив</button>
        <span>2 шт</span>
        <a href="#x" onClick={(e) => { e.preventDefault(); other() }}>ссылка</a>
        <input aria-label="Поле" />
        <span data-row-skip>своё</span>
      </li>
    </ul>
  )
}

test('строка открывает по клику в любом месте; кнопка, ссылка, поле и data-row-skip — нет', async () => {
  const open = vi.fn()
  const other = vi.fn()
  render(<List open={open} other={other} />)
  const row = screen.getByRole('listitem')
  expect(row).toHaveClass('clickable', 'item')
  expect(row).not.toHaveAttribute('tabindex')

  await userEvent.click(screen.getByText('2 шт'))
  expect(open).toHaveBeenCalledTimes(1)
  // Само название — одно открытие, а не два (кнопка и строка)
  await userEvent.click(screen.getByRole('button', { name: 'Адгезив' }))
  expect(open).toHaveBeenCalledTimes(2)
  await userEvent.click(screen.getByRole('link', { name: 'ссылка' }))
  await userEvent.click(screen.getByLabelText('Поле'))
  await userEvent.click(screen.getByText('своё'))
  expect(open).toHaveBeenCalledTimes(2)
  expect(other).toHaveBeenCalledTimes(1)

  // Выделили текст мышью — не открываем
  window.getSelection()!.selectAllChildren(screen.getByText('2 шт'))
  fireEvent.click(screen.getByText('2 шт'))
  expect(open).toHaveBeenCalledTimes(2)
  window.getSelection()!.removeAllRanges()
})

test('без права открыть — обычная строка, только свои классы', async () => {
  const open = vi.fn()
  render(<List open={open} other={vi.fn()} readOnly />)
  const row = screen.getByRole('listitem')
  expect(row).toHaveClass('item')
  expect(row).not.toHaveClass('clickable')
  await userEvent.click(screen.getByText('2 шт'))
  expect(open).not.toHaveBeenCalled()
})
