import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'

import { formatPhone } from '../lib/phone'
import { choose, chosen } from '../test/select'
import { phoneFromInput, phoneToInput } from './phone'
import { PhoneInput } from './PhoneInput'

/** Поле как в формах: значение — в родителе, в запрос — phoneFromInput. */
function Form({ initial = '' }: { initial?: string }) {
  const [v, setV] = useState(initial)
  return (
    <>
      <label className="field"><span>Телефон</span><PhoneInput label="Телефон" value={v} onChange={setV} /></label>
      <output aria-label="В запрос">{phoneFromInput(v)}</output>
    </>
  )
}

const number = () => screen.getByRole('textbox', { name: 'Телефон' })
const country = () => screen.getByRole('combobox', { name: 'Код страны' })
const sent = () => screen.getByLabelText('В запрос').textContent

test('кыргызский номер набирают как раньше: по умолчанию +996, местный — как набран', async () => {
  render(<Form />)
  expect(chosen(country())).toContain('🇰🇬 +996')
  await userEvent.type(number(), '555 123 456')
  expect(sent()).toBe('+996 555 123 456')

  await userEvent.clear(number())
  await userEvent.type(number(), '0555 123 456')
  expect(number()).toHaveValue('0555 123 456')
  expect(sent()).toBe('0555 123 456')
  expect(chosen(country())).toContain('+996')
})

test('вставили «+7 701…» — страна сама становится Казахстаном, «+7 912…» — Россией', async () => {
  render(<Form />)
  await userEvent.click(number())
  await userEvent.paste('+7 701 123 45 67')
  expect(chosen(country())).toContain('🇰🇿 +7')
  expect(number()).toHaveValue('701 123 45 67')
  expect(sent()).toBe('+7 701 123 45 67')

  await userEvent.clear(number())
  await userEvent.paste('+7 912 345 67 89')
  expect(chosen(country())).toContain('🇷🇺 +7')
  expect(sent()).toBe('+7 912 345 67 89')
})

test('выбрали Узбекистан — номер уходит с +998; страна остаётся, пока поле пустое', async () => {
  render(<Form />)
  await choose(country(), 'Узбекистан')
  expect(chosen(country())).toContain('🇺🇿 +998')
  expect(number()).toHaveAttribute('placeholder', '90 123 45 67')
  await userEvent.type(number(), '90 123 45 67')
  expect(sent()).toBe('+998 90 123 45 67')

  await userEvent.clear(number())
  expect(sent()).toBe('')
  expect(chosen(country())).toContain('+998')
})

test('другая страна — код набирают сами; номер, набранный с «+», переключает страну', async () => {
  render(<Form />)
  await choose(country(), 'Другая страна')
  await userEvent.type(number(), '4930 1234567')
  expect(sent()).toBe('+4930 1234567')

  await userEvent.clear(number())
  await userEvent.type(number(), '+992 93 123 45 67')
  expect(chosen(country())).toContain('🇹🇯 +992')
  expect(number()).toHaveValue('93 123 45 67')
  expect(sent()).toBe('+992 93 123 45 67')
})

test('сохранённый номер другой страны открывается со своей страной', () => {
  render(<Form initial={phoneToInput('905321234567')} />)
  expect(chosen(country())).toContain('🇹🇷 +90')
  expect(number()).toHaveValue('532 123 45 67')
  expect(sent()).toBe('+90 532 123 45 67')
})

test('подпись поля ведёт в номер, а не открывает список стран', async () => {
  render(<Form />)
  await userEvent.click(screen.getByText('Телефон'))
  expect(number()).toHaveFocus()
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
})

test('номер для людей — группами своей страны', () => {
  expect(formatPhone('996555123456')).toBe('+996 555 123 456')
  expect(formatPhone('77012345678')).toBe('+7 701 234 56 78')
  expect(formatPhone('79123456789')).toBe('+7 912 345 67 89')
  expect(formatPhone('998901234567')).toBe('+998 90 123 45 67')
  expect(formatPhone('992931234567')).toBe('+992 93 123 45 67')
  expect(formatPhone('905321234567')).toBe('+90 532 123 45 67')
  expect(formatPhone('49301234567')).toBe('+4930 123 45 67')
  expect(formatPhone('1234567')).toBe('+1234567')
  expect(phoneToInput('996555123456')).toBe('555 123 456')
  expect(phoneToInput('77012345678')).toBe('+7 701 234 56 78')
  expect(phoneToInput(null)).toBe('')
})

test('номер с телефона: невидимые метки iPhone, неразрывные пробелы и длинное тире не ломают номер', async () => {
  expect(phoneFromInput('‪+996 772 666 666‬')).toBe('+996 772 666 666')
  expect(phoneFromInput('772 666 666')).toBe('+996 772 666 666')
  expect(phoneFromInput('‎772666666')).toBe('+996 772666666')
  expect(phoneFromInput('0772–666–666')).toBe('0772-666-666')
  expect(phoneFromInput('772666666')).toBe('+996 772666666')
})
