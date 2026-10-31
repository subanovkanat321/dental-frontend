import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { todayIn } from '../lib/time'
import { appointment, me, renderApp } from '../test/fixtures'
import { server } from '../test/server'

type Entry = Schemas['WaitlistView']

afterEach(() => {
  window.location.hash = ''
})

const aigul = { id: 2, fullName: 'Айгуль Т.', phone: '996700333444' }

function backend(start: Entry[] = []) {
  let list = [...start]
  const sent: unknown[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/patients/recent', () => HttpResponse.json([{ ...aigul, lastVisit: '2026-01-10T04:00:00Z' }])),
    http.get('*/api/appointments', () => HttpResponse.json([])),
    http.get('*/api/appointments/by-patient/2', () => HttpResponse.json({ patient: aigul, done: 1, noShow: 0, cancelled: 0, upcoming: [], past: [] })),
    http.get('*/api/appointments/debts', () => HttpResponse.json([])),
    http.get('*/api/waitlist', () => HttpResponse.json(list)),
    http.post('*/api/waitlist', async ({ request }) => {
      const body = (await request.json()) as Entry & { patientId: number }
      sent.push(body)
      list = [{ id: 7, patient: aigul, doctorId: body.doctorId, durationMinutes: body.durationMinutes, createdAt: new Date().toISOString() }]
      return HttpResponse.json(list[0], { status: 201 })
    }),
    http.delete('*/api/waitlist/:id', () => {
      list = []
      return new HttpResponse(null, { status: 204 })
    }),
  )
  return sent
}

test('карточка пациента: «В лист ожидания» на 45 минут к Дастану — затем вкладка «Лист ожидания», «Убрать»', async () => {
  window.location.hash = '/patients'
  const sent = backend()
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Айгуль Т.' }))
  const panel = await screen.findByRole('complementary', { name: 'Карточка пациента' })
  const form = await within(panel).findByRole('form', { name: 'В лист ожидания' })
  await userEvent.selectOptions(within(form).getByLabelText('Сколько нужно времени'), '45 мин')
  await userEvent.selectOptions(within(form).getByLabelText('К какому врачу'), 'Дастан Т.')
  await userEvent.click(within(form).getByRole('button', { name: 'В лист ожидания' }))
  expect(await within(panel).findByText(/В листе ожидания/)).toHaveTextContent('45 мин')
  expect(sent).toEqual([{ patientId: 2, doctorId: 2, durationMinutes: 45 }])

  await userEvent.click(screen.getByRole('tab', { name: /Лист ожидания · 1/ }))
  const table = await screen.findByRole('table', { name: 'Лист ожидания' })
  expect(table).toHaveTextContent('Дастан Т.')
  await userEvent.click(within(table).getByRole('button', { name: 'Убрать из листа: Айгуль Т.' }))
  expect(await screen.findByText(/Пока никто не ждёт/)).toBeInTheDocument()
})

test('профосмотр: WhatsApp — отметка «позвали» и готовый текст; «Записать» — «Новая запись» на пациента', async () => {
  window.location.hash = '/patients'
  backend()
  let invited = 0
  const opened: string[] = []
  vi.spyOn(window, 'open').mockImplementation((url) => { opened.push(String(url)); return null })
  server.use(
    http.get('*/api/appointments/recall', () => HttpResponse.json([{ patient: aigul, lastVisit: '2026-01-10T04:00:00Z', invitedAt: invited ? new Date().toISOString() : undefined }])),
    http.post('*/api/patients/2/recall-invited', () => {
      invited++
      return new HttpResponse(null, { status: 204 })
    }),
  )
  renderApp()
  await userEvent.click(await screen.findByRole('tab', { name: 'Профосмотр' }))
  const table = await screen.findByRole('table', { name: 'Позвать на профосмотр' })
  expect(table).toHaveTextContent('ещё не звали')
  await userEvent.click(within(table).getByRole('button', { name: 'WhatsApp' }))
  expect(opened[0]).toContain('https://wa.me/996700333444?text=')
  expect(decodeURIComponent(opened[0]!)).toContain('пора на профилактический осмотр')
  expect(decodeURIComponent(opened[0]!)).toContain('Стоматология «Тест»')
  expect(await within(table).findByText('сегодня')).toBeInTheDocument()
  expect(invited).toBe(1)

  server.use(http.get('*/api/service-types', () => HttpResponse.json([])))
  await userEvent.click(within(table).getByRole('button', { name: 'Записать' }))
  expect(await screen.findByRole('complementary', { name: 'Новая запись' })).toHaveTextContent('Айгуль Т.')
  vi.restoreAllMocks()
})

test('«Новая запись» предлагает пациентов из листа ожидания и записывает одним нажатием', async () => {
  backend([{ id: 7, patient: aigul, durationMinutes: 30, createdAt: '2026-10-20T04:00:00Z' }])
  let booked: unknown
  server.use(http.post('*/api/waitlist/7/book', async ({ request }) => {
    booked = await request.json()
    return HttpResponse.json(appointment(55, 1, '09:00', 'Айгуль Т.'))
  }))
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: '＋ Новая запись' }))
  const box = await screen.findByRole('region', { name: 'Ждут свободного времени' })
  expect(box).toHaveTextContent('Айгуль Т.')
  expect(within(box).getByRole('link', { name: 'WhatsApp' }).getAttribute('href')).toContain('wa.me/996700333444')
  await userEvent.click(within(box).getByRole('button', { name: 'Записать сюда' }))
  expect(await screen.findByRole('complementary', { name: 'Карточка приёма' })).toHaveTextContent('Айгуль Т.')
  expect(booked).toEqual({ doctorId: 1, startAt: new Date(`${todayIn()}T09:00:00+06:00`).toISOString() })
})
