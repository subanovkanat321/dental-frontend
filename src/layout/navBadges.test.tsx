import { act, render, screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { warmSections } from '../test/wait'
import { NavCount } from './NavCount'
import { WAITLIST_SEEN_KEY } from './waitlistSeen'

/**
 * Красные точки-счётчики в меню (шаг 6А): один компонент NavCount на все места; «Вопросы пациентов» и просроченные
 * «Задачи» — всегда красные, «Лист ожидания» — красный, пока в нём есть новые с прошлого захода. Данные вымышленные.
 */

beforeAll(warmSections, 60_000)

const nav = () => screen.getByRole('navigation', { name: 'Разделы' })
const tabs = (title: string) => screen.findByRole('navigation', { name: `Подразделы: ${title}` })
const go = (hash: string) => act(() => {
  window.location.hash = hash
  window.dispatchEvent(new HashChangeEvent('hashchange'))
})

beforeEach(() => {
  server.use(http.get('*/api/patient/me', () => HttpResponse.json(me)))
})

afterEach(() => {
  localStorage.clear()
  window.history.replaceState(null, '', '/')
})

describe('NavCount', () => {
  test('ноль — ничего; заметное — красное (без quiet), тихое — серое; больше 99 — «99+»', () => {
    const { container, rerender } = render(<NavCount n={0} loud />)
    expect(container).toBeEmptyDOMElement()
    rerender(<NavCount n={3} loud />)
    expect(container.firstChild).toHaveClass('nav-count')
    expect(container.firstChild).not.toHaveClass('quiet')
    expect(container.firstChild).toHaveAttribute('aria-hidden', 'true')
    rerender(<NavCount n={3} loud={false} />)
    expect(container.firstChild).toHaveClass('nav-count', 'quiet')
    rerender(<NavCount badge n={120} loud label="Пациенты: новое — 120" />)
    expect(screen.getByLabelText('Пациенты: новое — 120')).toHaveClass('nav-badge')
    expect(screen.getByLabelText('Пациенты: новое — 120')).toHaveTextContent('99+')
  })
})

test('вопросы и просроченные задачи — красные; лист ожидания без новых — серым числом всех', async () => {
  localStorage.setItem(WAITLIST_SEEN_KEY, '2026-11-11T00:00:00Z')
  const waiting: Schemas['WaitlistView'][] = [1, 2].map((id) => ({ id, doctorId: 1, patient: { id, fullName: `Ожидает ${id}`, telegram: false },
    durationMinutes: 30, createdAt: '2026-11-01T08:00:00Z' }))
  server.use(
    http.get('*/api/patient-questions/new-count', () => HttpResponse.json({ count: 3 })),
    http.get('*/api/tasks/summary', () => HttpResponse.json({ overdue: 1 })),
    http.get('*/api/waitlist', () => HttpResponse.json(waiting)),
  )
  window.location.hash = '/patients/all'
  renderApp()
  const row = await tabs('Пациенты')
  const badge = async (name: string) => within(await within(row).findByRole('link', { name })).getByText(/^\d+$/)
  expect(await badge('Вопросы · 3')).not.toHaveClass('quiet')
  expect(await badge('Задачи · 1')).not.toHaveClass('quiet')
  expect(await badge('Лист ожидания · 2')).toHaveClass('quiet')
  // В меню у раздела — сумма, красная (есть заметное)
  expect(within(nav()).getByLabelText('Пациенты: новое — 6')).not.toHaveClass('quiet')
})

test('лист ожидания: новые с прошлого захода — красным числом новых; открыли лист — снова серым числом всех', async () => {
  localStorage.setItem(WAITLIST_SEEN_KEY, '2026-11-10T00:00:00Z')
  const waiting: Schemas['WaitlistView'][] = [
    { id: 1, doctorId: 1, patient: { id: 1, fullName: 'Давний Тестов', telegram: false }, durationMinutes: 30, createdAt: '2026-11-01T08:00:00Z' },
    { id: 2, doctorId: 1, patient: { id: 2, fullName: 'Новая Тестова', telegram: false }, durationMinutes: 30, createdAt: '2026-11-11T05:00:00Z' },
  ]
  server.use(http.get('*/api/waitlist', () => HttpResponse.json(waiting)))
  window.location.hash = '/patients/all'
  renderApp()
  const row = await tabs('Пациенты')
  const link = await within(row).findByRole('link', { name: 'Лист ожидания · 1' })
  expect(within(link).getByText('1')).not.toHaveClass('quiet')

  go('/patients/waitlist')
  await screen.findByRole('heading', { name: 'Лист ожидания' })
  go('/patients/all')
  const again = await within(await tabs('Пациенты')).findByRole('link', { name: 'Лист ожидания · 2' })
  expect(within(again).getByText('2')).toHaveClass('quiet')
  expect(Date.parse(localStorage.getItem(WAITLIST_SEEN_KEY)!)).toBeGreaterThanOrEqual(Date.parse('2026-11-11T05:00:00Z'))
})

test('первый заход: отметки нет — прежний лист не загорается красным, в хранилище ничего не пишем', async () => {
  const waiting: Schemas['WaitlistView'][] = [
    { id: 1, doctorId: 1, patient: { id: 1, fullName: 'Давний Тестов', telegram: false }, durationMinutes: 30, createdAt: '2026-11-01T05:00:00Z' },
  ]
  server.use(http.get('*/api/waitlist', () => HttpResponse.json(waiting)))
  window.location.hash = '/patients/all'
  renderApp()
  const link = await within(await tabs('Пациенты')).findByRole('link', { name: 'Лист ожидания · 1' })
  expect(within(link).getByText('1')).toHaveClass('quiet')
  expect(localStorage.getItem(WAITLIST_SEEN_KEY)).toBeNull()
})
