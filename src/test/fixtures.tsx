import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { act } from 'react'

import type { Schemas } from '../api/client'
import { App } from '../App'
import { todayIn } from '../lib/time'

/** Вымышленная клиника и пациенты — настоящих данных в тестах не бывает. */
export const me: Schemas['BookingViewsMe'] = {
  doctor: true, admin: true, reception: false, doctorId: 1, fullName: 'Айгерим',
  clinic: { brandName: 'Стоматология «Тест»', workStart: '09:00:00', workEnd: '18:00:00' },
  doctors: [{ id: 1, fullName: 'Айгерим Садыкова', active: true }, { id: 2, fullName: 'Дастан Т.', active: true }],
}

export function appointment(id: number, doctorId: number, time: string, name: string, extra: Partial<Schemas['AppointmentView']> = {}) {
  const start = new Date(`${todayIn()}T${time}:00+06:00`)
  return {
    id, doctorId, startAt: start.toISOString(), endAt: new Date(start.getTime() + 30 * 60000).toISOString(),
    status: 'SCHEDULED', reply: 'NONE', version: 0, patient: { id, fullName: name, phone: '996555123456' }, ...extra,
  } satisfies Schemas['AppointmentView']
}

export function renderApp() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><App /></QueryClientProvider>)
}

/** Пункт «Настроек» (#/settings/<item>) — как нажать его в списке. */
export function openItem(item: string) {
  act(() => {
    window.location.hash = `/settings/${item}`
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  })
}
