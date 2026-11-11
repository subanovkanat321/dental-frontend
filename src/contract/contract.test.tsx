import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, openItem, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { BLANK, fillContract, unknownContractVariables } from './template'
import { waitForSlow } from '../test/wait'

// Договор с пациентом (V181 бэкенда). Пациенты, клиника и реквизиты — вымышленные
type Contract = Schemas['PatientContractsView']
type Patient = Schemas['PatientView']

const PATIENT: Patient = { id: 9, fullName: 'Айжан Вымышленная', phone: '996700181009', birthDate: '1990-04-15' }

const UNSIGNED: Contract = {
  signed: false, canSign: true, title: 'Договор на оказание стоматологических услуг',
  text: 'Айжан Вымышленная, дата рождения 15.04.1990, телефон +996 700 181 009. Врач Айгерим Садыкова.',
}

function backend(start: Contract = UNSIGNED) {
  let current = start
  const forms: FormData[] = []
  const queries: string[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/patients/recent', () => HttpResponse.json([PATIENT])),
    http.get('*/api/appointments', () => HttpResponse.json([])),
    http.get('*/api/appointments/debts', () => HttpResponse.json([])),
    http.get('*/api/appointments/by-patient/:id', () => HttpResponse.json({ patient: PATIENT, done: 0, noShow: 0, cancelled: 0, upcoming: [], past: [] })),
    http.get('*/api/patients/:id/contract', ({ request }) => {
      queries.push(new URL(request.url).search)
      return HttpResponse.json(current)
    }),
    http.post('*/api/patients/:id/contract/sign', async ({ request }) => {
      const form = await request.formData()
      forms.push(form)
      current = { ...current, signed: true, signedOn: String(form.get('signedOn') ?? '2026-11-08'), signedBy: 'Айпери',
        hasSignature: form.has('signature') }
      return HttpResponse.json(current)
    }),
    http.delete('*/api/patients/:id/contract', () => {
      current = UNSIGNED
      return new HttpResponse(null, { status: 204 })
    }),
  )
  return { forms, queries }
}

async function openContract({ expand = true } = {}) {
  const user = userEvent.setup()
  renderApp()
  await user.click(await screen.findByRole('button', { name: 'Айжан Вымышленная' }))
  await user.click(await screen.findByRole('tab', { name: 'Прочее' }))
  const box = await screen.findByRole('region', { name: 'Договор' })
  if (expand) await user.click(await within(box).findByRole('button', { name: /^📄 Договор/ }))
  return { user, box }
}

beforeEach(() => {
  window.location.hash = '/patients'
})
afterEach(() => {
  window.location.hash = ''
  vi.restoreAllMocks()
})

test('подстановки шаблона: регистр не важен, пустое — линия, неизвестное — как есть', () => {
  const text = fillContract('{Пациент}, {дата  рождения}, {представитель}, {имя}', { 'пациент': 'Айжан', 'дата рождения': '15.04.1990', 'представитель': null })
  expect(text).toBe(`Айжан, 15.04.1990, ${BLANK}, {имя}`)
  expect(unknownContractVariables('{пациент} {имя} {Врач}', ['пациент', 'врач'])).toEqual(['{имя}'])
})

test('свёрнут в одну строку: «📄 Договор: не подписан», нажали — кнопки, ещё раз — снова строка', async () => {
  backend()
  const { user, box } = await openContract({ expand: false })
  const head = await within(box).findByRole('button', { name: '📄 Договор: не подписан' })
  expect(head).toHaveAttribute('aria-expanded', 'false')
  expect(within(box).queryByRole('button', { name: 'Отметить подписанным' })).not.toBeInTheDocument()

  await user.click(head)
  expect(head).toHaveAttribute('aria-expanded', 'true')
  expect(within(box).getByRole('button', { name: '✍️ Подписать на экране' })).toBeInTheDocument()
  // Врача не выбирают — его подставляет карточка
  expect(within(box).queryByLabelText('Врач в договоре')).not.toBeInTheDocument()

  await user.click(head)
  expect(head).toHaveAttribute('aria-expanded', 'false')
  expect(within(box).queryByRole('button', { name: '✍️ Подписать на экране' })).not.toBeInTheDocument()
})

test('подписанный — строка «📄 Договор подписан 08.11.2026 ✓»', async () => {
  backend({ ...UNSIGNED, signed: true, signedOn: '2026-11-08', signedBy: 'Айпери' })
  const { box } = await openContract({ expand: false })
  expect(await within(box).findByRole('button', { name: '📄 Договор подписан 08.11.2026 ✓' })).toHaveAttribute('aria-expanded', 'false')
})

test('врач в договоре: врач приёма пациента, иначе сам сотрудник-врач, иначе без врача', async () => {
  const { queries } = backend()
  server.use(http.get('*/api/appointments/by-patient/:id', () => HttpResponse.json({ patient: PATIENT, done: 1, noShow: 0, cancelled: 0,
    upcoming: [], past: [{ id: 5, doctorId: 2, patientId: 9, startAt: '2026-11-01T04:00:00Z', endAt: '2026-11-01T04:30:00Z', status: 'DONE' }] })))
  await openContract({ expand: false })
  await waitForSlow(() => expect(queries.at(-1)).toContain('doctorId=2'))
})

test('не врач и приёмов нет — договор без врача (линия на листе)', async () => {
  const { queries } = backend()
  server.use(http.get('*/api/patient/me', () => HttpResponse.json({ ...me, doctorId: undefined })))
  await openContract({ expand: false })
  await waitForSlow(() => expect(queries.length).toBeGreaterThan(0))
  expect(queries.at(-1)).not.toContain('doctorId')
})

test('карточка: «не подписан» → печать листа с текстом и линиями подписи → отметить подписанным', async () => {
  vi.spyOn(window, 'print').mockImplementation(() => {})
  const { forms, queries } = backend()
  const { user, box } = await openContract()
  // Приёмов нет — врач в договоре свой (me.doctorId): сервер подставит его имя
  expect(queries.at(-1)).toContain('doctorId=1')

  await user.click(within(box).getByRole('button', { name: '🖨 Распечатать' }))
  const sheet = await screen.findByRole('dialog', { name: 'Печать: Договор с пациентом' })
  expect(within(sheet).getByRole('heading', { name: 'Договор на оказание стоматологических услуг' })).toBeInTheDocument()
  expect(sheet).toHaveTextContent('15.04.1990')
  expect(sheet).toHaveTextContent('Пациент (законный представитель)')
  await user.click(within(sheet).getByRole('button', { name: 'Закрыть' }))

  await user.click(within(box).getByRole('button', { name: 'Отметить подписанным' }))
  await user.click(within(box).getByRole('button', { name: 'Подписан' }))
  expect(await within(box).findByRole('button', { name: /^📄 Договор подписан \d\d\.\d\d\.\d{4} ✓$/ })).toBeInTheDocument()
  expect(within(box).getByText('отметил(а) Айпери')).toBeInTheDocument()
  expect(forms[0]!.get('doctorId')).toBe('1')
  expect(forms[0]!.has('signature')).toBe(false)
  // Подписанный — скан и «Снять отметку» вместо подписи
  expect(within(box).getByRole('button', { name: '📎 Загрузить скан' })).toBeInTheDocument()
  expect(within(box).queryByRole('button', { name: '✍️ Подписать на экране' })).not.toBeInTheDocument()
})

test('подпись пальцем: пустую не отправить, нарисовали — PNG уходит вместе с отметкой', async () => {
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (callback: BlobCallback) {
    callback(new Blob(['png'], { type: 'image/png' }))
  })
  const { forms } = backend()
  const { user, box } = await openContract()
  await user.click(within(box).getByRole('button', { name: '✍️ Подписать на экране' }))
  const pad = await screen.findByRole('dialog', { name: /Подпись пациента/ })
  const done = within(pad).getByRole('button', { name: 'Готово — подписан' })
  expect(done).toBeDisabled()

  const canvas = within(pad).getByLabelText('Поле для подписи')
  fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10, pointerId: 1 })
  fireEvent.pointerMove(canvas, { clientX: 60, clientY: 30, pointerId: 1 })
  fireEvent.pointerUp(canvas, { pointerId: 1 })
  await user.click(done)

  expect(await within(box).findByRole('button', { name: /^📄 Договор подписан/ })).toBeInTheDocument()
  expect((forms[0]!.get('signature') as Blob).type).toBe('image/png')
  expect(screen.queryByRole('dialog', { name: /Подпись пациента/ })).not.toBeInTheDocument()
  expect(within(box).getByRole('button', { name: 'подпись на экране' })).toBeInTheDocument()
})

test('ассистент только смотрит: подписанный договор без кнопок отметки', async () => {
  backend({ ...UNSIGNED, signed: true, signedOn: '2026-11-08', signedBy: 'Айпери', canSign: false })
  const { box } = await openContract()
  expect(within(box).getByText('отметил(а) Айпери')).toBeInTheDocument()
  expect(within(box).queryByRole('button', { name: 'Снять отметку' })).not.toBeInTheDocument()
  expect(within(box).queryByRole('button', { name: '📎 Загрузить скан' })).not.toBeInTheDocument()
})

test('«Настройки → Договор с пациентом»: подстановка кнопкой, неизвестная — предупреждение, сохранить', async () => {
  const template: Schemas['PatientContractsTemplate'] = {
    title: 'Договор', body: 'Пациент: {пациент}.', requisites: '', custom: false,
    variables: ['клиника', 'пациент', 'дата рождения', 'реквизиты', 'врач'], defaultTitle: 'Договор', defaultBody: 'Пациент: {пациент}.',
  }
  let sent: unknown = null
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments', () => HttpResponse.json([])),
    http.get('*/api/clinic/contract-template', () => HttpResponse.json(template)),
    http.put('*/api/clinic/contract-template', async ({ request }) => {
      sent = await request.json()
      return HttpResponse.json({ ...template, ...(sent as object), custom: true })
    }),
  )
  const user = userEvent.setup()
  renderApp()
  openItem('contract')
  const form = await screen.findByRole('form', { name: 'Шаблон договора с пациентом' })
  expect(form).toHaveTextContent(/Проверьте текст у юриста/)
  expect(within(form).getByLabelText('Предпросмотр договора')).toHaveTextContent('Пациент: Айгуль Асанова.')

  const body = within(form).getByLabelText('Текст договора')
  await user.click(body)
  await user.keyboard('{End}')
  await user.click(within(form).getByRole('button', { name: '{дата рождения}' }))
  expect(body).toHaveValue('Пациент: {пациент}.{дата рождения}')
  expect(within(form).getByLabelText('Предпросмотр договора')).toHaveTextContent('15.04.1990')

  await user.type(body, ' {{имя}')
  expect(within(form).getByRole('alert')).toHaveTextContent('Неизвестная подстановка {имя}')
  expect(within(form).getByRole('button', { name: 'Сохранить' })).toBeDisabled()
  await user.clear(body)
  await user.type(body, 'Договор с {{пациент}')
  await user.type(within(form).getByLabelText(/Реквизиты клиники/), 'ИНН 00000000000000')
  await user.click(within(form).getByRole('button', { name: 'Сохранить' }))
  expect(await within(form).findByText('Шаблон договора сохранён')).toBeInTheDocument()
  expect(sent).toEqual({ title: 'Договор', body: 'Договор с {пациент}', requisites: 'ИНН 00000000000000' })
})
