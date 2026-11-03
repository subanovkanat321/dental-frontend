import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { PlanPage } from '../site/PlanPage'
import { renderApp } from '../test/fixtures'
import { server } from '../test/server'

type Me = Schemas['BookingViewsMe']
type Plan = Schemas['PlanOffersPatientPlan']

/** Вымышленный план: два этапа, без имени пациента (как отдаёт страница по ссылке). */
const PLAN: Plan = {
  id: 5, clinicName: 'Стоматология «Тест»', doctorName: 'Айгерим Садыкова', sentAt: '2026-11-03T05:00:00Z', validUntil: '2026-12-03',
  duration: '2 месяца', totalSom: 25500, phones: ['996555000111'],
  stages: [
    { stage: 1, totalSom: 10500, items: [{ tooth: 36, title: 'Лечение каналов', priceSom: 8000 }, { title: 'Профчистка', priceSom: 2500 }] },
    { stage: 2, totalSom: 15000, items: [{ tooth: 36, title: 'Коронка', priceSom: 15000 }] },
  ],
}

const TOKEN = 'A'.repeat(43)

const patient = (extra: Partial<Me> = {}): Me => ({
  doctor: false, platform: false, bookingEnabled: true, lang: 'ru', daysAhead: 14, fullName: 'Айгуль',
  doctors: [{ id: 1, fullName: 'Айгерим Садыкова' }],
  services: [{ id: 5, name: 'Лечение кариеса', durationMinutes: 60, priceSom: 2500 }],
  clinic: { brandName: 'Стоматология «Тест»' },
  ...extra,
})

function fakeTelegram() {
  window.Telegram = { WebApp: { initData: 'query_id=1&user=%7B%22id%22%3A222%7D&hash=abc', ready() {}, expand() {} } }
}

afterEach(() => {
  delete window.Telegram
  window.history.replaceState(null, '', '/')
})

test('Mini App: кнопка бота «Открыть план» — этапы, цены, итоги; «Согласен» → согласован, «Записаться на 1-й этап»', async () => {
  fakeTelegram()
  window.history.replaceState(null, '', '/?screen=plan')
  const calls: string[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(patient())),
    http.get('*/api/patient/slots', () => HttpResponse.json({ workingDay: true, starts: [], taken: [], breaks: [] })),
    http.get('*/api/patient/plans', () => HttpResponse.json([PLAN])),
    http.post('*/api/patient/plans/5/agree', () => {
      calls.push('agree')
      return HttpResponse.json({ ...PLAN, agreedAt: '2026-11-04T05:00:00Z' })
    }),
  )
  renderApp()
  expect(await screen.findByRole('heading', { name: 'План лечения' })).toBeInTheDocument()
  expect(screen.getByRole('region', { name: 'Этап 1' })).toHaveTextContent(/Зуб 36 · Лечение каналов8\s000 сом/)
  expect(screen.getByRole('region', { name: 'Этап 1' })).toHaveTextContent(/Итого за этап: 10\s500 сом/)
  expect(screen.getByText(/Всего:/)).toHaveTextContent(/25\s500 сом/)
  expect(screen.getByText('Цены действительны до 03.12.2026')).toBeInTheDocument()
  expect(screen.getByText('Срок лечения: ориентировочно 2 месяца')).toBeInTheDocument()

  await userEvent.click(screen.getByRole('button', { name: 'Согласен с планом' }))
  expect(await screen.findByRole('status')).toHaveTextContent('Вы согласились с планом 04.11.2026')
  expect(calls).toEqual(['agree'])
  expect(screen.queryByRole('button', { name: 'Согласен с планом' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Записаться на 1-й этап' }))
  expect(await screen.findByRole('heading', { name: 'Запись к стоматологу' })).toBeInTheDocument()
})

test('Mini App на кыргызском: «Есть вопрос» — клиника перезвонит; кнопка «Мой план» внизу записи', async () => {
  fakeTelegram()
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(patient({ lang: 'ky' }))),
    http.get('*/api/patient/slots', () => HttpResponse.json({ workingDay: true, starts: [], taken: [], breaks: [] })),
    http.get('*/api/patient/plans', () => HttpResponse.json([PLAN])),
    http.post('*/api/patient/plans/5/question', () => HttpResponse.json({ ...PLAN, questionAt: '2026-11-04T05:00:00Z' })),
  )
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: /Менин дарылоо планым/ }))
  expect(await screen.findByRole('heading', { name: 'Дарылоо планы' })).toBeInTheDocument()
  expect(screen.getByRole('region', { name: '2-этап' })).toHaveTextContent('36-тиш · Коронка')
  expect(screen.getByText('Баалар 03.12.2026 чейин жарактуу')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Суроом бар — мага чалыңыз' }))
  expect(await screen.findByRole('status')).toHaveTextContent('Клиника план боюнча сизге чалат.')
})

test('страница по ссылке из WhatsApp: план по секрету из фрагмента, «Согласен»; кыргызский', async () => {
  window.history.replaceState(null, '', `/plan#${TOKEN}`)
  let agreed = false
  server.use(
    http.get(`*/web/plan/${TOKEN}`, () => HttpResponse.json(PLAN)),
    http.post(`*/web/plan/${TOKEN}/agree`, () => {
      agreed = true
      return HttpResponse.json({ ...PLAN, agreedAt: '2026-11-04T05:00:00Z' })
    }),
  )
  render(<PlanPage />)
  expect(await screen.findByRole('heading', { name: 'План лечения' })).toBeInTheDocument()
  // Записи с этой страницы нет — только согласие, вопрос и звонок
  expect(screen.queryByRole('button', { name: 'Записаться на 1-й этап' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Согласен с планом' }))
  expect(await screen.findByRole('status')).toHaveTextContent('Вы согласились с планом')
  expect(agreed).toBe(true)
  await userEvent.click(screen.getByRole('button', { name: 'Кыргызча' }))
  expect(screen.getByRole('heading', { name: 'Дарылоо планы' })).toBeInTheDocument()
  window.localStorage.clear()
})

test('страница по ссылке: чужой или истёкший секрет — «не найден»', async () => {
  window.history.replaceState(null, '', `/plan#${TOKEN}`)
  server.use(http.get(`*/web/plan/${TOKEN}`, () => HttpResponse.json({ status: 404 }, { status: 404 })))
  const first = render(<PlanPage />)
  expect(await screen.findByRole('alert')).toHaveTextContent('План не найден или уже не действует')
  first.unmount()
  // Не похоже на секрет — без запроса
  window.history.replaceState(null, '', '/plan#short')
  render(<PlanPage />)
  expect(screen.getByRole('alert')).toHaveTextContent('План не найден')
})
