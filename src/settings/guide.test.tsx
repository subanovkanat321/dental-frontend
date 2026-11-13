import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'

import type { Schemas } from '../api/client'
import { GuidePage } from './GuidePage'
import { GUIDES, ownRole } from './guides'
import { ItemHost } from './itemHost'

type Me = Schemas['BookingViewsMe']
const me = (over: Partial<Me>): Me => ({ admin: false, reception: false, doctors: [], doctor: false, owner: false, platform: false, bookingEnabled: false, daysAhead: 0, canChangeClinic: false, waiting: false, hasReception: false, hasCard: false, maxRelatives: 0, ...over }) as Me

test('своя роль первой: ассистент, врач, регистратура, администратор', () => {
  expect(ownRole(me({ assistantOf: [1], doctorId: 2 }))).toBe('assistant')
  expect(ownRole(me({ doctorId: 2, admin: true }))).toBe('doctor')
  expect(ownRole(me({ reception: true, admin: true }))).toBe('reception')
  expect(ownRole(me({ admin: true }))).toBe('admin')
})

test('«Памятка» открывается на роли сотрудника и переключается на другую', async () => {
  const back = vi.fn()
  // «Руководство» — пункт «Помощи» внизу меню: «‹ Назад» туда, откуда открыли
  render(<ItemHost.Provider value="help"><GuidePage me={me({ assistantOf: [1] })} onBack={back} /></ItemHost.Provider>)
  const roles = screen.getByRole('group', { name: 'Роль' })
  expect(within(roles).getByRole('button', { name: 'Ассистент' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('region', { name: 'Что видит ассистент' })).toHaveTextContent('Денег не видит')

  await userEvent.click(within(roles).getByRole('button', { name: 'Регистратура' }))
  expect(screen.queryByRole('region', { name: 'Что видит ассистент' })).not.toBeInTheDocument()
  expect(screen.getByRole('region', { name: /^Принять оплату/ })).toHaveTextContent('Приём состоялся')

  await userEvent.click(screen.getByRole('button', { name: '‹ Назад' }))
  expect(back).toHaveBeenCalled()
})

test('ассистенту не советуют принимать оплату — сервер ему это запрещает', () => {
  expect(GUIDES.assistant.topics.map((t) => t.title)).not.toContain('Принять оплату')
})

test('в «Памятке» — видео, как установить Tish на телефон; качается только по нажатию', () => {
  const { container } = render(<GuidePage me={me({ admin: true })} onBack={vi.fn()} />)
  expect(screen.getByRole('region', { name: 'Видео: как установить Tish на телефон' })).toBeInTheDocument()
  const video = container.querySelector('video')!
  expect(video).toHaveAttribute('preload', 'none')
  expect(video.getAttribute('src')).toMatch(/kak-ustanovit.*\.mp4/)
})

test('в «Памятке» — ссылка на Instagram Tish', () => {
  render(<GuidePage me={me({ admin: true })} onBack={vi.fn()} />)
  expect(screen.getByRole('link', { name: '@tish.app.kg' })).toHaveAttribute('href', 'https://www.instagram.com/tish.app.kg/')
})
