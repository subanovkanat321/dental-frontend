import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { timelineText, timelineWho, type TimelineItem } from './timeline'

/**
 * «История» пациента (шаг 8А): живая лента в карточке — по дням, значок и короткий текст, время и кто; «Показать ещё»
 * догружает по курсору; строка с приёмом открывает приём. И «Похожие карточки» → «Объединить». Пациенты вымышленные.
 */

type Card = Schemas['PatientCard']

const card: Card = { patient: { id: 7, fullName: 'Айжан Тестова', phone: '996700000011', telegram: false }, done: 1, noShow: 0, cancelled: 0, upcoming: [], past: [] }

function backend(extra: Parameters<typeof server.use> = []) {
  server.use(
    // Свои ответы теста — первыми: из одного server.use побеждает первый подходящий
    ...extra,
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/patients/recent', () => HttpResponse.json([{ id: 7, fullName: 'Айжан Тестова', phone: '996700000011', telegram: false },
      { id: 8, fullName: 'Айжан', phone: '996700000011', telegram: true }])),
    http.get('*/api/appointments', () => HttpResponse.json([])),
    http.get('*/api/appointments/by-patient/7', () => HttpResponse.json(card)),
  )
}

const item = (over: Partial<TimelineItem> & Pick<TimelineItem, 'key' | 'kind' | 'at'>): TimelineItem => ({ byPatient: false, ...over })

beforeEach(() => {
  window.location.hash = '/patients'
})
afterEach(() => {
  window.location.hash = ''
})

test('тексты ленты: запись с переносом, отмена пациентом с причиной, оплата, оценка, кто сделал', () => {
  expect(timelineText(item({ key: 'a', kind: 'BOOKED', at: '2026-11-01T04:00:00Z', appointmentAt: '2026-11-25T08:00:00Z', previousAt: '2026-11-20T08:00:00Z' })))
    .toBe('Записали на 25 нояб, 14:00 · перенесли с 20 нояб, 14:00')
  expect(timelineText(item({ key: 'b', kind: 'CANCELLED', at: '2026-11-01T04:00:00Z', appointmentAt: '2026-11-25T08:00:00Z', byPatient: true, extra: 'ILL' })))
    .toBe('Пациент отменил запись на 25 нояб, 14:00 · заболел')
  expect(timelineText(item({ key: 'c', kind: 'PAYMENT', at: '2026-11-01T04:00:00Z', amountSom: 3000, detail: 'CASH' }))).toMatch(/^Оплата 3\s000 сом · наличные$/)
  expect(timelineText(item({ key: 'd', kind: 'RATED', at: '2026-11-01T04:00:00Z', count: 4 }))).toBe('Оценил приём: ★★★★')
  expect(timelineText(item({ key: 'e', kind: 'PLAN_STEPS', at: '2026-11-01T04:00:00Z', count: 3 }))).toBe('План лечения: 3 новых шага')
  expect(timelineText(item({ key: 'h', kind: 'LEAD', at: '2026-11-01T04:00:00Z', detail: 'CALL', extra: 'BOOKED' }))).toBe('Обращение · звонок: записан')
  expect(timelineWho(item({ key: 'f', kind: 'BIRTHDAY', at: '2026-11-01T04:00:00Z' }))).toBe('бот')
  expect(timelineWho(item({ key: 'g', kind: 'QUESTION', at: '2026-11-01T04:00:00Z', byPatient: true }))).toBe('пациент')
})

test('вкладка «История»: дни, время и кто; «Показать ещё» догружает по курсору; приём открывается', async () => {
  const before: (string | null)[] = []
  backend([
    http.get('*/api/patients/7/timeline', ({ request }) => {
      const cursor = new URL(request.url).searchParams.get('before')
      before.push(cursor)
      const page: Schemas['PatientTimelinePage'] = cursor
        ? { items: [item({ key: 'CREATED:7', kind: 'CREATED', at: '2026-09-01T04:00:00Z' })] }
        : {
            items: [
              item({ key: 'PAYMENT:1', kind: 'PAYMENT', at: '2026-10-01T04:40:00Z', appointmentId: 50, amountSom: 3000, detail: 'CASH', who: 'Айгерим' }),
              item({ key: 'DONE:50', kind: 'DONE', at: '2026-10-01T04:30:00Z', appointmentId: 50, service: 'Лечение кариеса', doctor: 'Др. Асанов' }),
            ],
            next: 'CUR1',
          }
      return HttpResponse.json(page)
    }),
    http.get('*/api/appointments/50', () => HttpResponse.json({ id: 50 })),
  ])
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Айжан Тестова' }))
  const panel = await screen.findByRole('complementary', { name: 'Карточка пациента' })
  await userEvent.click(within(panel).getByRole('tab', { name: 'История' }))

  const history = await within(panel).findByRole('region', { name: 'История пациента' })
  expect(within(history).getByRole('heading', { name: '1 окт 2026' })).toBeInTheDocument()
  expect(history).toHaveTextContent('Приём состоялся')
  expect(history).toHaveTextContent('Лечение кариеса · Др. Асанов')
  expect(history).toHaveTextContent('10:40')
  expect(history).toHaveTextContent('Айгерим')
  expect(history).not.toHaveTextContent('Завели карточку')

  await userEvent.click(within(history).getByRole('button', { name: 'Показать ещё' }))
  expect(await within(history).findByText('Завели карточку')).toBeInTheDocument()
  expect(before).toEqual([null, 'CUR1'])
  expect(within(history).queryByRole('button', { name: 'Показать ещё' })).not.toBeInTheDocument()
})

test('«Похожие карточки: 1» → предпросмотр → «Объединить»: основную можно выбрать, после — основная карточка', async () => {
  const merged: string[] = []
  const preview = (keep: number, other: number): Schemas['PatientMergesPreview'] => ({
    keep: { id: keep, fullName: keep === 7 ? 'Айжан Тестова' : 'Айжан', telegram: keep === 8 },
    other: { id: other, fullName: other === 7 ? 'Айжан Тестова' : 'Айжан', telegram: other === 8 },
    keepVisits: keep === 7 ? 1 : 3, otherVisits: keep === 7 ? 3 : 1,
    moves: [{ label: 'Записи и приёмы', count: keep === 7 ? 3 : 1 }, ...(keep === 7 ? [{ label: 'Telegram-бот', count: 1 }] : [])],
    fills: [], stays: [],
  })
  backend([
    http.get('*/api/patients/7/duplicates', () => HttpResponse.json([{ patient: { id: 8, fullName: 'Айжан', phone: '996700000011', telegram: true }, reason: 'PHONE' }] satisfies Schemas['PatientDuplicatesMatch'][])),
    http.get('*/api/patients/:id/merge/:other', ({ params }) => HttpResponse.json(preview(Number(params.id), Number(params.other)))),
    http.post('*/api/patients/:id/merge/:other', ({ params }) => {
      merged.push(`${params.id}<-${params.other}`)
      return HttpResponse.json({ id: Number(params.id), fullName: 'Айжан', telegram: true } satisfies Schemas['PatientView'])
    }),
    http.get('*/api/appointments/by-patient/8', () => HttpResponse.json({ ...card, patient: { id: 8, fullName: 'Айжан', phone: '996700000011', telegram: true } })),
  ])
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Айжан Тестова' }))
  const panel = await screen.findByRole('complementary', { name: 'Карточка пациента' })
  await userEvent.click(await within(panel).findByRole('button', { name: /Похожие карточки: 1/ }))

  const sheet = await screen.findByRole('dialog', { name: 'Объединить карточки' })
  expect(await within(sheet).findByText('Telegram-бот')).toBeInTheDocument()
  // Оставить карточку с ботом и тремя записями
  await userEvent.click(within(sheet).getByRole('radio', { name: /Айжан.*в боте/ }))
  expect(await within(sheet).findByText('Записи и приёмы')).toBeInTheDocument()
  await userEvent.click(within(sheet).getByRole('button', { name: 'Объединить' }))

  expect(merged).toEqual(['8<-7'])
  expect(await screen.findByRole('complementary', { name: 'Карточка пациента' })).toHaveTextContent('в боте')
})

test('старая ссылка на объединённую карточку: «Эта карточка объединена с другой» → «Открыть основную карточку»', async () => {
  backend([
    http.get('*/api/appointments/by-patient/7', () => HttpResponse.json({ type: 'about:blank', status: 409, detail: 'Эта карточка объединена с другой', code: 'patient-merged', patientId: 8 }, { status: 409 })),
    http.get('*/api/appointments/by-patient/8', () => HttpResponse.json({ ...card, patient: { id: 8, fullName: 'Айжан', phone: '996700000011', telegram: true } })),
  ])
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Айжан Тестова' }))
  const panel = await screen.findByRole('complementary', { name: 'Карточка пациента' })
  await userEvent.click(await within(panel).findByRole('button', { name: 'Открыть основную карточку' }))
  expect(await screen.findByRole('heading', { name: 'Айжан' })).toBeInTheDocument()
})

test('«Пациенты»: руководителю — «👥 Похожие карточки · 1» и список пар с «Объединить…»', async () => {
  backend([
    http.get('*/api/patients/duplicates', () => HttpResponse.json([{
      a: { id: 7, fullName: 'Айжан Тестова', phone: '996700000011', telegram: false }, b: { id: 8, fullName: 'Айжан', phone: '996700000011', telegram: true }, reason: 'PHONE',
    }] satisfies Schemas['PatientDuplicatesPair'][])),
  ])
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: /Похожие карточки · 1/ }))
  const list = await screen.findByRole('list', { name: 'Пары похожих карточек' })
  expect(list).toHaveTextContent('Айжан Тестова · Айжан')
  expect(list).toHaveTextContent('тот же номер, похожее имя')
  expect(within(list).getByRole('button', { name: 'Объединить…' })).toBeInTheDocument()
})
