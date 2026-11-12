import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import { slotInstant, todayIn } from '../lib/time'
import { appointment, me, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { choose } from '../test/select'

const DAY = '2026-11-02'

/** Часы — 10:47 по Бишкеку: время «сейчас» не кратно 5 минутам. Таймеры — настоящие, подменяем только дату. */
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(`${DAY}T10:47:00+06:00`))
})
afterEach(() => {
  vi.useRealTimers()
  localStorage.clear()
})

function backend(starts: string[] = ['11:00', '11:30'], hours: { workStart?: string; workEnd?: string } = {}) {
  const created: unknown[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments', () => HttpResponse.json([])),
    http.get('*/api/slots', () => HttpResponse.json({
      workingDay: true, breaks: [], free: [], ...hours,
      starts: starts.map((t) => slotInstant(todayIn(), Number(t.slice(0, 2)) * 60 + Number(t.slice(3)))),
    })),
    http.post('*/api/patients/search', () => HttpResponse.json([{ id: 7, fullName: 'Нурлан К.', phone: '996700111222' }])),
    http.post('*/api/appointments', async ({ request }) => {
      created.push(await request.json())
      return HttpResponse.json(appointment(99, 1, '10:45', 'Нурлан К.'), { status: 201 })
    }),
  )
  return created
}

test('пришёл без записи: «⚡ Сейчас» в 10:47 — время 10:45, поле с шагом 5 минут не мешает отправить форму', async () => {
  const created = backend()
  renderApp()
  // Отдельной кнопки «Принять сейчас» в шапке больше нет — тот же путь через «Новую запись»
  expect(await screen.findByRole('button', { name: '＋ Новая запись' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Принять сейчас|Без записи/ })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: '＋ Новая запись' }))
  const panel = screen.getByRole('complementary', { name: 'Новая запись' })
  await userEvent.click(within(panel).getByRole('button', { name: '⚡ Сейчас' }))
  const time = within(panel).getByLabelText('Время')
  expect(time).toHaveValue('10:45')
  expect((time as HTMLInputElement).checkValidity()).toBe(true)
  expect(within(panel).getByText('Пациент пришёл без записи: приём с этой минуты, без напоминаний.')).toBeInTheDocument()
  await userEvent.type(within(panel).getByLabelText('Найти пациента'), 'Нур')
  await userEvent.click(await within(panel).findByRole('button', { name: /Нурлан К\./ }))
  await userEvent.click(within(panel).getByRole('button', { name: 'Начать приём' }))
  expect(await screen.findByRole('complementary', { name: 'Карточка приёма' })).toBeInTheDocument()
  expect(created).toEqual([expect.objectContaining({ startAt: slotInstant(DAY, 10 * 60 + 45), doctorId: 1 })])
})

test('«⚡ Сейчас» подставляет сегодня и время, выбранного врача не меняет; ещё раз — обратно к выбору времени', async () => {
  backend()
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: '＋ Новая запись' }))
  const panel = screen.getByRole('complementary', { name: 'Новая запись' })
  // Выбрали другого врача — «Сейчас» ставит 10:45, а выбранного врача не меняет
  await choose(within(panel).getByLabelText('Врач'), '2')
  expect(within(panel).getByLabelText('Врач')).toHaveAttribute('data-value', '2')
  const now = within(panel).getByRole('button', { name: '⚡ Сейчас' })
  expect(now).toHaveAttribute('aria-pressed', 'false')
  await userEvent.click(now)
  expect(now).toHaveAttribute('aria-pressed', 'true')
  expect(within(panel).getByLabelText('Время')).toHaveValue('10:45')
  expect(within(panel).getByLabelText('Врач')).toHaveAttribute('data-value', '2')
  expect(within(panel).queryByRole('group', { name: 'Свободное время' })).not.toBeInTheDocument()
  expect(within(panel).getByRole('button', { name: 'Начать приём' })).toBeInTheDocument()
  // Передумали — снова выбор свободного времени, кнопка «Записать»
  await userEvent.click(now)
  expect(now).toHaveAttribute('aria-pressed', 'false')
  expect(await within(panel).findByRole('group', { name: 'Свободное время' })).toBeInTheDocument()
  expect(within(panel).getByRole('button', { name: 'Записать' })).toBeInTheDocument()
})

test('«＋ Новая запись» — время не подставлено (не 09:00, которое прошло): сетка свободного', async () => {
  backend()
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: '＋ Новая запись' }))
  const panel = screen.getByRole('complementary', { name: 'Новая запись' })
  const grid = await within(panel).findByRole('group', { name: 'Свободное время' })
  expect(within(grid).getAllByRole('button').map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'false'])
  expect(within(panel).queryByLabelText('Время', { selector: 'input' })).not.toBeInTheDocument()
  await userEvent.type(within(panel).getByLabelText('Найти пациента'), 'Нур')
  await userEvent.click(await within(panel).findByRole('button', { name: /Нурлан К\./ }))
  await userEvent.click(within(panel).getByRole('button', { name: 'Записать' }))
  expect(within(panel).getByRole('alert')).toHaveTextContent('Выберите время')
})

test('«Другое время» в 10:47 — подставлено 10:50 (вверх до 5 минут), а не текущая минута', async () => {
  backend()
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: '＋ Новая запись' }))
  const panel = screen.getByRole('complementary', { name: 'Новая запись' })
  await userEvent.click(await within(panel).findByRole('button', { name: 'Другое время' }))
  expect(within(panel).getByLabelText('Время', { selector: 'input' })).toHaveValue('10:50')
  expect(within(panel).getByText('Приём: 10:50–11:20')).toBeInTheDocument()
})

test('время не кратно 5 (окно после приёма в 10:47) — ручной ввод цифрами принимает его', async () => {
  backend([])
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: '＋ Новая запись' }))
  const panel = screen.getByRole('complementary', { name: 'Новая запись' })
  await userEvent.click(await within(panel).findByRole('button', { name: 'Другое время' }))
  const time = within(panel).getByLabelText('Время', { selector: 'input' }) as HTMLInputElement
  await userEvent.clear(time)
  await userEvent.type(time, '12:47')
  expect(time).toHaveValue('12:47')
  expect(time.checkValidity()).toBe(true)
  expect(within(panel).getByText(/Приём: 12:47–/)).toBeInTheDocument()
})

test('«Другое время»: в листе часы врача в этот день (08:00–20:00 → 08…19) и «Свободно» — те же начала, что в сетке', async () => {
  backend(['11:00', '11:30'], { workStart: '08:00:00', workEnd: '20:00:00' })
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: '＋ Новая запись' }))
  const panel = screen.getByRole('complementary', { name: 'Новая запись' })
  await userEvent.click(await within(panel).findByRole('button', { name: 'Другое время' }))
  await userEvent.click(within(panel).getByLabelText('Время', { selector: 'input' }))
  const pick = screen.getByRole('dialog', { name: 'Время: выбор времени' })
  expect(within(within(pick).getByRole('group', { name: 'Час' })).getAllByRole('button').map((b) => b.textContent)).toEqual(
    ['08', '09', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19'])
  const free = within(pick).getByRole('group', { name: 'Свободно' })
  expect(within(free).getAllByRole('button').map((b) => b.textContent)).toEqual(['11:00', '11:30'])
  await userEvent.click(within(free).getByRole('button', { name: '11:30' }))
  expect(screen.queryByRole('dialog', { name: 'Время: выбор времени' })).not.toBeInTheDocument()
  expect(within(panel).getByLabelText('Время', { selector: 'input' })).toHaveValue('11:30')
  expect(within(panel).getByText('Приём: 11:30–12:00')).toBeInTheDocument()
})

test('«Другое время» у ночной смены 18:00–08:00: часы 18…23 и 00…07', async () => {
  backend([], { workStart: '18:00:00', workEnd: '08:00:00' })
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: '＋ Новая запись' }))
  const panel = screen.getByRole('complementary', { name: 'Новая запись' })
  await userEvent.click(await within(panel).findByRole('button', { name: 'Другое время' }))
  await userEvent.click(within(panel).getByLabelText('Время', { selector: 'input' }))
  const pick = screen.getByRole('dialog', { name: 'Время: выбор времени' })
  expect(within(within(pick).getByRole('group', { name: 'Час' })).getAllByRole('button').map((b) => b.textContent)).toEqual(
    ['18', '19', '20', '21', '22', '23', '00', '01', '02', '03', '04', '05', '06', '07'])
  expect(within(pick).queryByRole('group', { name: 'Свободно' })).not.toBeInTheDocument()
})
