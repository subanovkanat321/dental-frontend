import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { appointment } from '../test/fixtures'
import { server } from '../test/server'
import { VisitNote } from './AppointmentExtras'

function renderNote(note: Schemas['ChartControllerNoteView']) {
  server.use(http.get('*/api/appointments/:id/note', () => HttpResponse.json(note)))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const a = appointment(10, 2, '10:00', 'Вымышленный П.', { status: 'DONE', patient: { id: 10, fullName: 'Вымышленный П.', phone: '996555000111', telegram: false } })
  render(<QueryClientProvider client={client}><VisitNote appointment={a} /></QueryClientProvider>)
}

test('заметка чужого приёма (editable: false) — только читать: текст и «Врач: …», без поля и «Сохранить»', async () => {
  renderNote({ note: 'Пульпит 46, временная пломба', editable: false, doctorName: 'Бекболот Асанов' })
  expect(await screen.findByText('Пульпит 46, временная пломба')).toBeInTheDocument()
  expect(screen.getByRole('region', { name: 'Заметка о приёме' })).toHaveTextContent('Врач: Бекболот Асанов')
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Сохранить|Изменить/ })).not.toBeInTheDocument()
})
