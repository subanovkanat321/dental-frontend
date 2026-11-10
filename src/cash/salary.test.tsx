import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp, findSub } from '../test/fixtures'
import { server } from '../test/server'
import { choose } from '../test/select'

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
  const asel: Row = { assistantId: 7201, doctor: 'Асель', position: 'ассистент', percent: 10, baseSom: 5000, revenueSom: 70000, dueSom: 12000, paidSom: 0 }
  const zhamila: Row = { assistantId: 7203, doctor: 'Жамиля', position: 'регистратура', percent: 0, baseSom: 20000, revenueSom: 90000, dueSom: 20000, paidSom: 20000 }
  const sent: unknown[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments/debts', () => HttpResponse.json([])),
    http.get('*/api/salaries', () => HttpResponse.json([aigerim, dastan, asel, zhamila])),
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
  await user.click(await findSub('Зарплата'))

  const aCard = await screen.findByRole('region', { name: 'Зарплата: Айгерим Садыкова' })
  expect(aCard).toHaveTextContent('Условия: 40% от выручки')
  expect(within(aCard).getByText('✅ Выплачено')).toBeInTheDocument()

  const card = screen.getByRole('region', { name: 'Зарплата: Дастан Т.' })
  expect(card).toHaveTextContent('Условия не заданы')
  // Условий нет — подсказка «Как работает зарплата» открыта, кнопка заметная
  expect(screen.getByText('Как работает зарплата').closest('details')).toHaveAttribute('open')
  await user.click(within(card).getByRole('button', { name: '⚙️ Задать процент и оклад' }))
  await user.click(within(card).getByRole('button', { name: '30%' }))
  await user.type(within(card).getByLabelText('Оклад в месяц, сом'), '10000')
  expect(within(card).getByLabelText('Процент от выручки, %')).toHaveValue('30')
  expect(within(card).getByLabelText('Пример расчёта')).toHaveTextContent(/= 25\s000 сом/)
  await user.click(within(card).getByRole('button', { name: 'Сохранить' }))
  expect(await within(card).findByText('Условия: 30% от выручки + оклад 10 000 сом')).toBeInTheDocument()
  expect(screen.getByLabelText('Осталось выплатить')).toHaveTextContent(/37\s000 сом/)
  // Ассистент — процент от выручки его врачей
  const aselCard = screen.getByRole('region', { name: 'Зарплата: Асель' })
  expect(aselCard).toHaveTextContent('· ассистент')
  expect(aselCard).toHaveTextContent('10% от выручки его врачей + оклад 5 000 сом')
  expect(aselCard).toHaveTextContent('Выручка врачей')
  // Регистратура — своя строка: обычно только оклад, процент — от выручки всей клиники
  const zhamilaCard = screen.getByRole('region', { name: 'Зарплата: Жамиля' })
  expect(zhamilaCard).toHaveTextContent('· регистратура')
  expect(zhamilaCard).toHaveTextContent('Условия: оклад 20 000 сом')
  expect(zhamilaCard).toHaveTextContent('Выручка клиники')

  await user.click(within(card).getByRole('button', { name: /Выплатить 25\s000 сом/ }))
  expect(within(card).getByLabelText('Сумма выплаты, сом')).toHaveValue('25000')
  await user.click(within(card).getByRole('button', { name: 'Выплачено' }))
  expect(await within(card).findByText('✅ Выплачено')).toBeInTheDocument()
  expect(sent).toEqual([{ percent: 30, baseSom: 10000, rentSom: 0, rentPercent: 0, byTimesheet: false }, { month: expect.stringMatching(/^\d{4}-\d{2}$/), amountSom: 25000 }])
})

test('бывший сотрудник: выплата месяца осталась в истории, без «Условий» и «Выплатить»', async () => {
  const former: Row = { assistantId: 7202, doctor: 'Бермет (больше не работает)', percent: 0, baseSom: 0, revenueSom: 0, dueSom: 0, paidSom: 8000, former: true }
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments/debts', () => HttpResponse.json([])),
    http.get('*/api/salaries', () => HttpResponse.json([former])),
  )
  const user = userEvent.setup()
  renderApp()
  await user.click(await findSub('Зарплата'))
  const card = await screen.findByRole('region', { name: 'Зарплата: Бермет (больше не работает)' })
  // Кем работал — уже не пишем: имя и так говорит «больше не работает»
  expect(card).not.toHaveTextContent('· ассистент')
  expect(card).toHaveTextContent(/Выплачено8\s000 сом/)
  expect(card).toHaveTextContent('выплата за этот месяц сохранена в истории')
  expect(within(card).queryByRole('button', { name: /условия|процент и оклад/ })).not.toBeInTheDocument()
  expect(within(card).queryByRole('button', { name: /Выплатить/ })).not.toBeInTheDocument()
})

test('калькулятор зарплаты: свои цифры, минус материалы, выручка из строки — ничего не отправляет', async () => {
  const aigerim: Row = { doctorId: 1, doctor: 'Айгерим Садыкова', percent: 40, baseSom: 5000, revenueSom: 20000, dueSom: 13000, paidSom: 0 }
  const sent: unknown[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments/debts', () => HttpResponse.json([])),
    http.get('*/api/salaries', () => HttpResponse.json([aigerim])),
    http.put('*/api/salaries/:id', () => { sent.push('put'); return HttpResponse.json(aigerim) }),
  )
  const user = userEvent.setup()
  renderApp()
  await user.click(await findSub('Зарплата'))
  await screen.findByRole('region', { name: 'Зарплата: Айгерим Садыкова' })

  const calc = screen.getByText('Калькулятор зарплаты').closest('details')!
  expect(calc).not.toHaveAttribute('open')
  await user.click(screen.getByText('Калькулятор зарплаты'))
  const c = within(calc)
  await user.type(c.getByLabelText('Выручка, сом'), '200000')
  await user.type(c.getByLabelText('Процент, %'), '30')
  await user.type(c.getByLabelText('Оклад, сом'), '10000')
  expect(c.getByLabelText('Результат калькулятора')).toHaveTextContent(/10\s000 сом \+ 30% × 200\s000 сом = 70\s000 сом/)
  await user.type(c.getByLabelText('Вычесть материалы/техника, сом'), '20000')
  expect(c.getByLabelText('Результат калькулятора')).toHaveTextContent(/10\s000 сом \+ 30% × \(200\s000 сом − 20\s000 сом\) = 64\s000 сом/)
  // Честная подсказка: сервер материалы не вычитает
  expect(c.getByText(/материалы и техника он не вычитает/)).toBeInTheDocument()

  // Выручка и условия — из строки сотрудника (материалы остаются)
  await choose(c.getByRole('combobox', { name: 'Взять выручку и условия' }), 'Айгерим Садыкова')
  expect(c.getByLabelText('Выручка, сом')).toHaveValue('20000')
  expect(c.getByLabelText('Результат калькулятора')).toHaveTextContent(/5\s000 сом \+ 40% × \(20\s000 сом − 20\s000 сом\) = 5\s000 сом/)
  await user.clear(c.getByLabelText('Вычесть материалы/техника, сом'))
  expect(c.getByLabelText('Результат калькулятора')).toHaveTextContent(/= 13\s000 сом/)
  expect(sent).toEqual([])
})

test('условия у каждого свои: «Вся выручка — врачу (100%)» и «Только оклад» одной кнопкой', async () => {
  let dastan: Row = { doctorId: 2, doctor: 'Дастан Т.', percent: 0, baseSom: 0, revenueSom: 50000, dueSom: 0, paidSom: 0 }
  const sent: unknown[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments/debts', () => HttpResponse.json([])),
    http.get('*/api/salaries', () => HttpResponse.json([dastan])),
    http.put('*/api/salaries/2', async ({ request }) => {
      const body = (await request.json()) as { percent: number; baseSom: number }
      sent.push(body)
      dastan = { ...dastan, percent: body.percent, baseSom: body.baseSom, dueSom: body.baseSom + Math.round(50000 * body.percent / 100) }
      return HttpResponse.json(dastan)
    }),
  )
  const user = userEvent.setup()
  renderApp()
  await user.click(await findSub('Зарплата'))
  const card = await screen.findByRole('region', { name: 'Зарплата: Дастан Т.' })
  await user.click(within(card).getByRole('button', { name: '⚙️ Задать процент и оклад' }))
  await user.click(within(card).getByRole('button', { name: 'Вся выручка — врачу (100%)' }))
  expect(within(card).getByLabelText('Пример расчёта')).toHaveTextContent(/= 50\s000 сом/)
  await user.click(within(card).getByRole('button', { name: 'Сохранить' }))
  expect(await within(card).findByText('Условия: вся выручка — врачу (100%)')).toBeInTheDocument()
  expect(sent).toEqual([{ percent: 100, baseSom: 0, rentSom: 0, rentPercent: 0, byTimesheet: false }])
})

test('аренда кресла: пресет «частный врач», сумма в месяц — «к выплате» за вычетом аренды', async () => {
  let dastan: Row = { doctorId: 2, doctor: 'Дастан Т.', percent: 0, baseSom: 0, revenueSom: 50000, dueSom: 0, paidSom: 0 }
  const sent: unknown[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments/debts', () => HttpResponse.json([])),
    http.get('*/api/salaries', () => HttpResponse.json([dastan])),
    http.put('*/api/salaries/2', async ({ request }) => {
      sent.push(await request.json())
      dastan = { ...dastan, percent: 100, earnedSom: 50000, rentFixedSom: 20000, rentPercent: 0, rentSom: 20000, dueSom: 30000, owesSom: 0 }
      return HttpResponse.json(dastan)
    }),
  )
  const user = userEvent.setup()
  renderApp()
  await user.click(await findSub('Зарплата'))
  const card = await screen.findByRole('region', { name: 'Зарплата: Дастан Т.' })
  await user.click(within(card).getByRole('button', { name: '⚙️ Задать процент и оклад' }))
  const preset = within(card).getByRole('button', { name: 'Частный врач: вся выручка — врачу, минус аренда' })
  await user.click(preset)
  expect(preset).toHaveAttribute('aria-pressed', 'true')
  expect(within(card).getByLabelText('Процент от выручки, %')).toHaveValue('100')
  await user.type(within(card).getByLabelText('Аренда в месяц, сом'), '20000')
  expect(within(card).getByLabelText('Пример расчёта')).toHaveTextContent(/100% от 50\s000 сом − аренда 20\s000 сом = 30\s000 сом/)
  await user.click(within(card).getByRole('button', { name: 'Сохранить' }))
  expect(await within(card).findByText('Условия: вся выручка — врачу (100%), минус аренда кресла 20 000 сом в месяц')).toBeInTheDocument()
  expect(card).toHaveTextContent(/Аренда кресла−20\s000 сом/)
  expect(card).toHaveTextContent(/К выплате30\s000 сом/)
  expect(sent).toEqual([{ percent: 100, baseSom: 0, rentSom: 20000, rentPercent: 0, byTimesheet: false }])
})

test('аренда процентом в форме; аренда больше заработка — «врач должен клинике», получено от врача', async () => {
  let dastan: Row = {
    doctorId: 2, doctor: 'Дастан Т.', percent: 50, baseSom: 0, revenueSom: 50000, earnedSom: 25000,
    rentFixedSom: 40000, rentPercent: 0, rentSom: 40000, dueSom: 0, owesSom: 15000, rentReceivedSom: 0, paidSom: 0,
  }
  const sent: unknown[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments/debts', () => HttpResponse.json([])),
    http.get('*/api/salaries', () => HttpResponse.json([dastan])),
    http.post('*/api/salaries/2/rent', async ({ request }) => {
      sent.push(await request.json())
      dastan = { ...dastan, rentReceivedSom: 15000 }
      return HttpResponse.json(dastan)
    }),
  )
  const user = userEvent.setup()
  renderApp()
  await user.click(await findSub('Зарплата'))
  const card = await screen.findByRole('region', { name: 'Зарплата: Дастан Т.' })
  // Отрицательной выплаты нет: «врач должен клинике», и «Выплатить» не предлагаем
  expect(within(card).getByLabelText('Врач должен клинике')).toHaveTextContent(/15\s000 сом/)
  expect(card).toHaveTextContent(/Аренда кресла \(40\s000 сом\) больше заработка врача за месяц \(25\s000 сом\)/)
  expect(within(card).queryByRole('button', { name: /Выплатить/ })).not.toBeInTheDocument()

  await user.click(within(card).getByRole('button', { name: 'Получено от врача…' }))
  expect(within(card).getByLabelText('Сколько врач принёс, сом')).toHaveValue('15000')
  await user.click(within(card).getByRole('button', { name: 'Получено' }))
  expect(await within(card).findByText('✅ Аренда получена')).toBeInTheDocument()
  expect(sent).toEqual([{ month: expect.stringMatching(/^\d{4}-\d{2}$/), amountSom: 15000 }])

  // Форма условий: аренда процентом — подсказка считает от той же выручки, минус — «должен клинике»
  await user.click(within(card).getByRole('button', { name: '⚙️ Изменить условия' }))
  expect(within(card).getByLabelText('Аренда в месяц, сом')).toHaveValue('40000')
  expect(within(card).getByLabelText('Пример расчёта')).toHaveTextContent(/= врач должен клинике 15\s000 сом/)
  await choose(within(card).getByRole('combobox', { name: 'Аренда кресла' }), 'Процент от выручки врача')
  await user.type(within(card).getByLabelText('Аренда, % от выручки'), '10')
  expect(within(card).getByLabelText('Пример расчёта')).toHaveTextContent(/− аренда 5\s000 сом = 20\s000 сом/)
})
