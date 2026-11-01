import type { Schemas } from '../api/client'

export type PatientSource = NonNullable<Schemas['PatientView']['source']>

/** Откуда пациент узнал о клинике — подписи для формы, карточки и «Аналитики» (значения — с сервера, V66). */
export const SOURCES: [PatientSource, string][] = [
  ['INSTAGRAM', '📱 Instagram, соцсети'],
  ['RECOMMENDATION', '🤝 Посоветовали знакомые'],
  ['MAPS', '🗺️ 2ГИС, карты'],
  ['SIGN', '🏥 Увидел вывеску'],
  ['ADS', '📣 Реклама, сайты'],
  ['OTHER', 'Другое'],
]

export function sourceText(source: PatientSource | null | undefined): string {
  return SOURCES.find(([key]) => key === source)?.[1] ?? 'Не указано'
}
