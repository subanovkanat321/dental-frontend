import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { createQueryClient } from '../api/queryClient'
import { TeethHistory } from '../medical/TeethHistory'
import { appointment, me, renderApp, expand } from '../test/fixtures'
import { fixNow } from '../test/now'
import { server } from '../test/server'
import { todayIn } from '../lib/time'

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
  // Свёрнутая строка «Зубы · не отмечены»; раскрыли — «＋ Отметить зуб»
  expect(within(block).getByRole('button', { name: /^Зубы/ })).toHaveTextContent('не отмечены')
  await expand(block)
  await userEvent.click(within(block).getByRole('button', { name: '＋ Отметить зуб' }))
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
  expect(calls.put).toEqual([{ number: 36, state: 'FILLING', surfaces: [], note: 'светоотверждаемая' }])

  await userEvent.click(within(list).getByRole('button', { name: 'Убрать зуб 36 из приёма' }))
  await waitFor(() => expect(calls.del).toEqual(['36']))
  await waitFor(() => expect(within(block).queryByRole('list', { name: 'Отмеченные зубы приёма' })).not.toBeInTheDocument())
  expect(within(block).getByRole('button', { name: '＋ Отметить зуб' })).toBeInTheDocument()
})

test('«изменить»: в редакторе — то, что уже отмечено', async () => {
  const calls = backend(appointment(10, 1, '00:05', 'Бакыт М.', { status: 'DONE', version: 1 }), me,
    [{ number: 46, state: 'TREATING', note: 'каналы' }])
  const block = await expand(await within(await card()).findByRole('region', { name: 'Зубы этого приёма' }))
  await userEvent.click(await within(block).findByRole('button', { name: 'Изменить зуб 46' }))
  const editor = within(block).getByRole('form', { name: 'Зуб 46' })
  expect(within(editor).getByRole('button', { name: /Лечится/ })).toHaveAttribute('aria-pressed', 'true')
  expect(within(editor).getByRole('textbox')).toHaveValue('каналы')
  await userEvent.click(within(editor).getByRole('button', { name: /Коронка/ }))
  await userEvent.click(within(editor).getByRole('button', { name: 'Сохранить' }))
  await waitFor(() => expect(calls.put).toEqual([{ number: 46, state: 'CROWN', surfaces: [], note: 'каналы' }]))
})

test('ассистент видит отмеченные зубы, но не отмечает', async () => {
  const assistant = { ...me, admin: false, doctorId: undefined, fullName: 'Асель', assistantOf: [2] }
  backend(appointment(10, 2, '00:05', 'Бакыт М.', { status: 'DONE', version: 1 }), assistant, [{ number: 36, state: 'FILLING' }])
  const block = await within(await card()).findByRole('region', { name: 'Зубы этого приёма' })
  // Номера отмеченных зубов видно и в свёрнутой строке
  expect(within(block).getByRole('button', { name: /^Зубы/ })).toHaveTextContent('36')
  await expand(block)
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
  // «Сейчас» — 10:00 по Бишкеку: иначе поздно вечером приём в 23:55 уже «в кресле» (за 15 минут)
  fixNow(`${todayIn()}T10:00:00+06:00`, { frozen: true })
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
  const block = await expand(await within(await card()).findByRole('region', { name: 'Продолжение лечения' }))
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

test('«Несколько» в приёме: галочки → «Пломба МО» всем одним запросом; история — с поверхностями', async () => {
  backend(appointment(10, 1, '00:05', 'Бакыт М.', { status: 'DONE', version: 1 }))
  const batch: unknown[] = []
  server.use(
    http.post('*/api/appointments/:id/teeth/batch', async ({ request }) => {
      const body = (await request.json()) as Schemas['VisitTeethControllerMany']
      batch.push(body)
      return HttpResponse.json((body.numbers ?? []).map((n) => ({ number: n, state: body.state, surfaces: body.surfaces as Schemas['VisitToothView']['surfaces'] })))
    }),
    http.get('*/api/patients/:id/teeth', () => HttpResponse.json([])),
  )
  const block = await expand(await within(await card()).findByRole('region', { name: 'Зубы этого приёма' }))
  await userEvent.click(within(block).getByRole('button', { name: /Отметить зуб/ }))
  await userEvent.click(within(block).getByRole('button', { name: /Несколько/ }))
  await userEvent.click(within(block).getByRole('button', { name: 'Зуб 36: не отмечен' }))
  await userEvent.click(within(block).getByRole('button', { name: 'Зуб 37: не отмечен' }))
  const panel = within(block).getByRole('region', { name: 'Действия с выбранными зубами' })
  await userEvent.click(within(panel).getByRole('button', { name: /Пломба/ }))
  const ring = within(panel).getByRole('group', { name: 'Поверхности выбранных зубов' })
  await userEvent.click(within(ring).getByRole('button', { name: 'мезиальная (М)' }))
  await userEvent.click(within(ring).getByRole('button', { name: 'окклюзионная (режущий край) (О)' }))
  await userEvent.click(within(panel).getByRole('button', { name: 'Поставить всем: пломба' }))
  await waitFor(() => expect(batch).toEqual([{ numbers: [36, 37], state: 'FILLING', surfaces: ['M', 'O'] }]))
  const list = await within(block).findByRole('list', { name: 'Отмеченные зубы приёма' })
  expect(list).toHaveTextContent('36 · Пломба (МО)')
  expect(list).toHaveTextContent('37 · Пломба (МО)')
})

test('«На весь экран» из карточки приёма: Esc закрывает слой, а не карточку', async () => {
  backend(appointment(10, 1, '00:05', 'Бакыт М.', { status: 'DONE', version: 1 }), me, [{ number: 36, state: 'CARIES', surfaces: ['O'] }])
  server.use(http.get('*/api/patients/:id/teeth', () => HttpResponse.json([{ number: 36, state: 'CARIES', surfaces: ['O'] }, { number: 11, state: 'CROWN' }])))
  const panel = await card()
  const block = await expand(await within(panel).findByRole('region', { name: 'Зубы этого приёма' }))
  await userEvent.click(await within(block).findByRole('button', { name: '⛶ На весь экран' }))
  const full = screen.getByRole('dialog', { name: 'Карта зубов на весь экран' })
  expect(await within(full).findByRole('button', { name: 'Зуб 11 — коронка' })).toBeInTheDocument()
  expect(within(full).getByText('Отмечены в этом приёме: 36')).toBeInTheDocument()
  expect(full).not.toHaveTextContent('Бакыт')
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('dialog', { name: 'Карта зубов на весь экран' })).not.toBeInTheDocument()
  expect(screen.getByRole('complementary', { name: 'Карточка приёма' })).toBeInTheDocument()
})

test('история по визитам и «Продолжение лечения» — с поверхностями', async () => {
  server.use(http.get('*/api/patients/:id/teeth/history', () => HttpResponse.json([
    { appointmentId: 9, startAt: '2026-10-27T04:00:00Z', doctorName: 'Айгерим', teeth: [{ number: 46, state: 'FILLING', surfaces: ['M', 'O', 'D'] }] },
  ] satisfies Schemas['VisitTeethView'][])))
  render(<QueryClientProvider client={createQueryClient({ queries: { retry: false } })}><TeethHistory patientId={5} /></QueryClientProvider>)
  expect(await screen.findByText('46 · Пломба (МОД)')).toBeInTheDocument()
})
