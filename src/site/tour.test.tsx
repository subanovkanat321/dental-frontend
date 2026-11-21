import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import { OFFER } from '../lib/brand'
import { server } from '../test/server'
import { Tour } from './Tour'
import { TOUR_START, TOUR_STEPS } from './tourSteps'
import type { Links } from './web'

test('«Тур по Tish»: 10 шагов — скриншот с alt, заголовок, польза и «Попробовать бесплатно» → /start?from=tour', async () => {
  server.use(http.get('*/web/links', () => HttpResponse.json({ supportWhatsapp: '996770444555' } satisfies Links)))
  const { container } = render(<Tour />)
  expect(screen.getByRole('heading', { level: 1, name: 'Как клиника работает в Tish — за 10 шагов' })).toBeInTheDocument()
  expect(TOUR_STEPS).toHaveLength(10)
  const steps = within(screen.getByRole('list', { name: /Шаги/ })).getAllByRole('listitem')
  expect(steps).toHaveLength(10)
  steps.forEach((li, i) => {
    const step = TOUR_STEPS[i]!
    expect(within(li).getByRole('heading', { level: 2, name: step.title })).toBeInTheDocument()
    expect(within(li).getByText(step.text)).toBeInTheDocument()
    const img = within(li).getByRole('img', { name: step.alt })
    expect(img).toHaveAttribute('src', `/tour/${step.img}.webp`)
    // Первый скриншот — сразу, остальные — лениво: страница лёгкая
    expect(img).toHaveAttribute('loading', i === 0 ? 'eager' : 'lazy')
    expect(within(li).getByRole('link', { name: OFFER })).toHaveAttribute('href', '/start?from=tour')
  })
  // Порядок шагов — как в задаче: расписание первым, «всё включено, по-кыргызски» последним
  expect(TOUR_STEPS.map((s) => s.img)).toEqual(['raspisanie', 'kartochka', 'diktovka', 'diagnoz', 'zapis-bot', 'otzyvy', 'kassa', 'plan', 'analitika', 'kyrgyzcha'])
  // Все «Попробовать бесплатно» — регистрация с меткой тура (шапка, шаги, низ, липкая кнопка телефона)
  const tries = screen.getAllByRole('link', { name: OFFER })
  expect(tries.length).toBe(13)
  for (const a of tries) expect(a).toHaveAttribute('href', TOUR_START)
  expect(TOUR_START).toBe('/start?from=tour')
  expect(await screen.findByRole('link', { name: /Спросить в WhatsApp/ })).toHaveAttribute('href', 'https://wa.me/996770444555')
  // Срок пробного периода не называем
  expect(container.textContent).not.toMatch(/\d+\s*(дн|месяц)/)
  // alt у всех картинок, кроме значка-логотипа (он с пустым alt — декоративный)
  for (const img of container.querySelectorAll('img')) expect(img.getAttribute('alt')).not.toBeNull()
})

test('«Тур по Tish»: точки и стрелки — кнопками и клавишами ←/→, «Шаг N из 10» объявляется', async () => {
  const user = userEvent.setup()
  render(<Tour />)
  const prev = screen.getByRole('button', { name: 'Предыдущий шаг' })
  const next = screen.getByRole('button', { name: 'Следующий шаг' })
  expect(prev).toBeDisabled()
  const dots = within(screen.getByRole('group', { name: 'Перейти к шагу' })).getAllByRole('button')
  expect(dots).toHaveLength(10)
  expect(dots[0]).toHaveAttribute('aria-current', 'step')
  await user.click(next)
  expect(dots[1]).toHaveAttribute('aria-current', 'step')
  expect(screen.getByText(/^Шаг 2 из 10: /)).toBeInTheDocument()
  await user.click(dots[9]!)
  expect(next).toBeDisabled()
  expect(screen.getByText(`Шаг 10 из 10: ${TOUR_STEPS[9]!.title}`)).toBeInTheDocument()
  // Клавиатура: фокус на ленте, ← — назад
  screen.getByRole('list', { name: /Шаги/ }).focus()
  await user.keyboard('{ArrowLeft}')
  expect(dots[8]).toHaveAttribute('aria-current', 'step')
  await user.keyboard('{ArrowRight}')
  expect(dots[9]).toHaveAttribute('aria-current', 'step')
})
