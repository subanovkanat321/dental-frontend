import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { contactPhone, guardianLine } from '../lib/guardian'
import { reminderText } from '../lib/texts'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'

// Ребёнок и представитель (V164 бэкенда). Люди и номера вымышленные
type Patient = Schemas['PatientView']

function birthYearsAgo(years: number): string {
  return `${new Date().getFullYear() - years - 1}-12-31`
}

function backend(patient: Patient, extra: Parameters<typeof server.use> = []) {
  let current = patient
  const sent: unknown[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/patients/recent', () => HttpResponse.json([current])),
    http.get('*/api/appointments', () => HttpResponse.json([])),
    http.get('*/api/patients/:id/family', () => new HttpResponse(null, { status: 204 })),
    http.get('*/api/appointments/debts', () => HttpResponse.json([])),
    http.get('*/api/appointments/by-patient/:id', () => HttpResponse.json({ patient: current, done: 0, noShow: 0, cancelled: 0, upcoming: [], past: [] })),
    http.put('*/api/patients/:id/guardian', async ({ request }) => {
      const body = (await request.json()) as Schemas['PatientControllerGuardianRequest']
      sent.push(body)
      current = { ...current, guardian: { fullName: body.fullName, relation: body.relation, phone: body.phone?.replace(/\D/g, '') || undefined } }
      return HttpResponse.json(current)
    }),
    ...extra,
  )
  return sent
}

beforeEach(() => {
  window.location.hash = '/patients'
})
afterEach(() => {
  window.location.hash = ''
})

test('карточка ребёнка: бейдж по дате рождения и строка представителя', async () => {
  backend({ id: 5, fullName: 'Аружан Вымышленная', phone: '996700164001', birthDate: birthYearsAgo(7),
    guardian: { fullName: 'Айгуль', relation: 'MOTHER' }, telegram: false })
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Аружан Вымышленная' }))
  const card = await screen.findByRole('complementary', { name: 'Карточка пациента' })
  expect(await within(card).findByText('Ребёнок, 7 лет')).toBeInTheDocument()
  expect(within(card).getByText('Представитель: мама, Айгуль, +996 700 164 001')).toBeInTheDocument()
})

test('добавить представителя: имя, кем приходится, свой номер', async () => {
  const sent = backend({ id: 5, fullName: 'Эмир Вымышленный', phone: '996700164001', birthDate: birthYearsAgo(9), telegram: false })
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Эмир Вымышленный' }))
  await userEvent.click(await screen.findByRole('tab', { name: 'Прочее' }))
  const box = await screen.findByRole('region', { name: 'Представитель' })
  await userEvent.click(within(box).getByRole('button', { name: '＋ Добавить представителя' }))
  await userEvent.type(within(box).getByLabelText('Имя представителя'), 'Бакыт')
  await userEvent.click(within(box).getByRole('combobox', { name: 'Кем приходится' }))
  await userEvent.click(await screen.findByRole('option', { name: 'папа' }))
  await userEvent.type(within(box).getByLabelText('Телефон представителя'), '555164002')
  await userEvent.click(within(box).getByRole('button', { name: 'Сохранить' }))
  expect(sent).toEqual([{ fullName: 'Бакыт', relation: 'FATHER', phone: '+996 555164002' }])
  expect(await screen.findByText('Представитель: папа, Бакыт, +996 555 164 002')).toBeInTheDocument()
})

test('напоминание в WhatsApp ребёнку — представителю: его номер, обращение к нему, «Запись ребёнка»', () => {
  const patient: Patient = { fullName: 'Аружан', phone: '996555000001', guardian: { fullName: 'Айгуль', relation: 'MOTHER', phone: '996700164001' }, id: 0, telegram: false }
  expect(contactPhone(patient)).toBe('996700164001')
  expect(contactPhone({ ...patient, guardian: { fullName: 'Айгуль', relation: 'MOTHER' } })).toBe('996555000001')
  expect(guardianLine({ phone: '996555000001' })).toBeNull()
  const startAt = new Date(Date.now() + 3 * 86400000).toISOString()
  expect(reminderText({ startAt, patient })).toMatch(/^Здравствуйте, Айгуль! 👋 Запись ребёнка Аружан: .* приём у стоматолога/)
  expect(reminderText({ startAt, patient }, { reminderTemplate: '{имя}, ждём вас {когда}' }))
    .toMatch(/^👶 Запись ребёнка Аружан\nАйгуль, ждём вас /)
  // Без представителя — как раньше
  expect(reminderText({ startAt, patient: { fullName: 'Аружан' } })).toMatch(/^Здравствуйте, Аружан! 👋 Напоминаем: /)
})
