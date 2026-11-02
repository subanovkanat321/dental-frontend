import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'

import { DurationField } from './DurationField'
import { choose } from '../test/select'

function Host({ start }: { start: number }) {
  const [value, setValue] = useState(start)
  return <><DurationField value={value} onChange={setValue} /><output>{value}</output></>
}

test('«Своя…» — любое число минут; не из списка (20 мин) — сразу полем', async () => {
  render(<Host start={30} />)
  await choose(screen.getByRole('combobox', { name: 'Длительность' }), 'Своя…')
  const minutes = screen.getByRole('spinbutton', { name: 'Длительность, мин' })
  await userEvent.clear(minutes)
  await userEvent.type(minutes, '50')
  expect(screen.getByRole('status')).toHaveTextContent(/^50$/)
  expect(minutes).toHaveValue(50)
})

test('значение не из списка показывается полем', () => {
  render(<Host start={20} />)
  expect(screen.getByRole('spinbutton', { name: 'Длительность, мин' })).toHaveValue(20)
})
