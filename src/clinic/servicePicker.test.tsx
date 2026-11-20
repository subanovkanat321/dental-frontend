import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { useState } from 'react'

import type { Schemas } from '../api/client'
import { createQueryClient } from '../api/queryClient'
import { server } from '../test/server'
import { ServicePicker } from './ServicePicker'

// Выбор услуги одним полем (2026-11-20): поиск, «Частые», разделы; multiple — чипы с ✕. Услуги вымышленной клиники
const services: Schemas['ServiceTypeView'][] = [
  { id: 1, name: 'Консультация', durationMinutes: 30, active: true, priceSom: 1000, group: 'EXAM' },
  { id: 2, name: 'Лечение кариеса', durationMinutes: 45, active: true, priceSom: 6000, group: 'THERAPY' },
  { id: 3, name: 'Пломба', durationMinutes: 30, active: true, priceSom: 4000, group: 'THERAPY' },
  { id: 4, name: 'Удаление зуба', durationMinutes: 30, active: true, priceSom: 3000, group: 'SURGERY' },
  { id: 5, name: 'Профгигиена', durationMinutes: 60, active: true, priceSom: 3000, group: 'HYGIENE' },
  { id: 6, name: 'Коронка', durationMinutes: 60, active: true, priceSom: 18000, group: 'PROSTHETICS' },
]

function Multi() {
  const [ids, setIds] = useState<number[]>([2])
  return <ServicePicker multiple aria-label="Услуги" services={services} values={ids} onChange={setIds} />
}

test('multiple: выбранные — чипами с ✕, в списке их нет; добавили и убрали', async () => {
  server.use(http.get('*/api/service-types/popular', () => HttpResponse.json({ ids: [] })))
  render(<QueryClientProvider client={createQueryClient()}><Multi /></QueryClientProvider>)
  const chips = screen.getByRole('list', { name: 'Выбранные услуги' })
  expect(chips).toHaveTextContent('Лечение кариеса · 45 мин')
  await userEvent.click(screen.getByRole('combobox', { name: 'Услуги' }))
  const list = screen.getByRole('listbox')
  // Нет данных о частых — «Частые» по порядку прайса; уже выбранной в списке нет
  expect(within(list).getAllByRole('option').map((o) => o.textContent).join('|')).not.toContain('Лечение кариеса')
  await userEvent.click(within(list).getAllByRole('option', { name: /Коронка/ })[0]!)
  expect(screen.getByRole('list', { name: 'Выбранные услуги' })).toHaveTextContent('Коронка · 60 мин')
  await userEvent.click(screen.getByRole('button', { name: 'Убрать: Лечение кариеса' }))
  expect(screen.getByRole('list', { name: 'Выбранные услуги' })).not.toHaveTextContent('Лечение кариеса')
  // Цены без prices не показываем
  await userEvent.click(screen.getByRole('combobox', { name: 'Услуги' }))
  expect(screen.getByRole('listbox')).not.toHaveTextContent('сом')
})
