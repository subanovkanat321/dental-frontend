import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, ApiError, unwrap, type Schemas } from '../api/client'

export type Tag = Schemas['PatientTagsTag']
type Patient = Schemas['PatientView']
type Me = Schemas['BookingViewsMe']

/** Код встроенной метки «ВИП» (V239 бэкенда): та же отметка, что patient.vip — в расписании она ⭐, а не точкой. */
export const VIP = 'VIP'

/** Не больше меток у клиники и символов в названии — как на сервере (PatientTags). */
export const MAX_TAGS = 8
export const MAX_NAME = 20

/**
 * Палитра меток: ключи — как на сервере (PatientTags.COLORS), цвет точки — CSS-переменная `--tag-<ключ>` (crm.css, светлая
 * и тёмная тема), кружок-эмодзи — для пунктов меню, где цвет текста не задать.
 */
export const TAG_COLORS: { key: string; name: string; emoji: string }[] = [
  { key: 'red', name: 'Красный', emoji: '🔴' },
  { key: 'orange', name: 'Оранжевый', emoji: '🟠' },
  { key: 'yellow', name: 'Жёлтый', emoji: '🟡' },
  { key: 'green', name: 'Зелёный', emoji: '🟢' },
  { key: 'blue', name: 'Синий', emoji: '🔵' },
  { key: 'violet', name: 'Фиолетовый', emoji: '🟣' },
  { key: 'brown', name: 'Коричневый', emoji: '🟤' },
  { key: 'gray', name: 'Серый', emoji: '⚪' },
]

export function colorEmoji(color: string | undefined): string {
  return TAG_COLORS.find((c) => c.key === color)?.emoji ?? '⚪'
}

/**
 * Метки клиники (GET /api/patient-tags) — одна загрузка на все экраны (расписание, карточки), обновляется редко.
 * enabled — только когда нужно: у пациентов на экране есть метки или их можно ставить.
 */
export function usePatientTags(enabled = true) {
  return useQuery({
    queryKey: ['patient-tags'],
    queryFn: () => unwrap(api.GET('/api/patient-tags')),
    enabled,
    staleTime: 5 * 60_000,
  })
}

/** Метки пациента по порядку клиники. withVip=false — без «ВИП» (её показывает ⭐ рядом). */
export function tagsOf(patient: Pick<Patient, 'tagIds'> | undefined, list: Tag[] | undefined, withVip = true): Tag[] {
  const ids = new Set(patient?.tagIds ?? [])
  if (!ids.size || !list) return []
  return list.filter((t) => ids.has(t.id) && (withVip || t.code !== VIP))
}

/** Ставить и снимать метки пациенту — руководитель и регистратура (как сервер; отметку ВИП — так же). */
export function canTag(me: Me): boolean {
  return Boolean(me.admin || me.reception)
}

/** Список меток меняет руководитель («Настройки → Метки пациентов»). */
export function canManageTags(me: Me): boolean {
  return Boolean(me.admin)
}

/**
 * Поставить или снять метку пациенту (PUT /api/patients/{id}/tags/{tagId}). Ответ — карточка со свежими метками:
 * перечитываем карточку пациента, расписание и счётчики меток.
 */
export function useToggleTag(patientId: number) {
  const client = useQueryClient()
  return useMutation<Patient, ApiError, { tagId: number; on: boolean }>({
    mutationFn: ({ tagId, on }) => unwrap(api.PUT('/api/patients/{id}/tags/{tagId}', { params: { path: { id: patientId, tagId } }, body: { on } })),
    onSuccess: () => {
      for (const key of ['patient-card', 'appointments', 'appointment', 'patients', 'patient-tags']) void client.invalidateQueries({ queryKey: [key] })
    },
  })
}
