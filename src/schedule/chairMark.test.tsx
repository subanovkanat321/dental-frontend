import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { slotInstant, todayIn } from '../lib/time'
import { appointment, me, renderApp } from '../test/fixtures'
import { server } from '../test/server'

/**
 * Приём в рабочих часах коллеги по креслу (V187) — пометка «🪑 время …» на самой записи и полосы/строки «время …»
 * по всему дню, и вне часов врача (жалоба 2026-11-09: «в уже созданных тоже нет предупреждения»). Врачи и пациенты
 * вымышленные: у Айгерим (№1, часы 08–18) и Дастана (№2, вечер 18–24) общее «Кресло 1». У Айгерим — приём 10:00
 * в своё время и 22:43 «Другим временем» (в часы Дастана); у Дастана — свой приём 20:00.
 */
function phone(narrow: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: narrow ? query.includes('max-width') : query.includes('min-width'), media: query, addEventListener() {}, removeEventListener() {},
    onchange: null, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  }))
}
afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
  window.location.hash = ''
})

const at = (hh: number, mm = 0) => slotInstant(todayIn(), hh * 60 + mm)
const midnight = () => new Date(new Date(at(0)).getTime() + 24 * 3600_000).toISOString()

function backend({ evening = true }: { evening?: boolean } = {}) {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments/counts', () => HttpResponse.json([])),
    http.get('*/api/chairs', () => HttpResponse.json([{ id: 5, name: 'Кресло 1', doctorIds: [1, 2], overlaps: [], mode: 'WARN' }] satisfies Schemas['ChairOverview'][])),
    http.get('*/api/appointments', ({ request }) => {
      const doctorId = Number(new URL(request.url).searchParams.get('doctorId'))
      return HttpResponse.json(doctorId === 1
        ? [appointment(10, 1, '10:00', 'Бакыт М.'), ...(evening ? [appointment(11, 1, '22:43', 'Асель Т.')] : [])]
        : [appointment(12, 2, '20:00', 'Нурлан К.')])
    }),
    http.get('*/api/slots', ({ request }) => {
      const doctorId = Number(new URL(request.url).searchParams.get('doctorId'))
      // Сервер (SlotService) отдаёт chairTime за весь день: Айгерим — вечер Дастана, Дастану — её день
      const mine = doctorId === 1
      return HttpResponse.json({
        workingDay: true, workStart: mine ? '08:00:00' : '18:00:00', workEnd: mine ? '18:00:00' : '00:00:00', breaks: [], free: [], starts: [], chairBusy: [],
        work: [mine ? { start: at(8), end: at(18) } : { start: at(18), end: midnight() }],
        chairTime: [mine
          ? { start: at(18), end: midnight(), doctorId: 2, doctorName: 'Дастан Т.', chairName: 'Кресло 1' }
          : { start: at(8), end: at(18), doctorId: 1, doctorName: 'Айгерим Садыкова', chairName: 'Кресло 1' }],
      } satisfies Schemas['SlotsView'])
    }),
  )
}

const MARK = 'Записан в часы врача Дастан Т. (Кресло 1)'

test('сетка дня: полоса «время Дастан» вне часов врача, 🪑 на приёме 22:43 и строка в карточке; свой и коллегин приём — без пометки', async () => {
  phone(false)
  backend()
  renderApp()

  const mine = await screen.findByRole('group', { name: 'Айгерим Садыкова' })
  const band = await within(mine).findByRole('note', { name: '18:00–00:00: время Дастан Т.' })
  expect(band).toHaveClass('grid-colleague')
  const late = await within(mine).findByRole('button', { name: /22:43–23:13, Асель Т\./ })
  expect(within(late).getByRole('img', { name: MARK })).toHaveTextContent('🪑')
  const own = within(mine).getByRole('button', { name: /10:00–10:30, Бакыт М\./ })
  expect(within(own).queryByRole('img', { name: /часы врача/ })).not.toBeInTheDocument()
  // Приём самого Дастана в его вечер — его время, не чужое
  const his = await screen.findByRole('group', { name: 'Дастан Т.' })
  const hisOwn = await within(his).findByRole('button', { name: /20:00–20:30, Нурлан К\./ })
  expect(within(hisOwn).queryByRole('img', { name: /часы врача/ })).not.toBeInTheDocument()
  // Легенда объясняет значок
  expect(screen.getByText(/🪑 в часы коллеги по креслу/)).toBeInTheDocument()

  await userEvent.click(late)
  const card = await screen.findByRole('complementary', { name: 'Карточка приёма' })
  expect(await within(card).findByRole('note')).toHaveTextContent(`🪑 ${MARK}`)

  await userEvent.click(own)
  const ownCard = await screen.findByRole('complementary', { name: 'Карточка приёма' })
  await within(ownCard).findByText('Бакыт М. ›')
  expect(within(ownCard).queryByText(/Записан в часы врача/)).not.toBeInTheDocument()
})

test('список дня на телефоне: строка «время Дастан» вне часов и бейдж на приёме 22:43; у приёма в своё время — нет', async () => {
  phone(true)
  backend()
  renderApp()

  const late = await screen.findByRole('button', { name: new RegExp(`^22:43–23:13, Асель Т\\.: .+\\. ${MARK.replace(/[().]/g, '\\$&')}$`) })
  expect(late.querySelector('.chair-mark')).toHaveTextContent('🪑 время Дастан')
  expect(screen.getByRole('note', { name: '18:00–00:00: время Дастан Т.' })).toHaveTextContent('🪑 время Дастан Т.')
  const own = screen.getByRole('button', { name: /^10:00–10:30, Бакыт М\./ })
  expect(own.querySelector('.chair-mark')).toBeNull()
  expect(own).not.toHaveAccessibleName(/часы врача/)

  await userEvent.click(late)
  const card = await screen.findByRole('complementary', { name: 'Карточка приёма' })
  expect(await within(card).findByText(MARK)).toBeInTheDocument()
})

test('список дня без приёмов вне часов: пустой вечер коллеги строкой не показываем', async () => {
  phone(true)
  backend({ evening: false })
  renderApp()

  expect(await screen.findByRole('button', { name: /^10:00–10:30, Бакыт М\./ })).toBeInTheDocument()
  expect(screen.queryByRole('note', { name: /время Дастан/ })).not.toBeInTheDocument()
})
