import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'

import { appointment } from '../test/fixtures'
import { server } from '../test/server'
import { useAppointmentAction } from './useAppointmentAction'

test('оплата приёма перечитывает «Кассу»: к оплате, долги, выручку, отчёт и карточку пациента', async () => {
  const a = appointment(10, 1, '10:00', 'Бакыт М.', { status: 'DONE' })
  server.use(http.post('*/api/appointments/10/payment', () => HttpResponse.json({ ...a, paidSom: 1000, version: 1 })))
  const client = new QueryClient()
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const { result } = renderHook(() => useAppointmentAction(a), { wrapper })
  result.current.mutate({ kind: 'payment', body: { amountSom: 1000, method: 'CASH' } })
  await waitFor(() => expect(result.current.isSuccess).toBe(true))
  const keys = invalidate.mock.calls.map(([filters]) => filters?.queryKey?.[0])
  expect(keys).toEqual(expect.arrayContaining(['appointments', 'to-pay', 'debts', 'revenue', 'report', 'patient-card', 'slots', 'counts']))
})
