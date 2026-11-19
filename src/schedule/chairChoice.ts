import { useState } from 'react'

import type { Schemas } from '../api/client'
import { chairOf, useChairs } from '../team/chairs'

type Option = Schemas['ChairOptionView']

/**
 * Кресло приёма в форме (V210; с 2026-11-19 — без поля «Кресло»). По умолчанию кресло не выбирают и не отправляют:
 * приём садится в кресло врача (триггер базы), а выбранное раньше вручную у переносимого приёма остаётся. Другое кресло
 * ставит только нажатие в блоке «Свободно: [Кресло 2]» — он появляется, когда кресло врача в это время занято
 * (`ChairTimeHint`). В клинике с одним креслом выбирать нечего (`multi` — false).
 *
 * @param current кресло приёма, которое уже стоит (перенос того же врача, карточка); undefined — новая запись или
 *        другой врач: кресло врача
 * @param at время приёма (и длительность): сменили — выбранное кресло сбрасывается, свободное было на прежнее время
 * @returns multi — в клинике больше одного кресла; picked — кресло, выбранное нажатием (его и отправляем как chairId);
 *          checkId — какое кресло проверять подсказкой (выбранное, иначе кресло приёма; undefined — кресло врача);
 *          chosen — что стоит в поле «Кресло» карточки (`ChairEdit`): выбранное, кресло приёма или кресло врача
 */
export function useChairChoice(doctorId: number, current?: number | null, at = '') {
  const chairs = useChairs()
  const [state, setState] = useState<{ doctorId: number; at: string; id: number } | null>(null)
  const multi = (chairs.data?.length ?? 0) > 1
  const own = chairOf(chairs.data, doctorId)?.id ?? null
  // Сменили врача или время — выбор сбрасывается: у нового врача своё кресло, на другое время — свои свободные
  const picked = multi && state && state.doctorId === doctorId && state.at === at ? state.id : undefined
  const chosen = picked ?? (current !== undefined ? current : own)
  return {
    multi,
    picked,
    checkId: picked ?? current ?? undefined,
    chosen: multi ? chosen ?? undefined : undefined,
    pick: (id: number) => setState({ doctorId, at, id }),
    reset: () => setState(null),
  }
}

/** «свободно» / «занято (Айгерим С.)» / «время Айгерим С.» — кто в кресле, только сотрудникам. */
export function chairStateText(o: Option): string {
  if (o.state === 'BUSY') return `занято${o.doctorName ? ` (${o.doctorName})` : ''}`
  if (o.state === 'COLLEAGUE_TIME') return `время ${o.doctorName ?? 'коллеги'}${o.strict ? ' — нельзя' : ''}`
  return 'свободно'
}
