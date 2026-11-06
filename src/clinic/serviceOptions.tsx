import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'

import { api, unwrap, type Schemas } from '../api/client'
import { groupLabel, groupServices } from './services'

type Service = Schemas['ServiceTypeView']

/** Сколько услуг в группе «Часто» — столько же отдаёт сервер (топ за 90 дней). */
const POPULAR_LIMIT = 5

/**
 * Частые услуги клиники за 90 дней (id, сначала самые частые) — группа «Часто» сверху выбора услуги.
 * Ошибка или ещё грузится — пусто: выбор работает и без неё.
 */
export function usePopularServices(enabled = true): number[] {
  const popular = useQuery({
    queryKey: ['service-popular'],
    queryFn: () => unwrap(api.GET('/api/service-types/popular')),
    staleTime: 10 * 60_000,
    enabled,
  })
  return popular.data?.ids ?? []
}

/**
 * Пункты выбора услуги для `<Select>`: «Часто» (если есть), потом разделы по порядку. text —
 * текст пункта («Лечение кариеса · 60 мин»). Функция, а не компонент: Select читает `<optgroup>`
 * и `<option>` прямо из детей.
 */
export function serviceOptions(services: Service[], popularIds: number[], text: (s: Service) => string): ReactNode {
  const popular = popularIds.map((id) => services.find((s) => s.id === id)).filter((s): s is Service => s != null)
  // Мало услуг — группы только мешают: список и так виден целиком
  const grouped = services.length > 8
  const option = (s: Service, prefix = '') => <option key={prefix + s.id} value={s.id}>{text(s)}</option>
  if (!grouped) return services.map((s) => option(s))
  return [
    popular.length > 0 && <optgroup key="popular" label="Часто">{popular.slice(0, POPULAR_LIMIT).map((s) => option(s, 'p'))}</optgroup>,
    ...groupServices(services).map(({ group, items }) => (
      <optgroup key={group} label={groupLabel(group)}>{items.map((s) => option(s))}</optgroup>
    )),
  ]
}
