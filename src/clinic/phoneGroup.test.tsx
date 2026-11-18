import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'

import { choose } from '../test/select'
import { caretAfterDigits, groupLocal, joinPhone, phoneFromInput } from './phone'
import { PhoneInput } from './PhoneInput'

/**
 * Номер сам делится на группы, пока его печатают: «555 123 456». Группы — только в поле: наружу
 * (onChange, phoneFromInput) уходит номер без пробелов. Каретка не прыгает при правке в середине.
 */
function Form() {
  const [v, setV] = useState('')
  return (
    <>
      <PhoneInput label="Телефон" value={v} onChange={setV} />
      <output aria-label="Значение">{v}</output>
      <output aria-label="В запрос">{phoneFromInput(v)}</output>
    </>
  )
}

const field = () => screen.getByRole<HTMLInputElement>('textbox', { name: 'Телефон' })
const value = () => screen.getByLabelText('Значение').textContent
const sent = () => screen.getByLabelText('В запрос').textContent
const caret = () => field().selectionStart

test.each([
  ['KG', '555123456', '555 123 456'],
  ['KG', '0555123456', '0555 123 456'],
  ['KG', '996555123456', '996 555 123 456'],
  ['KG', '5551', '555 1'],
  ['KG', '555', '555'],
  ['KG', '996', '996'],
  ['KG', '0', '0'],
  ['KZ', '7011234567', '701 123 45 67'],
  ['RU', '9123456789', '912 345 67 89'],
  ['UZ', '901234567', '90 123 45 67'],
  ['TJ', '931234567', '93 123 45 67'],
  ['TR', '5321234567', '532 123 45 67'],
  // Правило страны неизвестно — по 3; цифры сверх групп страны — тоже по 3
  ['XX', '4930123456', '493 012 345 6'],
  ['KG', '5551234567890', '555 123 456 789 0'],
  ['KG', '', ''],
])('groupLocal(%s, %s) → «%s»', (country, local, expected) => {
  expect(groupLocal(country, local)).toBe(expected)
})

test('значение поля — без пробелов, место каретки — по счёту цифр', () => {
  expect(joinPhone('KG', '555 123 456')).toBe('555123456')
  expect(joinPhone('KZ', '701 123 45 67')).toBe('+77011234567')
  expect(joinPhone('XX', '49 30 123')).toBe('+4930123')
  expect(joinPhone('KG', ' ')).toBe('')
  expect(caretAfterDigits('555 123 456', 3)).toBe(3)
  expect(caretAfterDigits('555 123 456', 4)).toBe(5)
  expect(caretAfterDigits('555 123 456', 0)).toBe(0)
  expect(caretAfterDigits('555 123 456', 99)).toBe(11)
})

test('набор по одной цифре: группы появляются сами, наружу — без пробелов', async () => {
  render(<Form />)
  const steps = ['5', '55', '555', '555 1', '555 12', '555 123', '555 123 4', '555 123 45', '555 123 456']
  await userEvent.click(field())
  for (const [i, shown] of steps.entries()) {
    await userEvent.keyboard('555123456'[i]!)
    expect(field()).toHaveValue(shown)
    expect(caret()).toBe(shown.length)
  }
  expect(value()).toBe('555123456')
  expect(sent()).toBe('+996555123456')
})

test('Backspace прямо за пробелом стирает цифру перед ним, а не пробел; каретка остаётся на месте', async () => {
  render(<Form />)
  await userEvent.type(field(), '555123456')
  // Каретка после пробела: «555 |123 456»
  field().setSelectionRange(4, 4)
  await userEvent.keyboard('{Backspace}')
  expect(field()).toHaveValue('551 234 56')
  expect(value()).toBe('55123456')
  expect(caret()).toBe(2)
})

test('Backspace в конце стирает последнюю цифру и лишний пробел', async () => {
  render(<Form />)
  await userEvent.type(field(), '5551')
  expect(field()).toHaveValue('555 1')
  await userEvent.keyboard('{Backspace}')
  expect(field()).toHaveValue('555')
  expect(value()).toBe('555')
})

test('Backspace в середине группы — каретка не уезжает в конец', async () => {
  render(<Form />)
  await userEvent.type(field(), '555123456')
  // «555 12|3 456» → «555 13|4 56»
  field().setSelectionRange(6, 6)
  await userEvent.keyboard('{Backspace}')
  expect(field()).toHaveValue('555 134 56')
  expect(caret()).toBe(5)
})

test('Delete прямо перед пробелом стирает цифру после него', async () => {
  render(<Form />)
  await userEvent.type(field(), '555123456')
  // «555| 123 456»
  field().setSelectionRange(3, 3)
  await userEvent.keyboard('{Delete}')
  expect(field()).toHaveValue('555 234 56')
  expect(caret()).toBe(3)
})

test('цифра в середину: группы сдвигаются, каретка — сразу за новой цифрой', async () => {
  render(<Form />)
  await userEvent.type(field(), '55512345')
  // «555| 123 45» → «555 7|12 345»
  field().setSelectionRange(3, 3)
  await userEvent.keyboard('7')
  expect(field()).toHaveValue('555 712 345')
  expect(value()).toBe('555712345')
  expect(caret()).toBe(5)
  // «5|55 712 345» → «50|5 571 234 5» — дописали ещё одну
  field().setSelectionRange(1, 1)
  await userEvent.keyboard('0')
  expect(field()).toHaveValue('505 571 234 5')
  expect(caret()).toBe(2)
})

test('выделили часть и набрали цифру — она встаёт вместо выделенного', async () => {
  render(<Form />)
  await userEvent.type(field(), '555123456')
  // выделено «123»
  field().setSelectionRange(4, 7)
  await userEvent.keyboard('9')
  expect(field()).toHaveValue('555 945 6')
  expect(caret()).toBe(5)
})

test('Казахстан: группы 3-3-2-2, наружу «+7…» без пробелов', async () => {
  render(<Form />)
  await choose(screen.getByRole('combobox', { name: 'Код страны' }), 'Казахстан')
  await userEvent.type(field(), '7011234567')
  expect(field()).toHaveValue('701 123 45 67')
  expect(sent()).toBe('+77011234567')
})

test('вставка в середину уже набранного номера заменяет поле целиком', async () => {
  render(<Form />)
  await userEvent.type(field(), '555 1')
  field().setSelectionRange(2, 2)
  await userEvent.paste('+996 700-12-34-56')
  expect(field()).toHaveValue('700 123 456')
  expect(caret()).toBe(11)
})

test('на телефоне — цифровая клавиатура', () => {
  render(<Form />)
  expect(field()).toHaveAttribute('inputmode', 'tel')
  expect(field()).toHaveAttribute('type', 'tel')
})
