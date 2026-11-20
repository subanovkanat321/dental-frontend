import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { addDays, todayIn } from '../lib/time'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'

/**
 * Карточка пациента после UX-аудита 2026-11-20 (пакет 5): без плиток «Визитов / Следующий», одно пустое состояние у
 * нового, ⚠ аллергия пилюлей в шапке, «Медкарта» без заглушки, шапка ребёнка без «· 7 лет» в начале, редкое — в «⋯».
 * Пациенты вымышленные.
 */

type Card = Schemas['PatientCard']

function backend(card: Card, who: Schemas['BookingViewsMe'] = me, extra: Parameters<typeof server.use> = []) {
  const id = card.patient!.id
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(who)),
    http.get('*/api/patients/recent', () => HttpResponse.json([{ id, fullName: card.patient!.fullName, phone: card.patient!.phone, telegram: false }])),
    http.get('*/api/appointments', () => HttpResponse.json([])),
    http.get(`*/api/appointments/by-patient/${id}`, () => HttpResponse.json(card)),
    http.get(`*/api/patients/${id}/notes`, () => HttpResponse.json([])),
    http.get('*/api/patients/:id/plan/status', () => HttpResponse.json({ done: 0, total: 0, manualAgreed: false } satisfies Schemas['PlanStatesProgress'])),
    ...extra,
  )
}

beforeEach(() => {
  window.location.hash = '/patients'
})
afterEach(() => {
  window.location.hash = ''
})

const openCard = async (name: string) => {
  await userEvent.click(await screen.findByRole('button', { name }))
  return screen.findByRole('complementary', { name: 'Карточка пациента' })
}

test('новый пациент: одно пустое состояние «Ещё не был в клинике» и «Пригласить в бот», без плиток и пустых разделов', async () => {
  backend({ patient: { id: 3, fullName: 'Нурлан К.', phone: '996777555666', telegram: false }, done: 0, noShow: 0, cancelled: 0, upcoming: [], past: [] })
  renderApp()
  const panel = await openCard('Нурлан К.')
  expect(await within(panel).findByText('Ещё не был в клинике')).toBeInTheDocument()
  expect(within(panel).getByRole('button', { name: '📲 Пригласить в бот' })).toBeInTheDocument()
  for (const gone of ['Визитов', 'Следующий', 'не записан', 'Нет будущих записей', 'Визитов ещё не было', 'Предстоящие']) {
    expect(panel).not.toHaveTextContent(gone)
  }
})

test('ребёнок без своего номера: шапка «Ребёнок, 7 лет · без бота — WhatsApp», без «· 7 лет» в начале и без второго возраста', async () => {
  const birth = `${Number(todayIn().slice(0, 4)) - 7}-01-15`
  backend({
    patient: { id: 4, fullName: 'Алия Тестова', birthDate: birth, telegram: false, guardian: { fullName: 'Гульнара Тестова', relation: 'MOTHER', phone: '996777222333' } },
    done: 1, noShow: 0, cancelled: 0, upcoming: [], past: [],
  })
  renderApp()
  const panel = await openCard('Алия Тестова')
  const head = panel.querySelector('.panel-head')!
  const line = head.querySelector('.hint')!
  expect(line.textContent).toBe('без бота — WhatsApp')
  expect(head).toHaveTextContent('Ребёнок, 7 лет')
  expect(head.textContent!.match(/7 лет/g)).toHaveLength(1)
  expect(head).toHaveTextContent('Представитель: мама, Гульнара Тестова, +996 777 222 333')
})

test('аллергия — пилюлей в шапке (как в карточке приёма); «Медкарта» сразу открывает медкарту; «Предстоящие» и «Прошлые визиты»', async () => {
  const anamnesis: Schemas['AnamnesisView'] = {
    items: [{ questionId: 1, code: 'ALLERGY', section: 'QUESTION', kind: 'CHECK_TEXT', title: 'Есть аллергия?', label: 'Аллергия', alert: true, yes: true, text: 'лидокаин' }],
  }
  const start = new Date(`${addDays(todayIn(), -10)}T10:00:00+06:00`).toISOString()
  backend({
    patient: { id: 2, fullName: 'Айгуль Т.', phone: '996700333444', telegram: true }, done: 1, noShow: 0, cancelled: 0, upcoming: [],
    past: [{ id: 50, doctorId: 1, startAt: start, endAt: start, status: 'DONE', version: 0, source: 'DOCTOR', debtSom: 0, firstVisit: false, chairManual: false,
      patient: { id: 2, fullName: 'Айгуль Т.', telegram: true } }],
  }, me, [
    http.get('*/api/patients/2/anamnesis', () => HttpResponse.json(anamnesis)),
    http.get('*/api/patients/2/teeth', () => HttpResponse.json([])),
  ])
  renderApp()
  const panel = await openCard('Айгуль Т.')
  const pill = await within(panel).findByRole('button', { name: /^Важно перед лечением: Аллергия: лидокаин/ })
  expect(pill).toHaveClass('med-pill', 'danger')
  expect(pill.closest('.panel-head')).not.toBeNull()
  // Плашки с полоской слева больше нет — только пилюля (раскрыть — список)
  expect(within(panel).queryByRole('note', { name: 'Важно перед лечением' })).toBeNull()
  expect(within(panel).getByRole('heading', { name: 'Предстоящие' })).toBeInTheDocument()
  expect(panel).toHaveTextContent('Не записан')
  expect(within(panel).getByRole('heading', { name: 'Прошлые визиты' })).toBeInTheDocument()
  // Одно нажатие — и медкарта во всю ширину, без вкладки-заглушки с кнопкой
  await userEvent.click(within(panel).getByRole('tab', { name: 'Медкарта' }))
  expect(await screen.findByRole('heading', { name: 'Карта зубов' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Открыть медкарту' })).toBeNull()
})

test('«⋯» шапки: задача и лаборатория; регистратуре — без «Заказа в лабораторию»; строки ссылок под сводкой нет', async () => {
  backend({ patient: { id: 3, fullName: 'Нурлан К.', phone: '996777555666', telegram: false }, done: 0, noShow: 0, cancelled: 0, upcoming: [], past: [] },
    { ...me, admin: false, reception: true, doctorId: undefined })
  const user = userEvent.setup()
  renderApp()
  const panel = await openCard('Нурлан К.')
  await within(panel).findByText('Ещё не был в клинике')
  expect(within(panel).queryByRole('button', { name: '＋ Задача' })).toBeNull()
  await user.click(within(panel).getByRole('button', { name: 'Ещё действия' }))
  const menu = within(panel).getByRole('menu', { name: 'Ещё действия' })
  // Сверху — чьё меню; пункты — значок, подпись и подсказка (единый вид меню действий)
  expect(within(menu).getByText('Нурлан К.')).toHaveClass('menu-title')
  expect(within(menu).getAllByRole('menuitem').map((i) => i.querySelector('.menu-label')?.textContent)).toEqual(['Новая задача', 'Оформить договор'])
  for (const i of within(menu).getAllByRole('menuitem')) expect(i.querySelector('svg.menu-ico')).toHaveAttribute('aria-hidden', 'true')
})

test('P2: номер в шапке — «Связаться ▾», рядом с «＋ Записать» — значок 📞; «Прочее»: лист ожидания с подписью', async () => {
  backend({ patient: { id: 4, fullName: 'Нурлан К.', phone: '996777555666', telegram: false }, done: 0, noShow: 0, cancelled: 0, upcoming: [], past: [] },
    me, [http.get('*/api/waitlist', () => HttpResponse.json([])), http.get('*/api/patients/:id/family', () => new HttpResponse(null, { status: 204 }))])
  renderApp()
  const panel = await openCard('Нурлан К.')
  await userEvent.click(within(panel).getByRole('button', { name: 'Связаться: +996 777 555 666' }))
  expect(await screen.findByRole('menuitem', { name: /Позвонить/ })).toBeInTheDocument()
  await userEvent.keyboard('{Escape}')
  // Кнопка рядом с «＋ Записать» — значок, но имя для скринридера то же
  expect(within(panel).getByRole('button', { name: 'Связаться' })).toHaveTextContent('📞')
  await userEvent.click(within(panel).getByRole('tab', { name: 'Прочее' }))
  const waitlist = await within(panel).findByRole('region', { name: 'Лист ожидания' })
  expect(within(waitlist).getByRole('heading', { name: 'Лист ожидания' })).toBeInTheDocument()
  expect(waitlist).toHaveTextContent('освободится время')
})
