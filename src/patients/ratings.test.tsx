import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { subsOf } from '../layout/nav'
import { appointment, findSub, me, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { choose } from '../test/select'
import { LONG_COMPLAINT } from './ratings'

type Me = Schemas['BookingViewsMe']
type Row = Schemas['RatingRow']

/** «Пациенты → Оценки». Пациенты, врачи и жалобы — вымышленные. */

const LONG = 'Ждали в коридоре почти сорок минут, никто не предупредил о задержке, а потом врач торопился и толком не объяснил, что делать дальше дома.'

const ROWS: Row[] = [
  { appointmentId: 7, patientId: 2, patientName: 'Айгуль Т.', doctorId: 1, doctorName: 'Айгерим Садыкова', startAt: '2026-11-18T04:00:00Z', rating: 5, via: 'BOT' },
  { appointmentId: 8, patientId: 3, patientName: 'Бакыт М.', doctorId: 2, doctorName: 'Дастан Т.', startAt: '2026-11-10T05:00:00Z', rating: 2, via: 'PAGE', comment: LONG },
]

function page(items: Row[], extra: Partial<Schemas['RatingList']> = {}): Schemas['RatingList'] {
  return { summary: { count: 2, average: 3.5, byStars: [0, 1, 0, 0, 1], fromPage: 1 }, items, more: false, ...extra }
}

function backend(asked: URLSearchParams[] = [], respond = (q: URLSearchParams) => page(q.get('low') === 'true' ? ROWS.slice(1) : ROWS)) {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments/ratings/list', ({ request }) => {
      const q = new URL(request.url).searchParams
      asked.push(q)
      return HttpResponse.json(respond(q))
    }),
  )
}

afterEach(() => {
  window.location.hash = ''
})

test('вкладка «Оценки» — в конце «Пациентов» у руководителя, врача, регистратуры и ассистента; без врачей и роли — нет', () => {
  const has = (who: Me) => subsOf('patients', who).map((s) => s.key)
  expect(has(me).at(-1)).toBe('ratings')
  expect(has({ ...me, admin: false })).toContain('ratings')
  expect(has({ ...me, admin: false, reception: true, doctorId: undefined })).toContain('ratings')
  expect(has({ ...me, admin: false, doctorId: undefined, assistantOf: [2] })).toContain('ratings')
  expect(has({ ...me, admin: false, doctor: false, doctorId: undefined })).not.toContain('ratings')
})

test('сводка и список: новые сверху, врач, канал, звёзды; «Только 1–3 ★» и врач уходят на сервер; строка открывает приём', async () => {
  const asked: URLSearchParams[] = []
  backend(asked)
  server.use(http.get('*/api/appointments/7', () => HttpResponse.json(appointment(7, 1, '10:00', 'Айгуль Т.', { status: 'DONE', rating: 5 }))))
  window.location.hash = '/patients/ratings'
  renderApp()
  const list = await screen.findByRole('list', { name: 'Оценки пациентов' })
  const summary = screen.getByRole('region', { name: 'Сводка оценок' })
  expect(within(summary).getByLabelText('Средняя оценка')).toHaveTextContent('3,5')
  expect(summary).toHaveTextContent('Оценок: 2')
  expect(summary).toHaveTextContent('С жалобой (1–3 ★): 1')
  const [aigul, bakyt] = within(list).getAllByRole('listitem')
  expect(aigul).toHaveTextContent(/Айгуль Т\..*18 нояб? 2026 · Айгерим Садыкова · в боте/)
  expect(within(aigul!).getByLabelText('Оценка 5 из 5')).toBeInTheDocument()
  expect(bakyt).toHaveTextContent('Дастан Т. · по ссылке')
  expect(within(bakyt!).getByLabelText('Оценка 2 из 5')).toBeInTheDocument()
  expect(asked[0]!.get('days')).toBe('90')
  expect(asked[0]!.get('low')).toBe('false')

  await userEvent.click(screen.getByRole('checkbox', { name: 'Только 1–3 ★' }))
  await within(list).findByText('Бакыт М.')
  await screen.findByRole('list', { name: 'Оценки пациентов' }).then((l) => expect(within(l).queryByText('Айгуль Т.')).toBeNull())
  expect(asked.at(-1)!.get('low')).toBe('true')

  await userEvent.click(screen.getByRole('button', { name: 'Год' }))
  await choose(screen.getByRole('combobox', { name: 'Врач' }), 'Дастан Т.')
  expect(asked.at(-1)!.get('days')).toBe('365')
  expect(asked.at(-1)!.get('doctorId')).toBe('2')

  await userEvent.click(screen.getByRole('checkbox', { name: 'Только 1–3 ★' }))
  await userEvent.click(await screen.findByRole('button', { name: 'Айгуль Т.' }))
  expect(await screen.findByRole('complementary', { name: 'Карточка приёма' })).toHaveTextContent('Айгуль Т.')
})

test('длинная жалоба — две строки, нажатие раскрывает и не открывает приём; короткая — целиком', async () => {
  expect(LONG.length).toBeGreaterThan(LONG_COMPLAINT)
  backend([], () => page([...ROWS, { ...ROWS[1]!, appointmentId: 9, patientName: 'Нурлан К.', comment: 'Больно' }]))
  window.location.hash = '/patients/ratings'
  renderApp()
  const list = await screen.findByRole('list', { name: 'Оценки пациентов' })
  const toggle = within(list).getByRole('button', { name: /Ждали в коридоре/ })
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  expect(toggle).not.toHaveClass('open')
  await userEvent.click(toggle)
  expect(toggle).toHaveAttribute('aria-expanded', 'true')
  expect(toggle).toHaveTextContent('свернуть')
  expect(screen.queryByRole('complementary', { name: 'Карточка приёма' })).toBeNull()
  // Короткая — без кнопки
  expect(within(list).getByText('Больно').closest('.rating-complaint')!.tagName).toBe('P')
})

test('«Показать ещё» — следующая страница', async () => {
  const asked: URLSearchParams[] = []
  backend(asked, (q) => (q.get('page') === '0'
    ? page(ROWS.slice(0, 1), { more: true })
    : page(ROWS.slice(1))))
  window.location.hash = '/patients/ratings'
  renderApp()
  const list = await screen.findByRole('list', { name: 'Оценки пациентов' })
  expect(within(list).getAllByRole('listitem')).toHaveLength(1)
  await userEvent.click(screen.getByRole('button', { name: 'Показать ещё' }))
  expect(await within(list).findByText('Бакыт М.')).toBeInTheDocument()
  expect(asked.at(-1)!.get('page')).toBe('1')
  expect(screen.queryByRole('button', { name: 'Показать ещё' })).toBeNull()
})

test('пусто — «Оценок пока нет» и как просить оценку; жалоб нет — своё пустое состояние', async () => {
  backend([], (q) => (q.get('days') === '30'
    ? page([], { summary: { count: 0, byStars: [0, 0, 0, 0, 0], fromPage: 0 } })
    : page([], { summary: { count: 3, average: 5, byStars: [0, 0, 0, 0, 3], fromPage: 0 } })))
  window.location.hash = '/patients/ratings'
  renderApp()
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Только 1–3 ★' }))
  expect(await screen.findByText('Жалоб за этот период нет')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: '30 дней' }))
  expect(await screen.findByText('Оценок пока нет')).toBeInTheDocument()
  expect(screen.getByText(/Попросить оценку/)).toBeInTheDocument()
})

test('«Касса → Статистика»: ссылка «Все оценки →» ведёт во вкладку', async () => {
  backend()
  window.location.hash = '/cash/stats'
  renderApp()
  const link = await screen.findByRole('link', { name: 'Все оценки →' })
  expect(link).toHaveAttribute('href', '#/patients/ratings')
  await userEvent.click(link)
  expect(await findSub('Оценки')).toHaveAttribute('aria-current', 'page')
})
