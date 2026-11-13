import { useQueryClient } from '@tanstack/react-query'

import type { Schemas } from '../api/client'

type StaffRole = NonNullable<Schemas['StaffControllerRolesRequest']['role']>

/** Правила сочетаний — одним текстом в карточке и в форме добавления. */
export const ROLES_RULES = 'Врач + Руководитель и Врач + Регистратура — можно. Ассистент врачом быть не может: врач видит свою выручку, '
  + 'а ассистенту деньги не показываем.'

/** Что значит роль — подсказка у выбора. */
export const ROLE_HINT: Record<StaffRole | 'DOCTOR', string> = {
  DOCTOR: 'ведёт приём: своё расписание, пациенты и медкарты, часы, услуги и кресло',
  ADMIN: 'ведёт клинику: персонал, цены и часы клиники, выручка, медкарты',
  RECEPTION: 'записывает пациентов ко всем врачам и отмечает оплату; медкарт и выручки не видит',
  ASSISTANT: 'помогает своим врачам: их расписание, медкарта их пациентов и снимки; денег и настроек не видит',
}

/** Перечитать всё, что зависит от ролей: список, врачей (расписание, касса), свои права. */
export function useRefreshStaff() {
  const client = useQueryClient()
  return () => {
    for (const key of ['members', 'member-invites', 'doctors-admin', 'me', 'shifts', 'chairs']) {
      void client.invalidateQueries({ queryKey: [key] })
    }
  }
}
