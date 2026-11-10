import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, openItem, renderApp } from '../test/fixtures'
import { server } from '../test/server'

type Feed = Schemas['CalendarFeedControllerFeedView']

const URL_HTTPS = 'https://tish.test/web/calendar/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA.ics'

function backend(initial: Feed) {
  let feed = initial
  const calls: string[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/calendar-feed', () => HttpResponse.json(feed)),
    http.post('*/api/calendar-feed', () => {
      calls.push('rotate')
      feed = { enabled: true, showPatientNames: feed.showPatientNames, createdAt: '2026-11-03T05:00:00Z' }
      return HttpResponse.json({ ...feed, httpsUrl: URL_HTTPS, webcalUrl: URL_HTTPS.replace('https://', 'webcal://') } satisfies Feed)
    }),
    http.put('*/api/calendar-feed/names', async ({ request }) => {
      const body = (await request.json()) as Schemas['CalendarFeedControllerNames']
      calls.push(`names:${body.showPatientNames}`)
      feed = { ...feed, showPatientNames: body.showPatientNames }
      return HttpResponse.json(feed)
    }),
    http.delete('*/api/calendar-feed', () => {
      calls.push('off')
      feed = { enabled: false, showPatientNames: false }
      return new HttpResponse(null, { status: 204 })
    }),
  )
  return calls
}

afterEach(() => { window.location.hash = '' })

test('«Календарь в телефоне»: включить — ссылка один раз (https и webcal), инструкции для iPhone и Google', async () => {
  const calls = backend({ enabled: false, showPatientNames: false })
  renderApp()
  openItem('calendar')
  await userEvent.click(await screen.findByRole('button', { name: '📅 Включить календарь' }))

  expect(await screen.findByLabelText('Ссылка календаря')).toHaveTextContent(URL_HTTPS)
  expect(screen.getByRole('link', { name: 'Открыть в календаре' })).toHaveAttribute('href', URL_HTTPS.replace('https://', 'webcal://'))
  expect(screen.getByRole('heading', { name: 'Как подключить' }).parentElement).toHaveTextContent(/iPhone.*Google Календарь/)
  // Имена по умолчанию не показываем
  expect(screen.getByText(/Только услуга: «Приём · Пломба»/)).toBeInTheDocument()
  expect(screen.getByRole('checkbox', { name: 'Показывать имя пациента' })).not.toBeChecked()
  expect(calls).toEqual(['rotate'])
  // Ссылка — только в памяти страницы
  expect(JSON.stringify({ ...localStorage })).not.toContain('calendar')
})

test('включённый календарь: ссылки уже не видно — «Сменить ссылку» выдаёт новую, «Выключить» гасит', async () => {
  const calls = backend({ enabled: true, showPatientNames: false, createdAt: '2026-11-01T05:00:00Z' })
  renderApp()
  openItem('calendar')
  expect(await screen.findByText(/Ссылка показывается один раз/)).toBeInTheDocument()
  expect(screen.queryByLabelText('Ссылка календаря')).not.toBeInTheDocument()

  await userEvent.click(screen.getByRole('button', { name: '🔄 Сменить ссылку' }))
  expect(await screen.findByLabelText('Ссылка календаря')).toBeInTheDocument()

  await userEvent.click(screen.getByRole('button', { name: 'Выключить' }))
  expect(await screen.findByRole('button', { name: '📅 Включить календарь' })).toBeInTheDocument()
  expect(screen.queryByLabelText('Ссылка календаря')).not.toBeInTheDocument()
  expect(calls).toEqual(['rotate', 'off'])
})

test('имя пациента — только после предупреждения; «Не надо» ничего не меняет', async () => {
  const calls = backend({ enabled: true, showPatientNames: false, createdAt: '2026-11-01T05:00:00Z' })
  renderApp()
  openItem('calendar')
  const box = await screen.findByRole('checkbox', { name: 'Показывать имя пациента' })

  await userEvent.click(box)
  const warning = screen.getByRole('alertdialog', { name: 'Показывать имена пациентов?' })
  expect(warning).toHaveTextContent('уйдут в Google или Apple')
  await userEvent.click(within(warning).getByRole('button', { name: 'Не надо' }))
  expect(box).not.toBeChecked()
  expect(calls).toEqual([])

  await userEvent.click(box)
  await userEvent.click(screen.getByRole('button', { name: 'Показывать имена' }))
  expect(await screen.findByText(/Имя пациента и услуга/)).toBeInTheDocument()
  expect(box).toBeChecked()

  await userEvent.click(box)
  expect(await screen.findByText(/Только услуга/)).toBeInTheDocument()
  expect(calls).toEqual(['names:true', 'names:false'])
})

test('без своего кресла (админ, регистратура) пункта нет', async () => {
  server.use(http.get('*/api/patient/me', () => HttpResponse.json({ ...me, doctorId: undefined })))
  renderApp()
  openItem('calendar')
  // Чужой пункт по старой ссылке — вместо него «Мой профиль»; в меню «Я» календаря нет
  expect(await screen.findByRole('heading', { name: 'Мой профиль' })).toBeInTheDocument()
  expect(screen.queryByText('Календарь в телефоне')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: /^Айгерим, руководитель/ }))
  expect(within(screen.getByRole('dialog', { name: 'Я: мои настройки' })).queryByRole('button', { name: 'Календарь в телефоне' })).not.toBeInTheDocument()
})
