import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { createQueryClient } from '../api/queryClient'
import { TeethHistory } from '../medical/TeethHistory'
import { appointment, me, renderApp } from '../test/fixtures'
import { server } from '../test/server'

// «Зубы этого приёма» (V155). Пациенты вымышленные
const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString()

function backend(visit: Schemas['AppointmentView'], who: Schemas['BookingViewsMe'] = me, initial: Schemas['VisitToothView'][] = []) {
  let teeth = [...initial]
  const calls: { put: unknown[]; del: string[]; get: number } = { put: [], del: [], get: 0 }
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(who)),
    http.get('*/api/appointments', ({ request }) => HttpResponse.json(
      Number(new URL(request.url).searchParams.get('doctorId')) === visit.doctorId ? [visit] : [])),
    http.get('*/api/appointments/to-pay', () => HttpResponse.json([])),
    http.get('*/api/appointments/:id/teeth', () => {
      calls.get++
      return HttpResponse.json(teeth)
    }),
    http.put('*/api/appointments/:id/teeth/:number', async ({ request, params }) => {
      const body = await request.json() as Schemas['VisitTeethControllerMark']
      calls.put.push({ number: Number(params.number), ...body })
      teeth = [...teeth.filter((t) => t.number !== Number(params.number)), { number: Number(params.number), state: body.state, note: body.note }]
      return HttpResponse.json(teeth)
    }),
    http.delete('*/api/appointments/:id/teeth/:number', ({ params }) => {
      calls.del.push(String(params.number))
      teeth = teeth.filter((t) => t.number !== Number(params.number))
      return HttpResponse.json(teeth)
    }),
  )
  return calls
}

async function card() {
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: /Бакыт М\./ }))
  return screen.getByRole('complementary', { name: 'Карточка приёма' })
}

test('врач отмечает зуб приёма: формула → состояние и заметка → в списке; «убрать»', async () => {
  const calls = backend(appointment(10, 1, '00:05', 'Бакыт М.', { status: 'DONE', version: 1 }))
  const panel = await card()
  const block = await within(panel).findByRole('region', { name: 'Зубы этого приёма' })

  await userEvent.click(within(block).getByRole('button', { name: 'Отметить зуб' }))
  // Та же раскладка FDI, что карта зубов: 32 зуба, 18…11 сверху справа
  expect(within(block).getAllByRole('button', { name: /^Зуб \d\d:/ })).toHaveLength(32)
  await userEvent.click(within(block).getByRole('button', { name: 'Зуб 36: не отмечен' }))
  const editor = within(block).getByRole('form', { name: 'Зуб 36' })
  // Состояние не выбрано — сохранить нельзя
  expect(within(editor).getByRole('button', { name: 'Сохранить' })).toBeDisabled()
  await userEvent.click(within(editor).getByRole('button', { name: /Пломба/ }))
  await userEvent.type(within(editor).getByRole('textbox'), ' светоотверждаемая ')
  await userEvent.click(within(editor).getByRole('button', { name: 'Сохранить' }))

  const list = await within(block).findByRole('list', { name: 'Отмеченные зубы приёма' })
  expect(within(list).getByText('36 · Пломба · светоотверждаемая')).toBeInTheDocument()
  expect(calls.put).toEqual([{ number: 36, state: 'FILLING', note: 'светоотверждаемая' }])

  await userEvent.click(within(list).getByRole('button', { name: 'Убрать зуб 36 из приёма' }))
  await waitFor(() => expect(calls.del).toEqual(['36']))
  await waitFor(() => expect(within(block).queryByRole('list', { name: 'Отмеченные зубы приёма' })).not.toBeInTheDocument())
  expect(within(block).getByRole('button', { name: 'Отметить зуб' })).toBeInTheDocument()
})

test('«изменить»: в редакторе — то, что уже отмечено', async () => {
  const calls = backend(appointment(10, 1, '00:05', 'Бакыт М.', { status: 'DONE', version: 1 }), me,
    [{ number: 46, state: 'TREATING', note: 'каналы' }])
  const block = await within(await card()).findByRole('region', { name: 'Зубы этого приёма' })
  await userEvent.click(await within(block).findByRole('button', { name: 'Изменить зуб 46' }))
  const editor = within(block).getByRole('form', { name: 'Зуб 46' })
  expect(within(editor).getByRole('button', { name: /Лечится/ })).toHaveAttribute('aria-pressed', 'true')
  expect(within(editor).getByRole('textbox')).toHaveValue('каналы')
  await userEvent.click(within(editor).getByRole('button', { name: /Коронка/ }))
  await userEvent.click(within(editor).getByRole('button', { name: 'Сохранить' }))
  await waitFor(() => expect(calls.put).toEqual([{ number: 46, state: 'CROWN', note: 'каналы' }]))
})

test('ассистент видит отмеченные зубы, но не отмечает', async () => {
  const assistant = { ...me, admin: false, doctorId: undefined, fullName: 'Асель', assistantOf: [2] }
  backend(appointment(10, 2, '00:05', 'Бакыт М.', { status: 'DONE', version: 1 }), assistant, [{ number: 36, state: 'FILLING' }])
  const block = await within(await card()).findByRole('region', { name: 'Зубы этого приёма' })
  expect(await within(block).findByText('36 · Пломба')).toBeInTheDocument()
  expect(within(block).queryByRole('button', { name: /Отметить зуб|Ещё зуб|Изменить|Убрать/ })).not.toBeInTheDocument()
})

test('регистратура: блока нет и зубы не запрашиваются', async () => {
  const calls = backend(appointment(10, 1, '00:05', 'Бакыт М.', { status: 'DONE', version: 1 }),
    { ...me, admin: false, doctorId: undefined, reception: true })
  const panel = await card()
  await within(panel).findByRole('button', { name: /Записать на следующий визит/ })
  expect(within(panel).queryByRole('region', { name: 'Зубы этого приёма' })).not.toBeInTheDocument()
  expect(calls.get).toBe(0)
})

test('будущий приём — блока пока нет', async () => {
  backend(appointment(10, 1, '23:55', 'Бакыт М.'))
  const panel = await card()
  await within(panel).findByRole('button', { name: 'Показать сейчас' })
  expect(within(panel).queryByRole('region', { name: 'Зубы этого приёма' })).not.toBeInTheDocument()
})

test('«Продолжение лечения» — зубы прошлого визита', async () => {
  backend(appointment(10, 1, '00:05', 'Бакыт М.', { status: 'DONE', version: 1 }))
  server.use(http.get('*/api/patients/:id/teeth/history', () => HttpResponse.json([
    { appointmentId: 8, startAt: ago(3), doctorName: 'Айгерим', teeth: [{ number: 46, state: 'TREATING', note: 'каналы' }, { number: 36, state: 'FILLING' }] },
  ] satisfies Schemas['VisitTeethView'][])))
  const block = await within(await card()).findByRole('region', { name: 'Продолжение лечения' })
  expect(await within(block).findByText('46 · Лечится · каналы; 36 · Пломба')).toBeInTheDocument()
})

test('медкарта: «История по визитам» — дата · врач · зубы', async () => {
  server.use(http.get('*/api/patients/:id/teeth/history', () => HttpResponse.json([
    { appointmentId: 9, startAt: '2026-10-27T04:00:00Z', doctorName: 'Айгерим', teeth: [{ number: 46, state: 'CROWN' }] },
    { appointmentId: 8, startAt: '2026-10-20T04:00:00Z', doctorName: 'Дастан', teeth: [{ number: 36, state: 'FILLING', note: 'светоотверждаемая' }] },
  ] satisfies Schemas['VisitTeethView'][])))
  render(<QueryClientProvider client={createQueryClient({ queries: { retry: false } })}><TeethHistory patientId={5} /></QueryClientProvider>)
  const block = await screen.findByRole('region', { name: 'История по визитам' })
  const items = within(block).getAllByRole('listitem')
  expect(items[0]).toHaveTextContent(/Айгерим.*46 · Коронка/)
  expect(items[1]).toHaveTextContent(/Дастан.*36 · Пломба · светоотверждаемая/)
})
