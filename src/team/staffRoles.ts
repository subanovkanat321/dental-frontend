import { useQueryClient } from '@tanstack/react-query'

import type { Schemas } from '../api/client'

type StaffRole = NonNullable<Schemas['StaffControllerRolesRequest']['role']>

/**
 * Роль человека одним пунктом списка (2026-11-13, вместо флажков): в списке только допустимые сочетания,
 * поэтому запрещённое (ассистент + врач, две роли в клинике) выбрать нельзя. API прежний: пункт
 * раскладывается в «врач да/нет» + роль в клинике ({@link rolesOf}).
 */
export type RoleChoice = 'DOCTOR' | 'ADMIN' | 'ADMIN_DOCTOR' | 'RECEPTION' | 'RECEPTION_DOCTOR' | 'ASSISTANT' | 'HIDDEN'

/** Пункт, подпись и что может роль — одна строка серым (Select показывает её после « · »). */
export const ROLE_CHOICES: [RoleChoice, string, string][] = [
  ['DOCTOR', 'Врач', 'своё расписание, пациенты и медкарты'],
  ['ADMIN', 'Руководитель', 'персонал, цены, выручка и настройки'],
  ['ADMIN_DOCTOR', 'Руководитель и врач', 'ведёт клинику и сам принимает'],
  ['RECEPTION', 'Регистратура', 'запись ко всем врачам и оплата'],
  ['RECEPTION_DOCTOR', 'Регистратура и врач', 'запись ко всем и свой приём'],
  ['ASSISTANT', 'Ассистент', 'помогает своим врачам, денег не видит'],
]

/** Только в карточке врача без роли в клинике: «скрыть» (прежнее снятие флажка «Врач»). */
export const HIDDEN_CHOICE: [RoleChoice, string, string] = ['HIDDEN', 'Врач скрыт', 'не принимает, история остаётся']

/** Пункт → поля API: врач ли и роль в клинике (null — только врач). */
export function rolesOf(choice: RoleChoice): { doctor: boolean; role: StaffRole | null } {
  switch (choice) {
    case 'DOCTOR': return { doctor: true, role: null }
    case 'ADMIN_DOCTOR': return { doctor: true, role: 'ADMIN' }
    case 'RECEPTION_DOCTOR': return { doctor: true, role: 'RECEPTION' }
    case 'HIDDEN': return { doctor: false, role: null }
    default: return { doctor: false, role: choice }
  }
}

/** Поля API → пункт; ни врача, ни роли — врач скрыт. */
export function choiceOf(doctor: boolean, role: StaffRole | null): RoleChoice {
  if (role === 'ASSISTANT') return 'ASSISTANT'
  if (role) return doctor ? `${role}_DOCTOR` : role
  return doctor ? 'DOCTOR' : 'HIDDEN'
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
