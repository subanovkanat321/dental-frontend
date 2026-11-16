import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'

import { phoneFromInput, phoneFromText } from './phone'
import { PhoneInput } from './PhoneInput'

/**
 * Один разбор номера на все пути (кнопка «Вставить номер», вставка в поле, контакт из бота, Contact
 * Picker): кыргызский — 9 цифр без 0 и 996 (+996 в поле уже стоит), другая страна — «+код цифры».
 */
test.each([
  ['0773123456', '773123456'],
  ['+996 773 12-34-56', '773123456'],
  ['996773123456', '773123456'],
  ['773123456', '773123456'],
  ['+996 555 12-34-56', '555123456'],
  ['(555) 123 456', '555123456'],
  ['0555 12 34 56', '555123456'],
  ['00996 555 123 456', '555123456'],
  ['‪+996 555 123 456‬', '555123456'],
  ['Айгуль Маратовна\n+996 (555) 12-34-56', '555123456'],
  ['тел.: 0555-123-456, звонить вечером', '555123456'],
  ['+7 701 123 45 67', '+77011234567'],
  ['+998 90 123 45 67', '+998901234567'],
])('%s → %s', (text, expected) => {
  expect(phoneFromText(text)).toBe(expected)
})

test('нет номера — null: мало цифр или их нет совсем', () => {
  expect(phoneFromText('Айгуль')).toBeNull()
  expect(phoneFromText('12 34 56')).toBeNull()
  expect(phoneFromText('')).toBeNull()
})

function Form({ mask = false }: { mask?: boolean }) {
  const [v, setV] = useState('')
  return (
    <>
      <PhoneInput label="Телефон" value={v} onChange={setV} mask={mask} />
      <output aria-label="В запрос">{phoneFromInput(v)}</output>
    </>
  )
}

const field = () => screen.getByRole('textbox', { name: 'Телефон' })
const sent = () => screen.getByLabelText('В запрос').textContent

test.each([
  ['0773123456', '773123456'],
  ['+996 773 12-34-56', '773123456'],
  ['996773123456', '773123456'],
  ['773123456', '773123456'],
  ['Айгуль +996 (555) 12-34-56', '555123456'],
])('вставка «%s» в поле телефона — «%s», код +996 уже стоит', async (text, expected) => {
  render(<Form />)
  await userEvent.click(field())
  await userEvent.paste(text)
  expect(field()).toHaveValue(expected)
  expect(sent()).toBe(`+996 ${expected}`)
})

test('вставка заменяет то, что уже было в поле, а не дописывается к нему', async () => {
  render(<Form />)
  await userEvent.type(field(), '555')
  await userEvent.paste('0773123456')
  expect(field()).toHaveValue('773123456')
})

test('самозапись на сайте (поле с маской): вставили «0773123456» — «773 123 456»', async () => {
  render(<Form mask />)
  await userEvent.click(field())
  await userEvent.paste('0773123456')
  expect(field()).toHaveValue('773 123 456')
  expect(sent()).toBe('+996 773 123 456')
})

test('автозаполнение (весь номер разом, без события вставки) — тот же разбор', () => {
  render(<Form />)
  fireEvent.change(field(), { target: { value: '+996 773 12-34-56' } })
  expect(field()).toHaveValue('773123456')
})

test('печатают по цифре — как набрано: «0555 123 456» остаётся с нулём', async () => {
  render(<Form />)
  await userEvent.type(field(), '0555 123 456')
  expect(field()).toHaveValue('0555 123 456')
  expect(sent()).toBe('0555 123 456')
})
