import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'

import { AVATARS } from '../lib/avatars'
import { DoctorFilter } from './DoctorFilter'
import { doctorOptions } from './doctorOptions'
import { me } from '../test/fixtures'
import { waitForSlow } from '../test/wait'

// Вымышленные врачи — из test/fixtures
const doctors = me.doctors!

function Harness({ all = true, initial = null as number | null }) {
  const [value, setValue] = useState<number | null>(initial)
  return (
    <>
      <DoctorFilter label="Врач" value={value} onChange={setValue} all={all ? { sub: '3 записи' } : false}
        options={doctorOptions(doctors, { me, sub: (d) => (d.id === 2 ? '1 запись' : undefined) })} />
      <output>{value ?? 'все'}</output>
    </>
  )
}

test('кружок цвета врача (как в «Расписании»), «(я)», строка под именем, ✓ у выбранного, «Все врачи» с 👥 последним', async () => {
  render(<Harness initial={2} />)
  const button = screen.getByRole('button', { name: 'Врач: Дастан Т.' })
  expect(button).toHaveAttribute('aria-haspopup', 'listbox')
  expect(button.querySelector('.pick-avatar')).toHaveStyle({ background: AVATARS[1] })
  await userEvent.click(button)
  expect(button).toHaveAttribute('aria-expanded', 'true')
  const options = within(screen.getByRole('listbox', { name: 'Врач' })).getAllByRole('option')
  expect(options.map((o) => o.textContent)).toEqual(['АСАйгерим Садыкова (я)', 'ДТДастан Т.1 запись✓', '👥Все врачи3 записи'])
  expect(options[1]).toHaveAttribute('aria-selected', 'true')
  await userEvent.click(options[2]!)
  expect(screen.getByRole('status')).toHaveTextContent('все')
  expect(screen.queryByRole('listbox')).toBeNull()
})

test('клавиатура: ↓ открывает, ↑ ↓ по пунктам, Enter выбирает, Esc закрывает', async () => {
  render(<Harness initial={1} />)
  const button = screen.getByRole('button', { name: /^Врач:/ })
  button.focus()
  await userEvent.keyboard('{ArrowDown}')
  const list = screen.getByRole('listbox')
  await waitForSlow(() => expect(within(list).getAllByRole('option')[0]).toHaveFocus())
  await userEvent.keyboard('{ArrowDown}{Enter}')
  expect(screen.getByRole('status')).toHaveTextContent('2')
  await userEvent.click(screen.getByRole('button', { name: /^Врач:/ }))
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('listbox')).toBeNull()
})

test('без права смотреть всех — пункта «Все врачи» нет', async () => {
  render(<Harness all={false} initial={1} />)
  await userEvent.click(screen.getByRole('button', { name: /^Врач:/ }))
  expect(within(screen.getByRole('listbox')).getAllByRole('option')).toHaveLength(2)
  expect(screen.queryByText('Все врачи')).toBeNull()
})
