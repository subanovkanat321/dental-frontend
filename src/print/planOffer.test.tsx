import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { addDays, todayIn } from '../lib/time'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'

type Step = Schemas['TreatmentStepView']
type Offer = Schemas['PlanOffersOfferView']

/** Вымышленный пациент: план в два этапа (1 — каналы и чистка, 2 — коронка). */
const PLAN: Step[] = [
  { id: 1, tooth: 36, title: 'Лечение каналов', priceSom: 8000, stage: 1 },
  { id: 2, title: 'Профчистка', priceSom: 2500, stage: 1 },
  { id: 3, tooth: 36, title: 'Коронка', priceSom: 15000, stage: 2 },
]

function backend({ telegram = true, plan = PLAN }: { telegram?: boolean; plan?: Step[] } = {}) {
  const calls: unknown[] = []
  let offers: Offer[] = []
  let steps = plan
  const patient = { id: 2, fullName: 'Айгуль Т.', phone: '996700333444', telegram }
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments', () => HttpResponse.json([])),
    http.get('*/api/patients/recent', () => HttpResponse.json([patient])),
    http.get('*/api/appointments/by-patient/2', () => HttpResponse.json({ patient, done: 1, noShow: 0, cancelled: 0, upcoming: [], past: [] })),
    http.get('*/api/appointments/debts', () => HttpResponse.json([])),
    http.get('*/api/patients/2/teeth', () => HttpResponse.json([])),
    http.get('*/api/patients/2/files', () => HttpResponse.json([])),
    http.get('*/api/patients/2/plan', () => HttpResponse.json(steps)),
    http.get('*/api/service-types', () => HttpResponse.json([
      { id: 7, name: 'Имплант', durationMinutes: 60, active: true, priceSom: 30000 },
    ] satisfies Schemas['ServiceTypeView'][])),
    http.post('*/api/patients/2/plan', async ({ request }) => {
      const body = await request.json() as Schemas['ChartControllerStep']
      calls.push({ add: body })
      steps = [...steps, { id: 9, tooth: body.tooth, title: body.title, priceSom: body.priceSom, stage: body.stage ?? 1, serviceTypeId: body.serviceTypeId }]
      return HttpResponse.json(steps)
    }),
    http.put('*/api/patients/2/plan/:stepId', async ({ request, params }) => {
      const body = await request.json() as Schemas['ChartControllerStep']
      calls.push({ put: Number(params.stepId), stage: body.stage })
      steps = steps.map((s) => (s.id === Number(params.stepId) ? { ...s, stage: body.stage } : s))
      return HttpResponse.json(steps)
    }),
    http.get('*/api/patients/2/plan/offers', () => HttpResponse.json(offers)),
    http.post('*/api/patients/2/plan/offers', async ({ request }) => {
      const body = await request.json() as Schemas['PlanOffersSendRequest']
      calls.push({ send: body })
      if (body.channel === 'TELEGRAM' && !telegram) {
        return HttpResponse.json({ status: 409, code: 'not-delivered', detail: 'Пациент не записывался через бота — отправьте в WhatsApp' }, { status: 409 })
      }
      const offer: Offer = { id: 5, sentAt: new Date().toISOString(), channel: body.channel, totalSom: 25500, validUntil: body.validUntil, active: true }
      offers = [offer]
      return HttpResponse.json({
        offer, text: body.channel === 'WHATSAPP' ? '🦷 Ваш план лечения\n\nОткрыть план и согласиться: https://tish.example/plan#x' : undefined,
        url: 'https://tish.example/plan#x',
      } satisfies Schemas['PlanOffersSent'])
    }),
  )
  return { calls, agree: () => { offers = offers.map((o) => ({ ...o, agreedAt: new Date().toISOString() })) } }
}

async function openMedical() {
  window.location.hash = '/patients'
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Айгуль Т.' }))
  await userEvent.click(await screen.findByRole('button', { name: 'Медкарта и снимки' }))
  await screen.findByRole('heading', { name: 'Медкарта · Айгуль Т.' })
}

beforeEach(() => {
  vi.stubGlobal('open', vi.fn())
})
afterEach(() => {
  vi.unstubAllGlobals()
  window.location.hash = ''
})

test('план по этапам: заголовки «Этап 1 · 10 500 сом», смена этапа у шага, новый шаг из прайса', async () => {
  const { calls } = backend()
  await openMedical()
  const list = await screen.findByRole('list', { name: 'Этапы лечения' })
  expect(list).toHaveTextContent(/Этап 1 · 10\s500 сом/)
  expect(list).toHaveTextContent(/Этап 2 · 15\s000 сом/)

  await userEvent.click(within(list).getByRole('button', { name: 'Изменить этап: Профчистка' }))
  await userEvent.click(screen.getByRole('combobox', { name: 'Этап лечения этого шага' }))
  await userEvent.click(screen.getByRole('option', { name: 'Этап 2' }))
  await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
  await vi.waitFor(() => expect(calls).toContainEqual({ put: 2, stage: 2 }))

  const form = screen.getByRole('form', { name: 'Новый этап' })
  await userEvent.click(within(form).getByRole('combobox', { name: 'Услуга из прайса' }))
  await userEvent.click(screen.getByRole('option', { name: /Имплант/ }))
  expect(within(form).getByRole('textbox', { name: 'Что сделать' })).toHaveValue('Имплант')
  expect(within(form).getByRole('spinbutton', { name: 'Цена, сом' })).toHaveValue(30000)
  await userEvent.type(within(form).getByRole('textbox', { name: 'Зуб' }), '46')
  await userEvent.click(within(form).getByRole('combobox', { name: 'Этап лечения' }))
  await userEvent.click(screen.getByRole('option', { name: 'Этап 3' }))
  await userEvent.click(within(form).getByRole('button', { name: '＋ Добавить в план' }))
  await vi.waitFor(() => expect(calls).toContainEqual({ add: { title: 'Имплант', tooth: 46, priceSom: 30000, stage: 3, serviceTypeId: 7 } }))
})

test('«Отправить план пациенту»: предпросмотр с итогами по этапам, срок, цены до…, в Telegram — статус', async () => {
  const { calls } = backend()
  await openMedical()
  await userEvent.click(await screen.findByRole('button', { name: 'Отправить план пациенту' }))
  const panel = screen.getByRole('region', { name: 'План пациенту' })
  const preview = within(panel).getByLabelText('Предпросмотр плана')
  expect(preview).toHaveTextContent('Ваш план лечения')
  expect(within(preview).getByRole('table', { name: 'Этап 1' })).toHaveTextContent(/Зуб 36Лечение каналов8\s000 сом/)
  expect(preview).toHaveTextContent(/Итого за этап: 10\s500 сом/)
  expect(preview).toHaveTextContent(/Всего: 25\s500 сом/)
  expect(preview).toHaveTextContent('Врач: Айгерим Садыкова')
  const until = addDays(todayIn(), 30)
  expect(preview).toHaveTextContent(`Цены действительны до ${until.split('-').reverse().join('.')}`)
  await userEvent.type(within(panel).getByRole('textbox', { name: 'Срок лечения, ориентировочно' }), '2 месяца')
  expect(preview).toHaveTextContent('Срок лечения: ориентировочно 2 месяца')

  await userEvent.click(within(panel).getByRole('button', { name: 'Отправить в Telegram' }))
  expect(await screen.findByRole('status')).toHaveTextContent('План отправлен в Telegram')
  expect(calls).toContainEqual({ send: { channel: 'TELEGRAM', validUntil: until, duration: '2 месяца' } })
  expect(await screen.findByLabelText('Статус плана')).toHaveTextContent(/Отправлен .* в Telegram · ждём ответа · 25\s500 сом/)
})

test('нет Telegram — WhatsApp главной кнопкой, текст со ссылкой на план', async () => {
  const { calls } = backend({ telegram: false })
  await openMedical()
  await userEvent.click(await screen.findByRole('button', { name: 'Отправить план пациенту' }))
  const panel = screen.getByRole('region', { name: 'План пациенту' })
  expect(within(panel).queryByRole('button', { name: 'Отправить в Telegram' })).not.toBeInTheDocument()
  await userEvent.click(within(panel).getByRole('button', { name: 'WhatsApp' }))
  expect(await screen.findByRole('status')).toHaveTextContent('Открыли WhatsApp')
  expect(calls).toContainEqual({ send: expect.objectContaining({ channel: 'WHATSAPP' }) })
  expect(window.open).toHaveBeenCalledWith(expect.stringContaining(encodeURIComponent('https://tish.example/plan#x')), '_blank', 'noopener')
})

test('статус согласованного плана в медкарте', async () => {
  const { agree } = backend()
  server.use(http.get('*/api/patients/2/plan/offers', () => HttpResponse.json([
    { id: 5, sentAt: '2026-11-03T05:00:00Z', channel: 'TELEGRAM', totalSom: 25500, agreedAt: '2026-11-04T05:00:00Z', active: true },
  ] satisfies Offer[])))
  agree()
  await openMedical()
  expect(await screen.findByLabelText('Статус плана')).toHaveTextContent(/Отправлен 3 нояб?\.? 2026 в Telegram · согласован 4 нояб?\.? 2026/)
})
