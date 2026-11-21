import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { PlanPage } from '../site/PlanPage'
import { renderApp } from '../test/fixtures'
import { server } from '../test/server'

type Me = Schemas['BookingViewsMe']
type Plan = Schemas['PlanOffersPatientPlan']

/**
 * Зубы плана рисунком у пациента: страница /plan по ссылке и экран плана в Mini App. Вымышленный план: 36 — кариес МО,
 * каналы (этап 1) и коронка (этап 2), 46 — нет зуба, имплант (этап 2), профчистка без зуба.
 */
const PLAN: Plan = {
  id: 5, clinicName: 'Стоматология «Тест»', doctorName: 'Айгерим Садыкова', sentAt: '2026-11-03T05:00:00Z', validUntil: '2026-12-03',
  totalSom: 55500, phones: ['996555000111'],
  stages: [
    { stage: 1, totalSom: 10500, items: [{ tooth: 36, title: 'Лечение каналов', priceSom: 8000 }, { title: 'Профчистка', priceSom: 2500 }] },
    { stage: 2, totalSom: 45000, items: [{ tooth: 36, title: 'Коронка', priceSom: 15000 }, { tooth: 46, title: 'Имплант', priceSom: 30000 }] },
  ],
  chart: {
    dentition: 'PERMANENT', permanent: [],
    teeth: [
      { number: 36, state: 'CARIES', surfaces: ['M', 'O'], stages: [1, 2] },
      { number: 46, state: 'MISSING', surfaces: [], stages: [2] },
    ],
  },
}

const TOKEN = 'B'.repeat(43)

afterEach(() => {
  delete window.Telegram
  window.history.replaceState(null, '', '/')
  window.localStorage.clear()
})

test('страница /plan: обе челюсти, зубы плана в рамке с состоянием и этапами, легенда; нажал на зуб — его этапы подсвечены', async () => {
  window.history.replaceState(null, '', `/plan#${TOKEN}`)
  server.use(http.get(`*/web/plan/${TOKEN}`, () => HttpResponse.json(PLAN)))
  render(<PlanPage />)
  const chart = await screen.findByRole('region', { name: 'Зубы в плане' })
  expect(within(chart).getByRole('group', { name: 'Верхняя челюсть' })).toBeInTheDocument()
  expect(within(chart).getByRole('group', { name: 'Нижняя челюсть' })).toBeInTheDocument()
  // 32 постоянных зуба: здоровые — просто рисунком, зубы плана — кнопки
  expect(within(chart).getByLabelText('11')).toBeInTheDocument()
  expect(within(chart).getByLabelText('48')).toBeInTheDocument()
  const t36 = within(chart).getByRole('button', { name: '36 · кариес · в плане лечения · этап 1, этап 2' })
  expect(within(chart).getByRole('button', { name: '46 · нет зуба · в плане лечения · этап 2' })).toBeInTheDocument()
  expect(within(chart).getAllByRole('button')).toHaveLength(2)
  // Поверхности кариеса — на рисунке
  expect(t36.querySelector('[data-surface="M"]')).not.toBeNull()
  // Легенда: только встречающиеся состояния и рамка «в плане»
  const legend = chart.querySelector('.plan-chart-legend')!
  expect(legend).toHaveTextContent('кариес')
  expect(legend).toHaveTextContent('нет зуба')
  expect(legend).toHaveTextContent('в плане лечения')
  expect(legend).not.toHaveTextContent('пломба')

  await userEvent.click(t36)
  expect(t36).toHaveAttribute('aria-pressed', 'true')
  const selected = document.querySelectorAll('.plan-view li.selected')
  expect([...selected].map((li) => li.textContent)).toEqual([expect.stringContaining('Лечение каналов'), expect.stringContaining('Коронка')])
  // Ещё раз — снять подсветку
  await userEvent.click(t36)
  expect(document.querySelectorAll('.plan-view li.selected')).toHaveLength(0)

  // Кыргызча — подписи и легенда тоже
  await userEvent.click(screen.getByRole('button', { name: 'Кыргызча' }))
  const ky = screen.getByRole('region', { name: 'Пландагы тиштер' })
  expect(within(ky).getByRole('group', { name: 'Үстүңкү жаак' })).toBeInTheDocument()
  expect(within(ky).getByRole('button', { name: '46 · тиш жок · дарылоо планында · 2-этап' })).toBeInTheDocument()
  expect(ky.querySelector('.plan-chart-legend')).toHaveTextContent('дарылоо планында')
})

test('план без зубов (только чистка) — без рисунка; сменный прикус ребёнка — молочные и уже пришедшие постоянные', async () => {
  window.history.replaceState(null, '', `/plan#${TOKEN}`)
  server.use(http.get(`*/web/plan/${TOKEN}`, () => HttpResponse.json({ ...PLAN, chart: undefined })))
  const first = render(<PlanPage />)
  expect(await screen.findByRole('heading', { name: 'План лечения' })).toBeInTheDocument()
  expect(screen.queryByRole('region', { name: 'Зубы в плане' })).not.toBeInTheDocument()
  first.unmount()

  const child: Plan = {
    ...PLAN,
    stages: [{ stage: 1, totalSom: 3000, items: [{ tooth: 85, title: 'Лечение кариеса', priceSom: 3000 }] }],
    chart: { dentition: 'MIXED', permanent: [11, 21], teeth: [{ number: 85, state: 'CARIES', surfaces: [], stages: [1] }] },
  }
  server.use(http.get(`*/web/plan/${TOKEN}`, () => HttpResponse.json(child)))
  render(<PlanPage />)
  const chart = await screen.findByRole('region', { name: 'Зубы в плане' })
  expect(within(chart).getByRole('button', { name: '85 · кариес · в плане лечения · этап 1' })).toBeInTheDocument()
  // Пришли на смену — постоянные 11, 21; на остальных местах 1–5 — молочные; моляры 6–8 — постоянные
  expect(within(chart).getByLabelText('11')).toBeInTheDocument()
  expect(within(chart).queryByLabelText('51')).not.toBeInTheDocument()
  expect(within(chart).getByLabelText('52')).toBeInTheDocument()
  expect(within(chart).getByLabelText('16')).toBeInTheDocument()
  expect(within(chart).queryByLabelText('45')).not.toBeInTheDocument()
})

const patient = (extra: Partial<Me> = {}): Me => ({
  doctor: false, platform: false, bookingEnabled: true, lang: 'ru', daysAhead: 14, fullName: 'Айгуль',
  doctors: [{ id: 1, fullName: 'Айгерим Садыкова', active: true, telegramLinked: false }],
  services: [{ id: 5, name: 'Лечение кариеса', durationMinutes: 60, priceSom: 2500, active: true }],
  clinic: { brandName: 'Стоматология «Тест»', independentDoctors: false, listed: true, separateSupplies: false, settingUp: false, ownHours: false, recallMonths: 6 },
  admin: false, reception: false, owner: false, canChangeClinic: false, waiting: false, hasReception: false, hasCard: false, maxRelatives: 6,
  ...extra,
})

test('Mini App «Открыть план»: рисунок зубов плана на кыргызском', async () => {
  window.Telegram = { WebApp: { initData: 'query_id=1&user=%7B%22id%22%3A222%7D&hash=abc', ready() {}, expand() {} } }
  window.history.replaceState(null, '', '/?screen=plan')
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(patient({ lang: 'ky' }))),
    http.get('*/api/patient/slots', () => HttpResponse.json({ workingDay: true, starts: [], taken: [], breaks: [] })),
    http.get('*/api/patient/plans', () => HttpResponse.json([PLAN])),
  )
  renderApp()
  const chart = await screen.findByRole('region', { name: 'Пландагы тиштер' })
  const t46 = within(chart).getByRole('button', { name: '46 · тиш жок · дарылоо планында · 2-этап' })
  await userEvent.click(t46)
  expect([...document.querySelectorAll('.plan-view li.selected')].map((li) => li.textContent)).toEqual([expect.stringContaining('Имплант')])
})
