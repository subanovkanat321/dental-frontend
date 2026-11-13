/** Роль сотрудника для «Руководства» (книга в «Помощи» и /guide?role=… на сайте): какие главы ему показать сначала. */
import type { Schemas } from '../api/client'
import { isAssistant } from '../lib/roles'

type Me = Schemas['BookingViewsMe']

export type Role = 'doctor' | 'reception' | 'assistant' | 'admin'

/** Своя роль открывается первой: ассистент → врач → регистратура → администратор. */
export function ownRole(me: Me): Role {
  if (isAssistant(me)) return 'assistant'
  if (me.doctorId != null) return 'doctor'
  if (me.reception) return 'reception'
  if (me.admin) return 'admin'
  return 'reception'
}

/**
 * Роль для «Руководства Tish»: админу — главы «Клиника» и «Настройки» и всё остальное, даже если он и врач;
 * иначе — своя роль.
 */
export function guideRole(me: Me): Role {
  return me.admin ? 'admin' : ownRole(me)
}
