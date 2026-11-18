import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { appointment, me, renderApp } from '../test/fixtures'
import { server } from '../test/server'

// Пациенты, работы и лаборатории вымышленные
const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString()

/** Приём состоялся: есть прошлая заметка и план (продолжение лечения), работа лаборатории на этот приём. */
function backend() {
  const done = appointment(10, 1, '00:05', 'Бакыт М.', { status: 'DONE', version: 1 })
  const crown: Schemas['LabOrderView'] = {
    id: 1, patientId: 10, patientName: 'Бакыт М.', doctorId: 1, doctorName: 'Айгерим Садыкова', labId: 5, labName: 'Дент-Лаб',
    kind: 'CROWN', teeth: '36', work: 'Коронка 36', sentOn: '2026-11-04', dueOn: '2026-11-14', status: 'READY', reworkCount: 0, overdue: false,
    paid: false, canMoney: true, canDelete: true, createdAt: '2026-11-04T05:00:00Z', fittingAppointmentId: 10,
  }
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments', ({ request }) => HttpResponse.json(new URL(request.url).searchParams.get('doctorId') === '1' ? [done] : [])),
    http.get('*/api/patients/:id/notes', () => HttpResponse.json([{ appointmentId: 7, startAt: ago(7), note: 'Удалили нерв 36', doctorName: 'Айгерим', editable: true }])),
    http.get('*/api/patients/:id/plan', () => HttpResponse.json([{ id: 2, tooth: 36, title: 'Коронка', stage: 1 }])),
    http.get('*/api/patients/:id/expenses', () => HttpResponse.json([{ id: 3, spentOn: '2026-11-04', amountSom: 4500, category: 'Зуботехническая лаборатория', doctorId: 1, patientId: 10 }])),
    http.get('*/api/lab-orders', () => HttpResponse.json([crown])),
  )
}

async function visitSection() {
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: /Бакыт М\./ }))
  const panel = screen.getByRole('complementary', { name: 'Карточка приёма' })
  const visit = within(panel).getByRole('region', { name: 'Приём' })
  // Ждём блоки, что приходят с сервера позже остальных
  await within(visit).findByRole('region', { name: 'Продолжение лечения' })
  await within(visit).findByRole('region', { name: 'Лаборатория на этот приём' })
  return { panel, visit }
}

test('карточка приёма (состоялся): «Приём» по приоритету — продолжение, заметка, зубы, план, материалы, расход, лаборатория, снимки', async () => {
  backend()
  const { visit } = await visitSection()
  const order = ['Продолжение лечения', 'Заметка о приёме', 'Зубы этого приёма', 'План лечения пациента', 'Материалы на приёме',
    'Расход по пациенту (техник, лаборатория)', 'Лаборатория на этот приём', 'Снимки и фото']
  const blocks = Array.from(visit.querySelectorAll<HTMLElement>('[aria-label]'))
    .map((el) => el.getAttribute('aria-label')!)
    .filter((name, i, all) => order.includes(name) && all.indexOf(name) === i)
  expect(blocks).toEqual(order)
})

test('«Расход (техник, лаборатория)» — в «Приёме», без «Ещё»: сумма видна сразу, форма — раскрыть строку', async () => {
  backend()
  const { panel, visit } = await visitSection()
  const fold = within(visit).getByRole('region', { name: 'Расход по пациенту (техник, лаборатория)' })
  expect(await within(fold).findByText(/4\s500 сом/)).toBeInTheDocument()
  await userEvent.click(within(fold).getByRole('button', { name: /^Расход \(техник, лаборатория\)/ }))
  expect(within(fold).getByRole('button', { name: '💸 Расход по пациенту (техник)' })).toBeInTheDocument()
  // В «Ещё» расхода больше нет
  const more = within(panel).getByRole('button', { name: /^Ещё/ })
  expect(more).not.toHaveAccessibleName(/расход/)
  await userEvent.click(more)
  expect(within(panel).getAllByRole('button', { name: '💸 Расход по пациенту (техник)' })).toHaveLength(1)
})
