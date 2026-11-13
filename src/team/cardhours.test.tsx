import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { waitForSlow } from '../test/wait'
import type { Weekday } from './texts'

// Часы работы — один источник правды: «Рабочее время → График». В карточке врача и сотрудника — строка-ссылка туда.
// Вымышленные врачи и сотрудники.

const doctors: Schemas['DoctorAdminView'][] = [
  { id: 1, fullName: 'Айгерим Садыкова', about: 'терапевт', active: true, telegramId: 111, role: 'ADMIN', phoneOnly: false },
  { id: 2, fullName: 'Нурболот А.', about: 'хирург', active: true, telegramId: 222, phoneOnly: false },
]
const members: Schemas['StaffMembersMemberView'][] = [
  { telegramId: 111, fullName: 'Айгерим Садыкова', role: 'ADMIN', me: true, doctor: true, phoneOnly: false, doctorIds: [] },
  { telegramId: 503, fullName: 'Асель', role: 'ASSISTANT', me: false, doctor: false, phoneOnly: false, doctorIds: [] },
]
const days = (list: Weekday[], start = '09:00:00', end = '22:00:00') => list.map((weekday) => ({ weekday, start, end }))
/** У Нурболота свои часы пн–сб 9–22, но по пятницам — еженедельный выходной (намаз) из «Перерывов и выходных». */
const nurbolot: Schemas['DoctorHoursView'] = { custom: true, days: days(['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY']) }
const clinicWeek: Schemas['DoctorHoursView'] = { custom: false, days: days(['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'], '09:00:00', '18:00:00') }
const fridayOff: Schemas['TimeOffView'] = { id: 7, doctorId: 2, weekday: 'FRIDAY', title: 'Выходной', emoji: '🕌' }

const admin: Schemas['BookingViewsMe'] = {
  ...me, doctors: doctors.map((d) => ({ id: d.id, fullName: d.fullName, active: true, telegramLinked: true })),
}

function backend(who: Schemas['BookingViewsMe'] = admin, canEdit = true) {
  server.use(
    http.get('*/web/config', () => HttpResponse.json({ botUsername: 'tish_test_bot' })),
    http.get('*/api/patient/me', () => HttpResponse.json(who)),
    http.get('*/api/doctors/admin', () => HttpResponse.json(doctors)),
    http.get('*/api/members', () => HttpResponse.json(members)),
    http.get('*/api/time-off', () => HttpResponse.json([fridayOff])),
    http.get('*/api/doctors/:id/hours', ({ params }) => HttpResponse.json(params.id === '2' ? nurbolot : clinicWeek)),
    http.get('*/api/shifts/weekly/503', () => HttpResponse.json({ telegramId: 503, ...clinicWeek } satisfies Schemas['ShiftServiceWeekly'])),
    http.get('*/api/shifts', () => HttpResponse.json({
      people: [{ telegramId: 503, fullName: 'Асель', role: 'ASSISTANT' }], shifts: [], canEdit, me: who.admin ? 111 : 222,
      weekly: [{ telegramId: 503, ...clinicWeek }],
    } satisfies Schemas['ShiftControllerSchedule'])),
  )
}

beforeEach(() => {
  window.location.hash = '/clinic/staff'
})
afterEach(() => {
  window.location.hash = ''
})

test('карточка врача: вместо редактора недели — строка «свои часы · выходной»; нажатие — «График» с его редактором', async () => {
  backend()
  const user = userEvent.setup()
  renderApp()
  await user.click(within(await screen.findByRole('table', { name: 'Персонал' })).getByRole('button', { name: 'Нурболот А.' }))
  const panel = await screen.findByRole('complementary', { name: 'Врач' })
  const link = await within(panel).findByRole('button', { name: 'Часы работы: Пн–Чт, Сб 9–22 · Пт выходной — открыть в «Рабочем времени»' })
  // Редактора в карточке нет: ни «Как у клиники / Свои часы», ни дней недели
  expect(within(panel).queryByRole('group', { name: 'Часы работы' })).not.toBeInTheDocument()
  expect(within(panel).queryByRole('button', { name: 'Свои часы' })).not.toBeInTheDocument()
  expect(within(panel).queryByRole('checkbox', { name: 'Понедельник' })).not.toBeInTheDocument()

  await user.click(link)
  expect(window.location.hash).toBe('#/clinic/hours/d2')
  const list = await screen.findByRole('table', { name: 'Обычная неделя' })
  await waitForSlow(() => expect(within(list).getByRole('button', { name: 'Нурболот А.' })).toHaveAttribute('aria-expanded', 'true'))
  // Свой врач руководителя (Айгерим) не раскрыт — открыт тот, к кому пришли
  expect(within(list).getByRole('button', { name: 'Айгерим Садыкова (вы)' })).toHaveAttribute('aria-expanded', 'false')
  const editor = await within(list).findByRole('group', { name: 'Часы работы' })
  expect(within(editor).getByRole('button', { name: 'Свои часы' })).toHaveAttribute('aria-pressed', 'true')
})

test('карточка сотрудника: «как у клиники»; нажатие открывает его неделю в «Графике»', async () => {
  backend()
  const user = userEvent.setup()
  renderApp()
  await user.click(within(await screen.findByRole('table', { name: 'Персонал' })).getByRole('button', { name: /Асель/ }))
  const panel = await screen.findByRole('complementary', { name: 'Сотрудник' })
  expect(within(panel).queryByRole('region', { name: 'Недельный график' })).not.toBeInTheDocument()
  await user.click(await within(panel).findByRole('button', { name: 'Часы работы: как у клиники — открыть в «Рабочем времени»' }))
  expect(window.location.hash).toBe('#/clinic/hours/s503')
  const list = await screen.findByRole('table', { name: 'Обычная неделя' })
  await waitForSlow(() => expect(within(list).getByRole('button', { name: 'Асель' })).toHaveAttribute('aria-expanded', 'true'))
  expect(await within(list).findByRole('button', { name: 'Как у клиники' })).toHaveAttribute('aria-pressed', 'true')
})

test('«Мой профиль» врача: строка-ссылка на свой график, там свой редактор раскрыт', async () => {
  const doctor = { ...admin, admin: false, doctorId: 2, fullName: 'Нурболот А.' }
  backend(doctor, false)
  const user = userEvent.setup()
  window.location.hash = '/me/profile'
  renderApp()
  const own = await screen.findByRole('button', { name: /^Часы работы: Пн–Чт, Сб 9–22 · Пт выходной/ })
  expect(screen.queryByRole('button', { name: 'Свои часы' })).not.toBeInTheDocument()
  await user.click(own)
  expect(window.location.hash).toBe('#/clinic/hours/d2')
  const list = await screen.findByRole('table', { name: 'Обычная неделя' })
  // Себе врач часы меняет сам — редактор раскрыт
  expect(await within(list).findByRole('button', { name: 'Свои часы' })).toHaveAttribute('aria-pressed', 'true')

})

test('права: кто не может менять — по ссылке на неделю видит её текстом, без редактора', async () => {
  backend({ ...admin, admin: false, doctorId: 2 }, false)
  window.location.hash = '/clinic/hours/s503'
  renderApp()
  const list = await screen.findByRole('table', { name: 'Обычная неделя' })
  await waitForSlow(() => expect(within(list).getByText(/^Как у клиники/, { selector: 'p' })).toBeInTheDocument())
  // Строка сотрудника — не кнопка (менять нельзя), редактора с «Свои часы» для него нет
  expect(within(list).queryByRole('button', { name: 'Асель' })).not.toBeInTheDocument()
  expect(within(list).queryAllByRole('button', { name: 'Как у клиники' })).toHaveLength(0)
})

test('«Услуги врача» → «Только выбранные»: галочка и название — одной строкой-подписью, группа — подзаголовком', async () => {
  backend()
  server.use(http.get('*/api/service-types', () => HttpResponse.json([
    { id: 1, name: 'Осмотр и консультация', group: 'THERAPY', active: true, durationMinutes: 30, priceSom: 500 },
    { id: 2, name: 'Удаление зуба', group: 'SURGERY', active: true, durationMinutes: 30, priceSom: 1500 },
  ] satisfies Schemas['ServiceTypeView'][])))
  const user = userEvent.setup()
  renderApp()
  await user.click(within(await screen.findByRole('table', { name: 'Персонал' })).getByRole('button', { name: 'Нурболот А.' }))
  const box = await screen.findByRole('region', { name: 'Услуги врача' })
  expect(box).toHaveTextContent('Цены общие — в «Услугах и ценах»; здесь — какие услуги он делает.')
  // Длинное пояснение — по «?»
  expect(box).not.toHaveTextContent('регистратура — в «Новой записи»')
  await user.click(within(box).getByRole('button', { name: 'Подробнее про услуги врача' }))
  expect(box).toHaveTextContent('регистратура — в «Новой записи»')

  await user.click(within(box).getByRole('button', { name: 'Только выбранные' }))
  const tooth = await within(box).findByRole('checkbox', { name: 'Удаление зуба' })
  // Вся строка — подпись: галочка первой, сразу за ней название
  const label = tooth.closest('label')!
  expect(label).toHaveClass('check')
  expect(label.firstElementChild).toBe(tooth)
  expect(label).toHaveTextContent(/^Удаление зуба$/)
  expect(within(box).getByRole('group', { name: 'Хирургия' })).toContainElement(label)
  await user.click(label)
  expect(tooth).toBeChecked()
})
