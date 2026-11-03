import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { createQueryClient } from '../api/queryClient'
import { PatientForm } from '../patients/PatientForm'
import { pickDate } from '../test/date'

// Пациент вымышленный
function form() {
  const client = createQueryClient({ queries: { retry: false } })
  render(<QueryClientProvider client={client}><PatientForm onSaved={() => {}} /></QueryClientProvider>)
}

test('новый пациент: «Далее» после имени — в телефон, номер набран целиком — сам переход к дате рождения', async () => {
  form()
  const name = screen.getByRole('textbox', { name: 'Имя пациента' })
  await userEvent.type(name, 'Айгуль Тестова{Enter}')
  const phone = screen.getByRole('textbox', { name: 'Телефон' })
  expect(phone).toHaveFocus()
  await userEvent.type(phone, '555123456')
  await waitFor(() => expect(screen.getByRole('button', { name: 'Дата рождения' })).toHaveFocus())
})

test('выбрали дату рождения — фокус дальше, в место работы', async () => {
  form()
  await pickDate(screen.getByRole('button', { name: 'Дата рождения' }), '1990-05-15')
  await waitFor(() => expect(screen.getByPlaceholderText('Например: школа №5')).toHaveFocus())
})
