import { useState } from 'react'

import type { Schemas } from '../api/client'
import { chairOf, useChairs } from '../team/chairs'

type Option = Schemas['ChairOptionView']

/**
 * Кресло приёма в форме (V210): кресло врача — по умолчанию, другое — если выбрали. Поле показываем, только когда в
 * клинике больше одного кресла: с одним креслом выбирать нечего, отправляем как раньше (без chairId).
 *
 * @param current кресло приёма, которое уже стоит (перенос того же врача, карточка); undefined — новая запись или
 *        другой врач: кресло врача
 * @returns multi — поле нужно; chairId — что отправить (кресло врача тоже: сервер поймёт «по креслу врача»)
 */
export function useChairChoice(doctorId: number, current?: number | null) {
  const chairs = useChairs()
  const [picked, setPicked] = useState<{ doctorId: number; id: number } | null>(null)
  const multi = (chairs.data?.length ?? 0) > 1
  const own = chairOf(chairs.data, doctorId)?.id ?? null
  // Сменили врача — выбор сбрасывается: у нового врача своё кресло
  const chosen = picked && picked.doctorId === doctorId ? picked.id : current !== undefined ? current : own
  return {
    multi,
    chairId: multi ? chosen ?? undefined : undefined,
    pick: (id: number) => setPicked({ doctorId, id }),
  }
}

/** «свободно» / «занято (Айгерим С.)» / «время Айгерим С.» — кто в кресле, только сотрудникам. */
export function chairStateText(o: Option): string {
  if (o.state === 'BUSY') return `занято${o.doctorName ? ` (${o.doctorName})` : ''}`
  if (o.state === 'COLLEAGUE_TIME') return `время ${o.doctorName ?? 'коллеги'}${o.strict ? ' — нельзя' : ''}`
  return 'свободно'
}
