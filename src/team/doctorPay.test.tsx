import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'

type Pay = Schemas['PayRequisitesDoctorPay']

/** «Как оплатить мне» в «Моём профиле» врача (V225 бэкенда): реквизиты и QR. Врач и реквизиты — вымышленные. */
beforeEach(() => {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/me/phone', () => HttpResponse.json({ phoneOnly: false, sms: true, telegram: true } satisfies Schemas['MyPhoneControllerMyPhone'])),
    http.get('*/api/appointments', () => HttpResponse.json([])),
    http.get('*/api/doctors/admin', () => HttpResponse.json([{ id: 1, fullName: 'Айгерим Садыкова', active: true, telegramId: 111, role: 'ADMIN', phoneOnly: false }] satisfies Schemas['DoctorAdminView'][])),
  )
})
afterEach(() => {
  window.location.hash = ''
})

test('врач на аренде: «Как оплатить мне» сохраняет текст, QR загружается и удаляется', async () => {
  let pay: Pay = { hasQr: false, ownRevenue: true }
  const sent: unknown[] = []
  const uploads: string[] = []
  server.use(
    http.get('*/api/doctors/1/pay', () => HttpResponse.json(pay)),
    http.put('*/api/doctors/1/pay', async ({ request }) => {
      const body = await request.json() as { details: string }
      sent.push(body)
      pay = { ...pay, details: body.details }
      return HttpResponse.json(pay)
    }),
    http.post('*/api/doctors/1/pay/qr', async ({ request }) => {
      const file = (await request.formData()).get('file') as File
      uploads.push(file.name)
      pay = { ...pay, hasQr: true, payUrl: `https://tish.kg/pay/${'a'.repeat(43)}` }
      return HttpResponse.json(pay)
    }),
    http.get('*/api/doctors/1/pay/qr', () => new HttpResponse(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { headers: { 'Content-Type': 'image/png' } })),
    http.delete('*/api/doctors/1/pay/qr', () => {
      pay = { ...pay, hasQr: false, payUrl: undefined }
      return HttpResponse.json(pay)
    }),
  )
  window.location.hash = '/settings/profile'
  const user = userEvent.setup()
  renderApp()
  const card = await screen.findByRole('complementary', { name: 'Врач' })
  const group = await within(card).findByRole('group', { name: 'Как оплатить мне' })
  expect(group).toHaveTextContent('Напоминание о долге за ваши приёмы уйдёт с этими реквизитами')

  await user.type(within(group).getByRole('textbox', { name: 'Как оплатить мне' }), 'MBANK 0555 123 456 (Айгерим С.)')
  await user.click(within(group).getByRole('button', { name: 'Сохранить реквизиты' }))
  expect(await within(group).findByText('Реквизиты сохранены')).toBeInTheDocument()
  expect(sent).toEqual([{ details: 'MBANK 0555 123 456 (Айгерим С.)' }])

  await user.upload(within(group).getByLabelText('QR для оплаты'), new File([new Uint8Array([0x89, 0x50])], 'qr.png', { type: 'image/png' }))
  expect(await within(group).findByText('Заменить QR')).toBeInTheDocument()
  expect(await within(group).findByRole('img', { name: 'QR для оплаты' })).toBeInTheDocument()
  expect(uploads).toHaveLength(1)
  await user.click(within(group).getByRole('button', { name: 'Удалить QR' }))
  expect(await within(group).findByText('Загрузить QR')).toBeInTheDocument()
})

test('врач на проценте: подсказка — пациенту уйдут реквизиты клиники', async () => {
  window.location.hash = '/settings/profile'
  renderApp()
  const group = await screen.findByRole('group', { name: 'Как оплатить мне' })
  expect(group).toHaveTextContent('Выручку собирает клиника, поэтому в напоминании о долге — реквизиты клиники')
})
