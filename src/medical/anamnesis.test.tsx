import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { appointment, me, renderApp, medTab, openMedicalTab } from '../test/fixtures'
import { server } from '../test/server'

afterEach(() => {
  window.location.hash = ''
})

const anamnesis: Schemas['AnamnesisView'] = {
  items: [
    { questionId: 1, code: 'ALLERGY', section: 'QUESTION', kind: 'CHECK_TEXT', title: 'Есть аллергия?', label: 'Аллергия', alert: true, yes: true, text: 'лидокаин' },
    { questionId: 2, section: 'QUESTION', kind: 'TEXT', title: 'Заметки', alert: false, text: '' },
    { questionId: 3, section: 'DISEASE', kind: 'CHECK', title: 'Диабет', alert: true, yes: false },
  ],
}

test('медкарта: анкета с плашкой — отметить болезнь и сохранить', async () => {
  window.location.hash = '/patients'
  let saved: unknown = null
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/patients/recent', () => HttpResponse.json([{ id: 2, fullName: 'Айгуль Т.', phone: '996700333444' }])),
    http.get('*/api/appointments/by-patient/2', () => HttpResponse.json({
      patient: { id: 2, fullName: 'Айгуль Т.', phone: '996700333444' }, done: 1, noShow: 0, cancelled: 0, upcoming: [], past: [],
    })),
    http.get('*/api/appointments/debts', () => HttpResponse.json([])),
    http.get('*/api/patients/2/teeth', () => HttpResponse.json([])),
    http.get('*/api/patients/2/plan', () => HttpResponse.json([])),
    http.get('*/api/patients/2/notes', () => HttpResponse.json([])),
    http.get('*/api/patients/2/files', () => HttpResponse.json([])),
    http.get('*/api/patients/2/anamnesis', () => HttpResponse.json(anamnesis)),
    http.put('*/api/patients/2/anamnesis', async ({ request }) => {
      saved = await request.json()
      return HttpResponse.json({ ...anamnesis, updatedAt: '2026-10-31T05:00:00Z', updatedBy: 'Айгерим' })
    }),
  )
  const user = userEvent.setup()
  renderApp()
  await user.click(await screen.findByRole('button', { name: 'Айгуль Т.' }))
  // Плашка — уже в карточке пациента
  expect(await screen.findByRole('note', { name: 'Важно перед лечением' })).toHaveTextContent('Аллергия: лидокаин')
  await openMedicalTab()
  await medTab('Анкета')
  const form = await screen.findByRole('form', { name: 'Анкета пациента' })
  expect(within(form).getByRole('textbox', { name: 'Есть аллергия? — что именно' })).toHaveValue('лидокаин')
  await user.click(within(form).getByRole('checkbox', { name: 'Диабет' }))
  await user.type(within(form).getByRole('textbox', { name: 'Заметки' }), 'боится уколов')
  await user.click(within(form).getByRole('button', { name: 'Сохранить анкету' }))
  expect(await within(form).findByText('Анкета сохранена')).toBeInTheDocument()
  expect(saved).toEqual({ answers: [
    { questionId: 1, yes: true, text: 'лидокаин' },
    { questionId: 2, yes: false, text: 'боится уколов' },
    { questionId: 3, yes: true },
  ] })
})

test('карточка приёма: плашка из анкеты врачу приёма; регистратуре анкету не запрашиваем', async () => {
  const asked: string[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments', ({ request }) => HttpResponse.json(new URL(request.url).searchParams.get('doctorId') === '1' ? [appointment(10, 1, '10:00', 'Бакыт М.')] : [])),
    http.get('*/api/patients/:id/anamnesis', ({ params }) => {
      asked.push(String(params.id))
      return HttpResponse.json(anamnesis)
    }),
  )
  const user = userEvent.setup()
  renderApp()
  await user.click(await screen.findByRole('button', { name: /Бакыт М\./ }))
  const panel = screen.getByRole('complementary', { name: 'Карточка приёма' })
  expect(await within(panel).findByRole('note', { name: 'Важно перед лечением' })).toHaveTextContent('Аллергия: лидокаин')
  expect(asked).toEqual(['10'])
})
