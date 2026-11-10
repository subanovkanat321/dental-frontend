import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import { appointment, findSub, me, openItem, querySub, renderApp } from '../test/fixtures'
import { server } from '../test/server'

/** Вымышленные сотрудники: врач Айгерим без прав админа, ассистент Дастана, регистратура. */
const doctor = { ...me, admin: false }
const assistant = { ...me, admin: false, doctorId: undefined, fullName: 'Асель', assistantOf: [2] }
const reception = { ...me, admin: false, reception: true, doctorId: undefined, fullName: 'Жанара' }

function backend(who: typeof me, list = [appointment(10, 2, '23:30', 'Бакыт М.')]) {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(who)),
    http.get('*/api/appointments', ({ request }) => {
      const doctorId = Number(new URL(request.url).searchParams.get('doctorId'))
      return HttpResponse.json(list.filter((a) => a.doctorId === doctorId))
    }),
    http.get('*/api/service-types', () => HttpResponse.json([{ id: 5, name: 'Чистка', durationMinutes: 60, active: true, priceSom: 3000 }])),
  )
}

afterEach(() => {
  window.location.hash = ''
  localStorage.clear()
})

test('врач без прав админа: в «Новой записи» — только он; пустое место у коллеги записи не открывает', async () => {
  backend(doctor)
  renderApp()
  await userEvent.click(await screen.findByRole('group', { name: 'Дастан Т.' }))
  expect(screen.queryByRole('complementary', { name: 'Новая запись' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: '＋ Новая запись' }))
  const panel = screen.getByRole('complementary', { name: 'Новая запись' })
  const select = within(panel).getByLabelText('Врач')
  await userEvent.click(select)
  expect(within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent)).toEqual(['Айгерим Садыкова'])
})

test('ассистент: без предоплаты и цен услуг, перенос — только к своему врачу, без пункта «Услуги»', async () => {
  backend(assistant)
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: /Бакыт М\./ }))
  const panel = screen.getByRole('complementary', { name: 'Карточка приёма' })
  expect(within(panel).queryByRole('button', { name: 'Попросить предоплату' })).not.toBeInTheDocument()
  await userEvent.click(within(panel).getByRole('button', { name: 'изменить' }))
  await userEvent.click(await within(panel).findByLabelText('Услуга'))
  expect(await screen.findByRole('option', { name: 'Чистка' })).toBeInTheDocument()
  await userEvent.keyboard('{Escape}')
  await userEvent.click(within(panel).getByRole('button', { name: 'Отмена' }))
  await userEvent.click(within(panel).getByRole('button', { name: 'Перенести' }))
  expect(within(panel).queryByRole('group', { name: 'Врач' })).not.toBeInTheDocument()

  // «Клиника» в меню — без пункта «Услуги и цены»
  act(() => {
    window.location.hash = '/clinic'
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  })
  expect(await findSub('Рабочее время')).toBeInTheDocument()
  expect(querySub(/^Услуги/)).not.toBeInTheDocument()
  openItem('')
  expect(await screen.findByRole('button', { name: /Памятки после процедур/ })).toBeInTheDocument()
})

test('перенос: другой врач или длительность — выбранное время сбрасывается', async () => {
  backend(me, [appointment(10, 1, '23:30', 'Бакыт М.')])
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: /Бакыт М\./ }))
  const panel = screen.getByRole('complementary', { name: 'Карточка приёма' })
  await userEvent.click(within(panel).getByRole('button', { name: 'Перенести или передать врачу' }))
  const form = within(panel).getByRole('form', { name: 'Перенос записи' })
  expect(within(form).getByText(/Приём: 23:30/)).toBeInTheDocument()
  await userEvent.click(within(within(form).getByRole('group', { name: 'Врач' })).getByRole('button', { name: 'Дастан Т.' }))
  expect(within(form).queryByText(/Приём: 23:30/)).not.toBeInTheDocument()
})

test('регистратура: в карточке пациента нет вкладки «Медкарта» — сервер её не откроет', async () => {
  backend(reception)
  server.use(
    http.get('*/api/patients/recent', () => HttpResponse.json([{ id: 3, fullName: 'Нурлан К.', phone: '996777555666' }])),
    http.get('*/api/patients/3', () => HttpResponse.json({ id: 3, fullName: 'Нурлан К.', phone: '996777555666' })),
    http.get('*/api/appointments/by-patient/3', () => HttpResponse.json([])),
    http.get('*/api/appointments/debts', () => HttpResponse.json([])),
  )
  window.location.hash = '/patients'
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Нурлан К.' }))
  const panel = await screen.findByRole('complementary', { name: 'Карточка пациента' })
  expect(await within(panel).findByRole('button', { name: '＋ Записать' })).toBeInTheDocument()
  expect(within(panel).queryByRole('tab', { name: 'Медкарта' })).not.toBeInTheDocument()
})
