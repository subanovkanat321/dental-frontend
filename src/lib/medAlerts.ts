import { useQuery } from '@tanstack/react-query'

import { api, unwrap } from '../api/client'

/**
 * «Важно для врача» (❗ на записи): в анкете отмечено «да» у вопроса «в плашке» — аллергия, давление, беременность.
 * text — расшифровка («⚠️ Аллергия: лидокаин · ❤️ Давление»), только если сотрудник видит медкарту пациента;
 * иначе null — значок без текста. Нет отметок — null целиком.
 */
export type MedAlert = { text: string | null } | null

/** Сколько id за один запрос (сервер принимает до 500): неделя всей клиники влезает в один-два. */
const BATCH = 200

/**
 * Склейка запросов: каждая запись расписания спрашивает своего пациента, а на сервер уходит один POST на экран.
 * Все useQuery, смонтированные в одном проходе рендера, попадают в одну пачку (setTimeout 0).
 */
let pending = new Map<number, ((a: MedAlert) => void)[]>()
let timer: ReturnType<typeof setTimeout> | null = null

function flush() {
  const batch = pending
  pending = new Map()
  timer = null
  const ids = [...batch.keys()]
  for (let i = 0; i < ids.length; i += BATCH) {
    const part = ids.slice(i, i + BATCH)
    unwrap(api.POST('/api/anamnesis/alerts', { body: { patientIds: part } }))
      .then((list) => {
        const found = new Map((list ?? []).map((a) => [a.patientId, { text: a.text ?? null }]))
        for (const id of part) for (const done of batch.get(id) ?? []) done(found.get(id) ?? null)
      })
      // Нет ответа — нет значка: расписание важнее, ошибку не показываем
      .catch(() => { for (const id of part) for (const done of batch.get(id) ?? []) done(null) })
  }
}

function loadMedAlert(patientId: number): Promise<MedAlert> {
  return new Promise((resolve) => {
    const list = pending.get(patientId) ?? []
    list.push(resolve)
    pending.set(patientId, list)
    timer ??= setTimeout(flush, 0)
  })
}

/** ❗ пациента: кэш общий у сетки, списка «День» и карточки приёма; анкету поменяли — ключ ['med-alert']. */
export function useMedAlert(patientId: number | null | undefined): MedAlert {
  const q = useQuery({
    queryKey: ['med-alert', patientId],
    queryFn: () => loadMedAlert(patientId!),
    enabled: patientId != null,
    staleTime: 5 * 60_000,
  })
  return q.data ?? null
}
