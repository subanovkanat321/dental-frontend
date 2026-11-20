import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { createQueryClient } from '../api/queryClient'
import { appointment, me } from '../test/fixtures'
import { server } from '../test/server'
import { VisitPlan } from '../schedule/VisitPlan'
import { PlanProgressLine, PlanStatusBar } from './PlanProgress'

type Progress = Schemas['PlanStatesProgress']

const inWork: Progress = { status: 'IN_PROGRESS', done: 3, total: 7, doneSom: 12000, totalSom: 40000, manualAgreed: false }

function wrap(node: React.ReactNode) {
  return render(<QueryClientProvider client={createQueryClient({ queries: { retry: false } })}>{node}</QueryClientProvider>)
}

test('карточка пациента: «План [В работе] выполнено 3 из 7 · 12 000 из 40 000 сом»', async () => {
  server.use(http.get('*/api/patients/7/plan/status', () => HttpResponse.json(inWork)))
  wrap(<PlanProgressLine patientId={7} />)
  const line = await screen.findByLabelText('Прогресс плана лечения')
  expect(line).toHaveTextContent('План')
  expect(line).toHaveTextContent('В работе')
  expect(line).toHaveTextContent('выполнено 3 из 7 · 12 000 из 40 000 сом')
})

test('ассистенту — без сумм; плана нет или 403 — строки нет', async () => {
  server.use(http.get('*/api/patients/7/plan/status', () => HttpResponse.json({ ...inWork, doneSom: undefined, totalSom: undefined })))
  const { unmount } = wrap(<PlanProgressLine patientId={7} />)
  const line = await screen.findByLabelText('Прогресс плана лечения')
  expect(line).toHaveTextContent('выполнено 3 из 7')
  expect(line).not.toHaveTextContent('сом')
  unmount()

  server.use(http.get('*/api/patients/8/plan/status', () => HttpResponse.json({ status: 'FORBIDDEN', title: 'Нет доступа' }, { status: 403 })))
  wrap(<><PlanProgressLine patientId={8} /><PlanProgressLine patientId={9} /></>)
  await waitFor(() => expect(screen.queryByLabelText('Прогресс плана лечения')).toBeNull())
})

test('редактор плана: «Пациент согласен» → Согласован, «Снять отметку», «Отказался»', async () => {
  const marks: unknown[] = []
  let current: Progress = { status: 'PROPOSED', done: 0, total: 2, doneSom: 0, totalSom: 9000, manualAgreed: false }
  server.use(
    http.get('*/api/patients/7/plan/status', () => HttpResponse.json(current)),
    http.put('*/api/patients/7/plan/status', async ({ request }) => {
      const body = await request.json() as { mark: string }
      marks.push(body.mark)
      current = body.mark === 'AGREED' ? { ...current, status: 'AGREED', manualAgreed: true }
        : body.mark === 'REFUSED' ? { ...current, status: 'REFUSED' } : { ...current, status: 'PROPOSED', manualAgreed: false }
      return HttpResponse.json(current)
    }),
  )
  const user = userEvent.setup()
  wrap(<PlanStatusBar patientId={7} readOnly={false} />)
  const bar = await screen.findByRole('group', { name: 'Статус плана лечения' })
  expect(bar).toHaveTextContent('Предложен')
  await user.click(screen.getByRole('button', { name: 'Пациент согласен' }))
  await waitFor(() => expect(bar).toHaveTextContent('Согласован'))
  await user.click(screen.getByRole('button', { name: 'Снять отметку' }))
  await waitFor(() => expect(bar).toHaveTextContent('Предложен'))
  await user.click(screen.getByRole('button', { name: 'Отказался' }))
  await waitFor(() => expect(bar).toHaveTextContent('Отказался'))
  expect(marks).toEqual(['AGREED', 'NONE', 'REFUSED'])
})

test('ассистент видит статус без кнопок', async () => {
  server.use(http.get('*/api/patients/7/plan/status', () => HttpResponse.json(inWork)))
  wrap(<PlanStatusBar patientId={7} readOnly />)
  expect(await screen.findByRole('group', { name: 'Статус плана лечения' })).toHaveTextContent('В работе')
  expect(screen.queryByRole('button', { name: 'Отказался' })).toBeNull()
})

test('карточка приёма: в строке «План лечения» — статус и прогресс', async () => {
  const a = appointment(7, 1, '10:00', 'Бакыт Тестов', { status: 'DONE' })
  server.use(
    http.get('*/api/patients/7/plan', () => HttpResponse.json([
      { id: 1, title: 'Пломба', priceSom: 4000, doneAt: '2026-10-01T04:00:00Z', stage: 1 },
      { id: 2, title: 'Коронка', priceSom: 15000, stage: 1 },
    ] satisfies Schemas['TreatmentStepView'][])),
    http.get('*/api/patients/7/plan/status', () => HttpResponse.json({ status: 'IN_PROGRESS', done: 1, total: 2, doneSom: 4000, totalSom: 19000, manualAgreed: false } satisfies Progress)),
  )
  wrap(<VisitPlan appointment={a} me={me} />)
  const meta = await screen.findByLabelText('Прогресс плана лечения')
  expect(meta).toHaveTextContent('В работе')
  expect(meta).toHaveTextContent('выполнено 1 из 2')
  expect(meta).toHaveTextContent('4 000 из 19 000 сом')
})
