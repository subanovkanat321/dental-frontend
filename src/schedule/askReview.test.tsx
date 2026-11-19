import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { appointment, contactMenu, me, pickContact, renderApp } from '../test/fixtures'
import { server } from '../test/server'

type Appointment = Schemas['AppointmentView']

const URL_R = 'https://tish.kg/r/' + 'a'.repeat(43)
const TEXT = `Спасибо, что были у нас — Стоматология «Тест»! Оцените приём одним нажатием: ${URL_R}`

/** Приём состоялся, пациент без Telegram (вымышленный). */
const visit: Appointment = appointment(10, 1, '00:05', 'Бакыт М.', { status: 'DONE', version: 1 })

function backend({ draft, asks = [] }: { draft: Schemas['ReviewLinksDraft']; asks?: Schemas['ReviewLinksCandidate'][] }) {
  const sent: number[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments', ({ request }) => HttpResponse.json(
      Number(new URL(request.url).searchParams.get('doctorId')) === 1 ? [visit] : [])),
    http.get('*/api/appointments/review-asks', () => HttpResponse.json(asks)),
    http.get('*/api/appointments/:id/review-link', () => HttpResponse.json(draft)),
    http.post('*/api/appointments/:id/review-link', ({ params }) => {
      sent.push(Number(params.id))
      return HttpResponse.json({ text: TEXT, url: URL_R, phone: '996555123456', askedAt: new Date().toISOString() } satisfies Schemas['ReviewLinksSent'])
    }),
  )
  return sent
}

beforeEach(() => {
  vi.stubGlobal('open', vi.fn())
  localStorage.clear()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

test('карточка приёма: «Связаться» → «⭐ Попросить оценку» открывает WhatsApp с текстом и ссылкой на страницу оценки', async () => {
  const sent = backend({ draft: { available: true } })
  const user = userEvent.setup()
  renderApp()
  await user.click(await screen.findByRole('button', { name: /Бакыт М\./ }))
  const panel = screen.getByRole('complementary', { name: 'Карточка приёма' })
  // Пункт появляется, когда сервер ответил, можно ли просить
  await user.click(contactMenu(panel)!)
  expect(await screen.findByRole('menuitem', { name: /^Попросить оценку/ })).toHaveTextContent('ссылка на оценку в WhatsApp')
  await user.keyboard('{Escape}')
  await pickContact(panel, 'Попросить оценку')

  expect(sent).toEqual([10])
  const url = decodeURIComponent(String(vi.mocked(window.open).mock.calls[0]?.[0]))
  expect(url).toMatch(/(wa\.me\/996555123456|api\.whatsapp\.com\/send\/\?phone=996555123456)/)
  expect(url).toContain('Оцените приём одним нажатием')
  expect(url).toContain(URL_R)
})

test('карточка приёма: просили недавно — пункт серый, под ним когда можно снова', async () => {
  backend({ draft: { available: false, reason: 'recent', message: 'Оценку у пациента уже просили 3 ноября — снова можно с 3 декабря. Часто просить неловко 🙏' } })
  const user = userEvent.setup()
  renderApp()
  await user.click(await screen.findByRole('button', { name: /Бакыт М\./ }))
  const panel = screen.getByRole('complementary', { name: 'Карточка приёма' })
  await user.click(contactMenu(panel)!)
  const item = await screen.findByRole('menuitem', { name: /^Попросить оценку/ })
  expect(item).toBeDisabled()
  expect(item).toHaveTextContent(/снова можно с 3 декабря/)
})

test('карточка приёма: уже просили — «Попросить оценку ещё раз», когда просили — мелко под пунктом', async () => {
  backend({ draft: { available: true, askedAt: new Date().toISOString() } })
  const user = userEvent.setup()
  renderApp()
  await user.click(await screen.findByRole('button', { name: /Бакыт М\./ }))
  const panel = screen.getByRole('complementary', { name: 'Карточка приёма' })
  await user.click(contactMenu(panel)!)
  expect(await screen.findByRole('menuitem', { name: /^Попросить оценку ещё раз/ })).toHaveTextContent(/попросили сегодня, в \d\d:\d\d/)
  // Отдельной кнопки и строки «Попросили …» в карточке нет
  expect(within(panel).queryByRole('button', { name: /Отправить ссылку ещё раз/ })).toBeNull()
})

test('пациент в Telegram или уже оценил — кнопки нет (бот спросит сам)', async () => {
  server.use(http.get('*/api/appointments', ({ request }) => HttpResponse.json(
    Number(new URL(request.url).searchParams.get('doctorId')) === 1
      ? [{ ...visit, rating: 5, ratingVia: 'PAGE' }] : [])),
  http.get('*/api/patient/me', () => HttpResponse.json(me)))
  const user = userEvent.setup()
  renderApp()
  await user.click(await screen.findByRole('button', { name: /Бакыт М\./ }))
  expect(await screen.findByText(/оценка пациента · по ссылке/)).toBeInTheDocument()
  await user.click(contactMenu(screen.getByRole('complementary', { name: 'Карточка приёма' }))!)
  expect(screen.getAllByRole('menuitem').map((i) => i.querySelector('.menu-text')?.firstChild?.textContent)).toEqual(['Позвонить', 'Написать в WhatsApp'])
})

test('под расписанием: «💬 Попросить отзыв у N пациентов» (не в «Требует внимания») → список с кнопкой WhatsApp у каждого', async () => {
  const sent = backend({
    draft: { available: true },
    asks: [{ appointmentId: 10, startAt: visit.startAt, doctorId: 1, patient: visit.patient }],
  })
  const user = userEvent.setup()
  renderApp()
  const line = await screen.findByRole('button', { name: /Попросить отзыв у 1 пациента без Telegram/ })
  expect(screen.queryByRole('group', { name: 'Требует внимания' })?.contains(line) ?? false).toBe(false)
  await user.click(line)
  const dialog = await screen.findByRole('dialog', { name: '⭐ Попросите оценку' })
  await user.click(within(dialog).getByRole('button', { name: 'WhatsApp: попросить оценку — Бакыт М.' }))
  expect(sent).toEqual([10])
  expect(decodeURIComponent(String(vi.mocked(window.open).mock.calls[0]?.[0]))).toContain(URL_R)
  expect(await within(dialog).findByText('✓ WhatsApp открыт')).toBeInTheDocument()
})
