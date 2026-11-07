import { screen, within } from '@testing-library/react'
import type userEvent from '@testing-library/user-event'

import { dayLong, type Lang } from '../patient/i18n'

type User = ReturnType<typeof userEvent.setup>

/** Пошаговая запись: день в календаре → время в сетке (шаги «Дата» и «Время»). */
export async function pickSlot(user: User, date: string, time: string, lang: Lang = 'ru') {
  await user.click(await screen.findByRole('button', { name: dayLong(lang, date) }))
  const grid = await screen.findByRole('group', { name: lang === 'ky' ? 'Бош убакыт' : 'Свободное время' })
  await user.click(within(grid).getByRole('button', { name: time }))
}

/** Текущий шаг мастера — «Шаг 2 из 4». */
export function stepText(): string {
  return screen.getByRole('navigation', { name: /^(Шаг|\d+ кадамдын)/ }).getAttribute('aria-label') ?? ''
}
