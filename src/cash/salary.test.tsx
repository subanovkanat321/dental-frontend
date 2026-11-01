import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'

type Row = Schemas['SalaryControllerSalaryRow']

beforeEach(() => {
  window.location.hash = '/cash'
})
afterEach(() => {
  window.location.hash = ''
})

test('зарплата: условия 30% + оклад, к выплате, выплатить — расход', async () => {
  // Вымышленные врачи; сервер считает сам, тест только отвечает тем, что сервер бы вернул
  let dastan: Row = { doctorId: 2, doctor: 'Дастан Т.', percent: 0, baseSom: 0, revenueSom: 50000, dueSom: 0, paidSom: 0 }
  const aigerim: Row = { doctorId: 1, doctor: 'Айгерим Садыкова', percent: 40, baseSom: 0, revenueSom: 20000, dueSom: 8000, paidSom: 8000 }
  const sent: unknown[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments/debts', () => HttpResponse.json([])),
    http.get('*/api/salaries', () => HttpResponse.json([aigerim, dastan])),
    http.put('*/api/salaries/2', async ({ request }) => {
      sent.push(await request.json())
      dastan = { ...dastan, percent: 30, baseSom: 10000, dueSom: 25000 }
      return HttpResponse.json(dastan)
    }),
    http.post('*/api/salaries/2/pay', async ({ request }) => {
      sent.push(await request.json())
      dastan = { ...dastan, paidSom: 25000 }
      return HttpResponse.json(dastan)
    }),
  )
  const user = userEvent.setup()
  renderApp()
  await user.click(await screen.findByRole('tab', { name: 'Зарплата' }))

  const aCard = await screen.findByRole('region', { name: 'Зарплата: Айгерим Садыкова' })
  expect(aCard).toHaveTextContent('40% от выручки')
  expect(within(aCard).getByText('✅ Выплачено')).toBeInTheDocument()

  const card = screen.getByRole('region', { name: 'Зарплата: Дастан Т.' })
  expect(card).toHaveTextContent('Условия не заданы')
  await user.click(within(card).getByRole('button', { name: 'Условия' }))
  await user.type(within(card).getByLabelText('Процент от выручки'), '30')
  await user.type(within(card).getByLabelText('Оклад в месяц, сом'), '10000')
  await user.click(within(card).getByRole('button', { name: 'Сохранить' }))
  expect(await within(card).findByText('30% от выручки + оклад 10 000 сом')).toBeInTheDocument()
  expect(screen.getByLabelText('Осталось выплатить')).toHaveTextContent(/25\s000 сом/)

  await user.click(within(card).getByRole('button', { name: /Выплатить 25\s000 сом/ }))
  expect(within(card).getByLabelText('Сумма выплаты, сом')).toHaveValue('25000')
  await user.click(within(card).getByRole('button', { name: 'Выплачено' }))
  expect(await within(card).findByText('✅ Выплачено')).toBeInTheDocument()
  expect(sent).toEqual([{ percent: 30, baseSom: 10000 }, { month: expect.stringMatching(/^\d{4}-\d{2}$/), amountSom: 25000 }])
})
