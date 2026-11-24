import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp, findSub, querySub } from '../test/fixtures'
import { server } from '../test/server'
import { continueText, patientsWord } from './dropped'
import { progressShare, progressText } from '../lib/planStatus'

/** Вымышленные пациенты: Айгуль начала лечение и пропала, Бакыт согласился по ссылке и не пришёл. */
const rows: Schemas['PlanStatesDropped'][] = [
  { patientId: 2, fullName: 'Бакыт М.', phone: '996555111222', contactPhone: '996555111222', telegram: false, status: 'AGREED', done: 0, total: 1,
    leftSom: 20000, left: ['зуб 11 — Виниры'], doctorId: 1, doctor: 'Айгерим Садыкова' },
  { patientId: 3, fullName: 'Айгуль Т.', phone: '996700333444', contactPhone: '996700999888', telegram: true, status: 'IN_PROGRESS', done: 1, total: 3,
    leftSom: 7000, left: ['зуб 37 — Пломба', 'Чистка'], lastVisit: '2026-10-10T04:00:00Z', doctorId: 2, doctor: 'Дастан Т.', invitedAt: '2026-11-15T04:00:00Z',
    overdueOn: '2026-11-01' },
]

function serve(requests: string[]) {
  return ({ request }: { request: Request }) => {
    const q = new URL(request.url).searchParams
    requests.push(q.toString())
    const days = Number(q.get('days') ?? 30)
    const shown = days > 30 ? rows.slice(0, 1) : rows
    return HttpResponse.json({ patients: shown.slice(0, Number(q.get('limit') ?? 50)), total: shown.length,
      leftSom: shown.reduce((s, r) => s + r.leftSom, 0), days } satisfies Schemas['PlanStatesBoard'])
  }
}

beforeEach(() => {
  window.location.hash = '/patients'
  vi.stubGlobal('open', vi.fn())
})
afterEach(() => {
  window.location.hash = ''
  vi.unstubAllGlobals()
})

test('текст и прогресс: «выполнено 1 из 3 · 15 000 из 22 000 сом», без сумм — только этапы', () => {
  expect(progressText({ done: 1, total: 3, doneSom: 15000, totalSom: 22000 })).toBe('выполнено 1 из 3 · 15 000 из 22 000 сом')
  expect(progressText({ done: 1, total: 3 })).toBe('выполнено 1 из 3')
  expect(progressShare({ done: 1, total: 4 })).toBe(0.25)
  expect(progressShare({ done: 1, total: 4, doneSom: 5000, totalSom: 10000 })).toBe(0.5)
  expect(patientsWord(1)).toBe('пациент')
  expect(patientsWord(3)).toBe('пациента')
  expect(patientsWord(11)).toBe('пациентов')
  const text = continueText(rows[1]!, 'Стоматология «Тест»')
  expect(text).toContain('Здравствуйте, Айгуль Т.! Это Стоматология «Тест».')
  expect(text).toContain('• зуб 37 — Пломба')
  expect(text).not.toMatch(/сом/)
})

test('«Позвать снова» → «Бросили лечение» (старый адрес #/patients/dropped): список, итог, срок 30/60/90, WhatsApp, «Не напоминать», «Отказался», «Позвать всех»', async () => {
  const requests: string[] = []
  const hidden: string[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/patients/recent', () => HttpResponse.json([])),
    http.get('*/api/dropped', serve(requests)),
    http.post('*/api/dropped/:id/snooze', ({ params }) => { hidden.push(`snooze ${String(params.id)}`); return new HttpResponse(null, { status: 204 }) }),
    http.post('*/api/dropped/:id/refuse', ({ params }) => { hidden.push(`refuse ${String(params.id)}`); return new HttpResponse(null, { status: 204 }) }),
  )
  server.use(
    http.get('*/api/patient-groups', () => HttpResponse.json({ ready: [{ kind: 'READY', ready: 'DROPPED', name: 'Бросили лечение', count: 2, canEdit: false }],
      tags: [], custom: [] } satisfies Schemas['SegmentServiceGroups'])),
    http.get('*/api/patient-groups/members', ({ request }) => {
      expect(new URL(request.url).searchParams.get('ready')).toBe('DROPPED')
      return HttpResponse.json({ name: 'Бросили лечение', total: 2, inBot: 1, optedOut: 0, patients: [],
        taskTitle: 'Позвонить: лечение не закончено — записать на следующий этап', messageText: 'Здравствуйте, {имя}!', history: [] } satisfies Schemas['SegmentServiceMembers'])
    }),
    http.get('*/api/tasks/assignees', () => HttpResponse.json([{ telegramId: 111, fullName: 'Айгерим', role: 'Руководитель', me: true }] satisfies Schemas['TaskControllerAssignee'][])),
  )
  // Старая ссылка (плитка «Аналитики», закладка) — новая вкладка с карточкой «Бросили лечение»
  window.location.hash = '/patients/dropped'
  const user = userEvent.setup()
  renderApp()
  const list = await screen.findByRole('list', { name: 'Бросили лечение' })
  expect(window.location.hash).toBe('#/patients/comeback/dropped')
  expect(within(screen.getByRole('group', { name: 'Кого позвать' })).getByRole('button', { name: /Бросили лечение/ })).toHaveAttribute('aria-pressed', 'true')
  const items = within(list).getAllByRole('listitem')
  expect(items).toHaveLength(2)
  expect(items[0]).toHaveTextContent('Бакыт М.')
  expect(items[0]).toHaveTextContent('Согласован')
  expect(items[0]).toHaveTextContent('ещё не был')
  expect(items[1]).toHaveTextContent('В работе')
  // Срок несделанного этапа прошёл (V241) — пометка в строке; у Бакыта срока нет
  expect(within(items[1]!).getByText('просрочен этап')).toHaveAttribute('title', 'Срок этапа: до 1 нояб')
  expect(items[0]).not.toHaveTextContent('просрочен')
  expect(items[1]).toHaveTextContent('выполнено 1 из 3 · зуб 37 — Пломба · Чистка · Дастан Т. · звали')
  expect(items[1]).toHaveTextContent('7 000 сом')
  expect(screen.getByLabelText('Итого')).toHaveTextContent('2 пациента · не долечено на 27 000 сом')
  expect(requests[0]).toContain('days=30')

  // «📞 Связаться ▾» → WhatsApp с готовым текстом на номер представителя
  await user.click(within(items[1]!).getByRole('button', { name: /Связаться/ }))
  await user.click(await screen.findByRole('menuitem', { name: /WhatsApp: продолжить лечение/ }))
  const url = decodeURIComponent(String(vi.mocked(window.open).mock.calls[0]?.[0]))
  expect(url).toContain('996700999888')
  expect(url).toContain('Здравствуйте, Айгуль Т.!')

  // «⋯» → «Не напоминать 30 дней»
  await user.click(within(items[1]!).getByRole('button', { name: 'Ещё: Айгуль Т.' }))
  await user.click(screen.getByRole('menuitem', { name: 'Не напоминать 30 дней' }))
  await waitFor(() => expect(hidden).toEqual(['snooze 3']))

  // «Отказался от лечения» — сначала вопрос
  vi.stubGlobal('confirm', vi.fn(() => true))
  await user.click(within(items[0]!).getByRole('button', { name: 'Ещё: Бакыт М.' }))
  await user.click(screen.getByRole('menuitem', { name: 'Отказался от лечения' }))
  await waitFor(() => expect(hidden).toEqual(['snooze 3', 'refuse 2']))
  expect(vi.mocked(window.confirm).mock.calls[0]?.[0]).toContain('отказался от лечения')

  // «Позвать всех 2» — «Позвать группу» для группы «Бросили лечение» (30 дней, как у сервера)
  await user.click(screen.getByRole('button', { name: 'Позвать всех 2' }))
  const dialog = await screen.findByRole('dialog', { name: 'Позвать группу' })
  expect(within(dialog).getByDisplayValue('Позвонить: лечение не закончено — записать на следующий этап')).toBeInTheDocument()
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Позвать группу' })).toBeNull())

  // Срок 60 дней — новый запрос; «Позвать всех» — только на 30 днях (группа на сервере — 30 дней)
  await user.click(screen.getByRole('button', { name: '60 дней' }))
  await waitFor(() => expect(requests.at(-1)).toContain('days=60'))
  await waitFor(() => expect(within(screen.getByRole('list', { name: 'Бросили лечение' })).getAllByRole('listitem')).toHaveLength(1))
  expect(screen.queryByRole('button', { name: /Позвать всех/ })).toBeNull()
})

test('«＋ Задача» из «⋯» — окно задачи с пациентом и готовым текстом', async () => {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/patients/recent', () => HttpResponse.json([])),
    http.get('*/api/dropped', serve([])),
  )
  window.location.hash = '/patients/comeback/dropped'
  const user = userEvent.setup()
  renderApp()
  await user.click(await screen.findByRole('button', { name: 'Ещё: Айгуль Т.' }))
  await user.click(screen.getByRole('menuitem', { name: '＋ Задача' }))
  expect(await screen.findByDisplayValue('Позвонить: продолжить лечение по плану')).toBeInTheDocument()
  expect(screen.getAllByText(/Айгуль Т\./).length).toBeGreaterThan(1)
})

test('пусто — одна фраза; отдельной вкладки больше нет; ассистенту «Позвать снова» нет', async () => {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/patients/recent', () => HttpResponse.json([])),
  )
  const user = userEvent.setup()
  const { unmount } = renderApp()
  await user.click(await findSub('Позвать снова'))
  expect(querySub('Бросили лечение')).toBeNull()
  await user.click(within(await screen.findByRole('group', { name: 'Кого позвать' })).getByRole('button', { name: /Все/ }))
  // Пустая карточка не видна; по адресу — открыта и пустая
  expect(within(screen.getByRole('group', { name: 'Кого позвать' })).queryByRole('button', { name: /Бросили лечение/ })).toBeNull()
  unmount()
  window.location.hash = '/patients/comeback/dropped'
  const second = renderApp()
  expect(await screen.findByText('Никто не бросил лечение дольше 30 дней')).toBeInTheDocument()
  second.unmount()

  server.use(http.get('*/api/patient/me', () => HttpResponse.json({ ...me, admin: false, doctorId: undefined, assistantOf: [1] })))
  window.location.hash = '/patients'
  renderApp()
  await findSub('Все')
  expect(querySub('Бросили лечение')).toBeNull()
  expect(querySub('Позвать снова')).toBeNull()
})
