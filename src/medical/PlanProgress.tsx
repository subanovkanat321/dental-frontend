import { useMutation, useQueryClient } from '@tanstack/react-query'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { PLAN_STATUS, planStatusKey, progressShare, progressText, usePlanStatus } from '../lib/planStatus'

type Progress = Schemas['PlanStatesProgress']

/** Чип статуса плана: «В работе», «Согласован»… */
export function PlanStatusChip({ progress }: { progress: Progress }) {
  if (!progress.status) return null
  const s = PLAN_STATUS[progress.status]
  return <span className={`chip small s-${s.tone}`}>{s.label}</span>
}

/**
 * Строка «План: [В работе] выполнено 3 из 7 · 12 000 из 40 000 сом» с тонкой полоской — в карточке пациента. Суммы
 * сервер не отдаёт ассистенту — тогда без них. Плана нет или медкарта не видна (регистратура, 403) — ничего.
 */
export function PlanProgressLine({ patientId, enabled = true }: { patientId: number; enabled?: boolean }) {
  const status = usePlanStatus(patientId, enabled)
  const p = status.data
  if (!p?.status) return null
  return (
    <p className="plan-progress" aria-label="Прогресс плана лечения">
      <span className="plan-progress-head"><span className="hint">План</span> <PlanStatusChip progress={p} /></span>
      <span className="plan-progress-text">{progressText(p)}</span>
      <span className="plan-progress-bar" aria-hidden="true"><span style={{ width: `${Math.round(progressShare(p) * 100)}%` }} /></span>
    </p>
  )
}

/**
 * Над этапами в редакторе плана: статус, прогресс и отметки руками — «Пациент согласен» (обсудили на приёме, а не по
 * ссылке), «Отказался», «Снять отметку». Остальное статус узнаёт сам. readOnly (ассистент) — только статус.
 * Предложенный план — две кнопки: «Пациент согласен» заметная, «Отказался» тихая.
 *
 * @param actionsOnly только кнопки: статус и прогресс уже в заголовке (строка «План лечения» в карточке приёма)
 */
export function PlanStatusBar({ patientId, readOnly, actionsOnly = false }: { patientId: number; readOnly: boolean; actionsOnly?: boolean }) {
  const client = useQueryClient()
  const status = usePlanStatus(patientId)
  const mark = useMutation<Progress, ApiError, 'AGREED' | 'REFUSED' | 'NONE'>({
    mutationFn: (m) => unwrap(api.PUT('/api/patients/{patientId}/plan/status', { params: { path: { patientId } }, body: { mark: m } })),
    onSuccess: (fresh) => {
      client.setQueryData(planStatusKey(patientId), fresh)
      void client.invalidateQueries({ queryKey: ['dropped'] })
      void client.invalidateQueries({ queryKey: ['comebacks'] })
    },
  })
  const p = status.data
  if (!p?.status) return null
  const s = p.status
  if (actionsOnly && readOnly) return null
  // Предложен — решение за пациентом: две кнопки. Дальше отметки нужны редко — тихие ссылки справа
  const proposed = s === 'PROPOSED'
  return (
    <div className={actionsOnly ? 'plan-status actions-only' : 'plan-status'} role="group" aria-label="Статус плана лечения">
      {!actionsOnly && <PlanStatusChip progress={p} />}
      {!actionsOnly && <span className="hint small">{progressText(p)}</span>}
      {!readOnly && (
        <span className={proposed ? 'plan-status-actions decide' : 'plan-status-actions'}>
          {proposed && <button type="button" className="btn small plan-agree" disabled={mark.isPending} onClick={() => mark.mutate('AGREED')}><span aria-hidden="true">✓ </span>Пациент согласен</button>}
          {(proposed || s === 'AGREED' || s === 'IN_PROGRESS') && (
            <button type="button" className={proposed ? 'btn small' : 'link small quiet'} disabled={mark.isPending} onClick={() => mark.mutate('REFUSED')}>Отказался</button>
          )}
          {(s === 'REFUSED' || (s === 'AGREED' && p.manualAgreed)) && (
            <button type="button" className="link small quiet" disabled={mark.isPending} onClick={() => mark.mutate('NONE')}>Снять отметку</button>
          )}
        </span>
      )}
      {mark.error && <span className="error small" role="alert">{mark.error.message}</span>}
    </div>
  )
}
