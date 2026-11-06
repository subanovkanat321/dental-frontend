import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { createQueryClient } from '../api/queryClient'
import { childText } from '../lib/age'
import { dentitionByAge, isToothNumber, toothAt } from './dentition'
import { MedicalRecord } from './MedicalRecord'
import { ToothGlyph } from './ToothGlyph'
import { server } from '../test/server'

// Молочные зубы и прикус на карте зубов (V163 бэкенда). Пациенты вымышленные
type Tooth = Schemas['ToothView']
type Patient = Schemas['PatientView']

/** Дата рождения, по которой сегодня полных {years} лет: 31 декабря позапрошлого от нужного года. */
function bornYearsAgo(years: number): string {
  return `${new Date().getFullYear() - years - 1}-12-31`
}

function backend(initial: Tooth[] = []) {
  const teeth = [...initial]
  const dentitionCalls: unknown[] = []
  server.use(
    http.get('*/api/patients/7/teeth', () => HttpResponse.json(teeth)),
    http.put('*/api/patients/7/dentition', async ({ request }) => {
      const body = (await request.json()) as Schemas['ChartControllerDentitionRequest']
      dentitionCalls.push(body)
      return HttpResponse.json({ id: 7, fullName: 'Вымышленная Аружан', dentition: body.dentition } satisfies Patient)
    }),
    http.get('*/api/patients/7/plan', () => HttpResponse.json([])),
    http.get('*/api/patients/7/teeth/history', () => HttpResponse.json([])),
    http.get('*/api/patients/7/notes', () => HttpResponse.json([])),
    http.get('*/api/patients/7/files', () => HttpResponse.json([])),
    http.get('*/api/patients/7/anamnesis', () => HttpResponse.json({})),
    http.get('*/api/anamnesis/questions', () => HttpResponse.json([])),
    http.get('*/api/service-types', () => HttpResponse.json([])),
  )
  return dentitionCalls
}

function open(patient: Patient, readOnly = false) {
  const client = createQueryClient({ queries: { retry: false } })
  render(<QueryClientProvider client={client}>
    <MedicalRecord patient={patient} onBack={() => {}} readOnly={readOnly} />
  </QueryClientProvider>)
}

test('прикус по возрасту: до 6 — молочные, 6–12 — сменный, старше и без даты — постоянные', () => {
  expect(dentitionByAge('2022-03-01', '2026-11-06')).toBe('PRIMARY')
  expect(dentitionByAge('2020-11-07', '2026-11-06')).toBe('PRIMARY')
  expect(dentitionByAge('2020-11-06', '2026-11-06')).toBe('MIXED')
  expect(dentitionByAge('2013-11-07', '2026-11-06')).toBe('MIXED')
  expect(dentitionByAge('2013-11-06', '2026-11-06')).toBe('PERMANENT')
  expect(dentitionByAge(undefined, '2026-11-06')).toBe('PERMANENT')
})

test('номера: молочные 51–85 — зубы, 56, 59, 19, 99 — нет; сменный — молочный, пока он есть', () => {
  for (const n of [51, 55, 61, 65, 71, 75, 81, 85, 11, 48]) expect(isToothNumber(n)).toBe(true)
  for (const n of [56, 59, 50, 19, 99, 90]) expect(isToothNumber(n)).toBe(false)
  expect(toothAt(11, 'PRIMARY')).toBe(51)
  expect(toothAt(16, 'PRIMARY')).toBeNull()
  expect(toothAt(45, 'MIXED')).toBe(85)
  expect(toothAt(16, 'MIXED')).toBe(16)
  // Молочный выпал или постоянный уже отмечен на карте — на этом месте постоянный
  expect(toothAt(11, 'MIXED', [{ number: 51, state: 'MISSING' }])).toBe(11)
  expect(toothAt(21, 'MIXED', [{ number: 21, state: 'HEALTHY' }])).toBe(21)
})

test('бейдж ребёнка: до 18 лет по дате рождения', () => {
  expect(childText('2019-03-01', '2026-11-06')).toBe('Ребёнок, 7 лет')
  expect(childText('2025-10-01', '2026-11-06')).toBe('Ребёнок, 1 год')
  expect(childText('2008-11-06', '2026-11-06')).toBeNull()
  expect(childText(undefined, '2026-11-06')).toBeNull()
})

test('молочный зуб рисуется меньше и формой ближайшего постоянного: 4–5 — моляры', () => {
  const { container, unmount } = render(<ToothGlyph number={54} />)
  const svg = container.querySelector('svg')!
  expect(svg).toHaveAttribute('data-shape', 'molar3')
  expect(svg).toHaveAttribute('data-primary', 'true')
  expect(container.querySelector('g')!.getAttribute('transform')).toContain('scale(0.6708')
  unmount()
  const lower = render(<ToothGlyph number={83} />)
  expect(lower.container.querySelector('svg')).toHaveAttribute('data-shape', 'canine')
  lower.unmount()
  const permanent = render(<ToothGlyph number={14} />)
  expect(permanent.container.querySelector('svg')).toHaveAttribute('data-shape', 'premolar2')
  expect(permanent.container.querySelector('svg')).not.toHaveAttribute('data-primary')
})

test('ребёнок 4 лет: карта открывается молочными зубами, по возрасту', async () => {
  backend([{ number: 54, state: 'CARIES', surfaces: ['O'] }])
  open({ id: 7, fullName: 'Вымышленная Аружан', birthDate: bornYearsAgo(4) })
  expect(await screen.findByRole('button', { name: 'Зуб 54: Кариес (О)' })).toBeInTheDocument()
  expect(screen.getAllByRole('button', { name: /^Зуб \d+:/ })).toHaveLength(20)
  expect(screen.queryByRole('button', { name: /^Зуб 16:/ })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Молочные' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByText('по возрасту, 4 года')).toBeInTheDocument()
})

test('переключатель: «Сменный» сохраняется у пациента; выпавший молочный — постоянный на его месте; «↺ по возрасту»', async () => {
  const calls = backend([{ number: 51, state: 'MISSING' }])
  open({ id: 7, fullName: 'Вымышленная Аружан', birthDate: bornYearsAgo(4) })
  await screen.findByRole('button', { name: /^Зуб 55:/ })
  await userEvent.click(screen.getByRole('button', { name: 'Сменный' }))
  await waitFor(() => expect(calls).toEqual([{ dentition: 'MIXED' }]))
  expect(screen.getAllByRole('button', { name: /^Зуб \d+:/ })).toHaveLength(32)
  expect(screen.getByRole('button', { name: /^Зуб 16:/ })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /^Зуб 55:/ })).toBeInTheDocument()
  // 51 удалён — на его месте 11
  expect(screen.getByRole('button', { name: /^Зуб 11:/ })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /^Зуб 51:/ })).not.toBeInTheDocument()

  await userEvent.click(await screen.findByRole('button', { name: '↺ по возрасту' }))
  await waitFor(() => expect(calls).toEqual([{ dentition: 'MIXED' }, {}]))
  expect(await screen.findByRole('button', { name: 'Молочные' })).toHaveAttribute('aria-pressed', 'true')
})

test('сохранённый прикус важнее возраста; ассистент переключает только у себя', async () => {
  const calls = backend()
  open({ id: 7, fullName: 'Вымышленный Эмир', birthDate: bornYearsAgo(9), dentition: 'PERMANENT' }, true)
  expect(await screen.findByRole('button', { name: /^Зуб 18:/ })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Постоянные' })).toHaveAttribute('aria-pressed', 'true')
  await userEvent.click(screen.getByRole('button', { name: 'Молочные' }))
  expect(await screen.findByRole('button', { name: /^Зуб 85:/ })).toBeInTheDocument()
  expect(calls).toEqual([])
})
