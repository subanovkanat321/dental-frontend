import { render, screen, within } from '@testing-library/react'

import { About } from './About'

test('сайт-визитка /about: герой, части ролика, заявка и контакты — кликабельные ссылки', () => {
  render(<About />)
  expect(screen.getByRole('heading', { level: 1, name: 'Сколько пациентов вы теряете, потому что не успели ответить?' })).toBeInTheDocument()
  expect(screen.getByText(/программа для стоматологии, которая работает за вас круглосуточно/)).toBeInTheDocument()
  // Первый экран — пункты из ролика v6
  for (const point of [/Самозапись 24\/7/, /ИИ-помощник/, /Расписание, медкарта, касса, зарплата и склад/, /Перенесём ваши данные/,
    /помогает зарабатывать больше/]) {
    expect(screen.getByText(point, { selector: 'strong' })).toBeInTheDocument()
  }
  // Части из ролика v4 — сверху вниз
  for (const title of [/не только на лечении/, /Пациент записывается сам/, /Вся клиника — на одном экране/, /Врач не печатает/,
    /настоящие зубы/, /Зуб в разрезе/, /Вся история/, /деньги, которые уже ваши/, /В цифрах/, /свои права/, /частному врачу/]) {
    expect(screen.getByRole('heading', { level: 2, name: title })).toBeInTheDocument()
  }
  // «Попробовать бесплатно» — на форму заявки /join
  const tries = screen.getAllByRole('link', { name: 'Попробовать бесплатно' })
  expect(tries.length).toBeGreaterThanOrEqual(3)
  for (const a of tries) expect(a).toHaveAttribute('href', '/join#form')

  const contacts = within(screen.getByRole('region', { name: /Меньше рутины/ }))
  expect(contacts.getByRole('link', { name: /Instagram @tish\.app\.kg/ })).toHaveAttribute('href', 'https://www.instagram.com/tish.app.kg/')
  expect(contacts.getByRole('link', { name: /Telegram @veratti_16/ })).toHaveAttribute('href', 'https://t.me/veratti_16')
  const wa = contacts.getByRole('link', { name: /WhatsApp 0773 565 895/ })
  expect(wa.getAttribute('href')).toMatch(/^https:\/\/wa\.me\/996773565895\?text=/)
  expect(decodeURIComponent(new URL(wa.getAttribute('href')!).search)).toContain('Хочу узнать про Tish для клиники')
  expect(contacts.getByRole('link', { name: /Телефон 0558 162 998/ })).toHaveAttribute('href', 'tel:+996558162998')
  // Внешние ссылки — в новой вкладке и без доступа к нашей странице
  expect(wa).toHaveAttribute('rel', 'noopener noreferrer')
})

test('сайт-визитка: ролик v6 с бэкенда — только по нажатию, картинки грузятся лениво', () => {
  const { container } = render(<About />)
  const imgs = [...container.querySelectorAll('img')].filter((i) => i.getAttribute('src')?.includes('/about/'))
  expect(imgs.length).toBeGreaterThan(10)
  for (const img of imgs) expect(img.getAttribute('alt')).not.toBe('')
  for (const img of imgs) expect(img).toHaveAttribute('loading', 'lazy')
  const video = container.querySelector('video')!
  expect(video).toHaveAttribute('preload', 'none')
  expect(video).toHaveAttribute('playsinline')
  expect(video).toHaveAttribute('controls')
  expect(video).toHaveAttribute('poster', '/web/materials/public/promo.png')
  expect(video.querySelector('source')).toHaveAttribute('src', '/web/materials/public/promo.mp4')
})
