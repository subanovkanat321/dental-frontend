import { useQuery } from '@tanstack/react-query'

import { api, unwrap, type Schemas } from '../api/client'

export type SourceOption = Schemas['PatientSourcesOption']

/**
 * «Откуда узнал о клинике» — список своей клиники (V110 бэкенда): эмодзи и название, порядок и
 * скрытые варианты задаёт админ в «Настройки → Откуда узнают о клинике». Один запрос на все экраны.
 */
export function useSources() {
  return useQuery({ queryKey: ['patient-sources'], queryFn: () => unwrap(api.GET('/api/patient-sources')), staleTime: 5 * 60_000 })
}

export function sourceLabel(o: { emoji?: string; title?: string } | null | undefined): string {
  return o?.title ? `${o.emoji ?? ''} ${o.title}`.trim() : 'Не указано'
}

export function sourceText(list: SourceOption[] | undefined, id: number | null | undefined): string {
  return id == null ? 'Не указано' : sourceLabel(list?.find((o) => o.id === id))
}

/**
 * Пункты выпадающего списка: видимые варианты и тот, что уже стоит у пациента, даже скрытый, —
 * чтобы правка карточки его не сбросила. Подпись — с эмодзи, скрытый — с пометкой.
 */
export function sourceChoices(list: SourceOption[] | undefined, current?: number | null): { id: number; label: string }[] {
  return (list ?? []).filter((o) => o.active !== false || o.id === current)
    .map((o) => ({ id: o.id!, label: `${sourceLabel(o)}${o.active === false ? ' (скрыт)' : ''}` }))
}
