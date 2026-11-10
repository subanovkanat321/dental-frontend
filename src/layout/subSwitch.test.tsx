import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { SUB_HINT_KEY } from './section'

/**
 * Телефон: подразделы — заметной строкой-переключателем под шапкой (а не текстом заголовка),
 * у коротких списков — таблетки, первый раз — подсказка. Данные вымышленные.
 */

function phone() {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('max-width: 760px'), addEventListener() {}, removeEventListener() {} }))
}

beforeEach(() => {
  phone()
  server.use(http.get('*/api/patient/me', () => HttpResponse.json(me)))
  // Подсказку уже видели — кроме теста про неё
  localStorage.setItem(SUB_HINT_KEY, 'seen')
})

afterEach(() => {
  localStorage.clear()
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
})

const pills = (title: string) => screen.queryByRole('navigation', { name: `Подразделы раздела «${title}»` })

test('строка-кнопка: раздел мелко, подраздел заголовком; сумма нового в других подразделах — бейджем; открывает лист', async () => {
  server.use(
    http.get('*/api/patient-questions/new-count', () => HttpResponse.json({ count: 2 } satisfies Schemas['QuestionControllerNewCount'])),
    http.get('*/api/waitlist', () => HttpResponse.json([{ id: 1 }, { id: 2 }, { id: 3 }] satisfies Schemas['WaitlistView'][])),
  )
  window.location.hash = '/patients/all'
  renderApp()
  // 2 вопроса + 3 в листе ожидания — в других подразделах новое: 5
  const open = await screen.findByRole('button', { name: 'Подразделы: Пациенты · Все; новое в других — 5' })
  expect(screen.getByRole('heading', { name: 'Все' })).toBeInTheDocument()
  expect(open).toHaveTextContent('Разделы · 5')
  await userEvent.click(open)
  expect(screen.getByRole('dialog', { name: 'Подразделы: Пациенты' })).toBeInTheDocument()
})

test('бейдж — только за другие подразделы: в «Вопросах» их число не повторяем', async () => {
  server.use(http.get('*/api/patient-questions/new-count', () => HttpResponse.json({ count: 2 } satisfies Schemas['QuestionControllerNewCount'])))
  window.location.hash = '/patients/questions'
  renderApp()
  expect(await screen.findByRole('button', { name: 'Подразделы: Пациенты · Вопросы' })).toBeInTheDocument()
})

test('таблетки у Пациентов: видны сразу, открытый выделен, нажатие переключает подраздел', async () => {
  window.location.hash = '/patients/booked'
  renderApp()
  await screen.findByRole('button', { name: /Подразделы: Пациенты · Записаны/ })
  const row = pills('Пациенты')!
  expect(within(row).getAllByRole('link').map((a) => a.textContent)).toEqual(['Все', 'Записаны', 'Лист ожидания', 'Позвать снова', 'Вопросы'])
  expect(within(row).getByRole('link', { name: 'Записаны' })).toHaveAttribute('aria-current', 'page')
  await userEvent.click(within(row).getByRole('link', { name: 'Лист ожидания' }))
  expect(window.location.hash).toBe('#/patients/waitlist')
  expect(await screen.findByRole('heading', { name: 'Лист ожидания' })).toBeInTheDocument()
  expect(within(pills('Пациенты')!).getByRole('link', { name: 'Лист ожидания' })).toHaveAttribute('aria-current', 'page')
  // Лист не открывался — переключили сразу
  expect(screen.queryByRole('dialog', { name: /Подразделы/ })).not.toBeInTheDocument()
})

test('у Кассы (7–8 подразделов) таблеток нет — только строка-кнопка и лист', async () => {
  window.location.hash = '/cash'
  renderApp()
  const open = await screen.findByRole('button', { name: 'Подразделы: Касса · Деньги' })
  expect(open).toHaveTextContent(/Разделы · [78]/)
  expect(pills('Касса')).not.toBeInTheDocument()
})

test('подсказка «здесь переключаются разделы» — один раз: закрыли крестиком — больше нет', async () => {
  localStorage.removeItem(SUB_HINT_KEY)
  window.location.hash = '/patients/all'
  const first = renderApp()
  const tip = await screen.findByRole('note')
  expect(tip).toHaveTextContent('Здесь переключаются разделы: Лист ожидания, Вопросы…')
  await userEvent.click(within(tip).getByRole('button', { name: 'Закрыть подсказку' }))
  expect(screen.queryByText(/Здесь переключаются разделы/)).not.toBeInTheDocument()
  expect(localStorage.getItem(SUB_HINT_KEY)).toBe('seen')
  first.unmount()

  // Другой раздел, новый запуск — подсказки нет
  window.location.hash = '/cash'
  renderApp()
  await screen.findByRole('button', { name: /Подразделы: Касса/ })
  expect(screen.queryByText(/Здесь переключаются разделы/)).not.toBeInTheDocument()
})

test('подсказка закрывается и тапом по ней, и когда открыли лист', async () => {
  localStorage.removeItem(SUB_HINT_KEY)
  window.location.hash = '/cash'
  const first = renderApp()
  await userEvent.click(await screen.findByText(/Здесь переключаются разделы/))
  expect(screen.queryByText(/Здесь переключаются разделы/)).not.toBeInTheDocument()
  first.unmount()

  localStorage.removeItem(SUB_HINT_KEY)
  await act(async () => { window.location.hash = '/stock' })
  renderApp()
  await screen.findByText(/Здесь переключаются разделы/)
  await userEvent.click(screen.getByRole('button', { name: /Подразделы: Склад/ }))
  expect(screen.queryByText(/Здесь переключаются разделы/)).not.toBeInTheDocument()
  expect(localStorage.getItem(SUB_HINT_KEY)).toBe('seen')
})
