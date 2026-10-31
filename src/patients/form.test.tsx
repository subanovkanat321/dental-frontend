import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'

beforeEach(() => {
  window.location.hash = '/patients'
})
afterEach(() => {
  window.location.hash = ''
})

const card = (p: Schemas['PatientView']) => ({ patient: p, done: 0, noShow: 0, cancelled: 0, upcoming: [], past: [] })

test('новый пациент: такой номер уже есть — «это другой человек», потом карточка', async () => {
  const bodies: Schemas['PatientRequest'][] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/patients/recent', () => HttpResponse.json([])),
    http.get('*/api/appointments/debts', () => HttpResponse.json([])),
    http.post('*/api/patients', async ({ request }) => {
      const body = await request.json() as Schemas['PatientRequest']
      bodies.push(body)
      if (!body.allowDuplicate) {
        return HttpResponse.json({ status: 409, code: 'duplicate-patient', detail: 'Пациент с этим номером уже есть',
          patient: { id: 5, fullName: 'Айгуль С.', phone: '996700111222' } }, { status: 409 })
      }
      return HttpResponse.json({ id: 9, fullName: body.fullName, phone: '996700111222' }, { status: 201 })
    }),
    http.get('*/api/appointments/by-patient/9', () => HttpResponse.json(card({ id: 9, fullName: 'Айгуль Т.', phone: '996700111222' }))),
  )
  const user = userEvent.setup()
  renderApp()
  await user.click(await screen.findByRole('button', { name: '＋ Новый пациент' }))
  const form = screen.getByRole('form', { name: 'Новый пациент' })
  await user.type(within(form).getByRole('textbox', { name: 'Имя пациента' }), 'Айгуль Т.')
  await user.type(within(form).getByRole('textbox', { name: 'Телефон' }), '700 111 222')
  await user.click(within(form).getByRole('button', { name: 'Сохранить' }))
  expect(await within(form).findByRole('alert')).toHaveTextContent('Пациент с этим номером уже есть: Айгуль С., +996 700 111 222')
  await user.click(within(form).getByRole('button', { name: 'Это другой человек — создать' }))
  expect(await screen.findByRole('complementary', { name: 'Карточка пациента' })).toHaveTextContent('Айгуль Т.')
  expect(bodies.map((b) => [b.phone, b.allowDuplicate])).toEqual([['+996 700 111 222', false], ['+996 700 111 222', true]])
})

test('карточка пациента: изменить место работы', async () => {
  let saved: unknown = null
  const p = { id: 2, fullName: 'Айгуль Т.', phone: '996700333444' }
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/patients/recent', () => HttpResponse.json([p])),
    http.get('*/api/appointments/debts', () => HttpResponse.json([])),
    http.get('*/api/appointments/by-patient/2', () => HttpResponse.json(card(p))),
    http.put('*/api/patients/2', async ({ request }) => {
      saved = await request.json()
      return HttpResponse.json({ ...p, workplace: 'школа №5' })
    }),
  )
  const user = userEvent.setup()
  renderApp()
  await user.click(await screen.findByRole('button', { name: 'Айгуль Т.' }))
  const panel = screen.getByRole('complementary', { name: 'Карточка пациента' })
  await user.click(await within(panel).findByRole('button', { name: 'Изменить данные пациента' }))
  const form = within(panel).getByRole('form', { name: 'Данные пациента' })
  expect(within(form).getByRole('textbox', { name: 'Телефон' })).toHaveValue('700 333 444')
  await user.type(within(form).getByRole('textbox', { name: 'Место работы' }), 'школа №5')
  await user.click(within(form).getByRole('button', { name: 'Сохранить' }))
  expect(await within(panel).findByRole('button', { name: 'Изменить данные пациента' })).toBeInTheDocument()
  expect(saved).toEqual({ fullName: 'Айгуль Т.', phone: '+996 700 333 444', allowDuplicate: false, workplace: 'школа №5' })
})
