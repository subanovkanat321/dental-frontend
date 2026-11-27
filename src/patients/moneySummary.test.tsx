import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'

/**
 * Вкладка «Деньги» карточки пациента: сверху «Начислено · Оплачено · Баланс» — числа с сервера (фронт их не считает),
 * баланс тоном: долг красным, аванс зелёным, ноль — «расчёт закрыт». Нет сводки в ответе (ассистент) — нет блока.
 * Пациенты вымышленные.
 */

type Card = Schemas['PatientCard']
type Money = Schemas['PatientCardMoney']

function backend(money: Money | undefined, who: Schemas['BookingViewsMe'] = me) {
  const card: Card = {
    patient: { id: 7, fullName: 'Самат Вымышленный', phone: '996777000111', telegram: false },
    done: 2, noShow: 0, cancelled: 0, access: { medical: true, money: true }, upcoming: [], past: [], paidSom: money?.paidSom, money,
  }
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(who)),
    http.get('*/api/patients/recent', () => HttpResponse.json([{ id: 7, fullName: 'Самат Вымышленный', phone: '996777000111', telegram: false }])),
    http.get('*/api/appointments', () => HttpResponse.json([])),
    http.get('*/api/appointments/by-patient/7', () => HttpResponse.json(card)),
    http.get('*/api/patients/7/notes', () => HttpResponse.json([])),
    http.get('*/api/patients/:id/plan/status', () => HttpResponse.json({ done: 0, total: 0, manualAgreed: false } satisfies Schemas['PlanStatesProgress'])),
  )
}

beforeEach(() => {
  window.location.hash = '/patients'
})
afterEach(() => {
  window.location.hash = ''
})

async function moneyTab() {
  await userEvent.click(await screen.findByRole('button', { name: 'Самат Вымышленный' }))
  const panel = await screen.findByRole('complementary', { name: 'Карточка пациента' })
  await userEvent.click(within(panel).getByRole('tab', { name: 'Деньги' }))
  return panel
}

test('долг: «Начислено 9 500 · Оплачено 6 200 · Баланс — Долг 3 300» красным, сводка над списками', async () => {
  backend({ chargedSom: 9500, paidSom: 6200, advanceSom: 0, balanceSom: -3300 })
  renderApp()
  const panel = await moneyTab()
  const summary = await within(panel).findByRole('region', { name: 'Итог по деньгам' })
  expect(summary).toHaveTextContent(/Начислено\s*9\s500 сом/)
  expect(summary).toHaveTextContent(/Оплачено\s*6\s200 сом/)
  expect(summary).toHaveTextContent(/Баланс\s*Долг\s*3\s300 сом/)
  expect(summary.querySelector('.money-balance')).toHaveClass('tone-bad')
  expect(summary).not.toHaveTextContent('С учётом аванса')
  // Сводка — первой во вкладке, списки — ниже
  expect(panel.querySelector('.patient-money')?.firstElementChild).toBe(summary)
})

test('аванс больше долгов: баланс зелёный «Аванс 1 300» и подсказка «С учётом аванса»', async () => {
  backend({ chargedSom: 9500, paidSom: 7000, advanceSom: 3800, balanceSom: 1300 })
  renderApp()
  const summary = await within(await moneyTab()).findByRole('region', { name: 'Итог по деньгам' })
  expect(summary).toHaveTextContent(/Аванс\s*1\s300 сом/)
  expect(summary.querySelector('.money-balance')).toHaveClass('tone-ok')
  expect(summary).toHaveTextContent(/С учётом аванса 3\s800 сом/)
})

test('всё оплачено: «0 сом · расчёт закрыт»', async () => {
  backend({ chargedSom: 4000, paidSom: 4000, advanceSom: 0, balanceSom: 0 })
  renderApp()
  const summary = await within(await moneyTab()).findByRole('region', { name: 'Итог по деньгам' })
  expect(summary).toHaveTextContent(/Баланс\s*0 сом\s*расчёт закрыт/)
  expect(summary.querySelector('.money-balance')).toHaveClass('tone-zero')
})

test('сервер сводку не прислал (деньги не видны) — блока нет, вкладка как раньше', async () => {
  backend(undefined)
  renderApp()
  const panel = await moneyTab()
  expect(await within(panel).findByText('Долгов нет')).toBeInTheDocument()
  expect(within(panel).queryByRole('region', { name: 'Итог по деньгам' })).not.toBeInTheDocument()
})
