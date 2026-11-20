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
 */
export function PlanStatusBar({ patientId, readOnly }: { patientId: number; readOnly: boolean }) {
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
  return (
    <div className="plan-status" role="group" aria-label="Статус плана лечения">
      <PlanStatusChip progress={p} />
      <span className="hint small">{progressText(p)}</span>
      {!readOnly && (
        <span className="plan-status-actions">
          {s === 'PROPOSED' && <button type="button" className="link small" disabled={mark.isPending} onClick={() => mark.mutate('AGREED')}>Пациент согласен</button>}
          {(s === 'PROPOSED' || s === 'AGREED' || s === 'IN_PROGRESS') && (
            <button type="button" className="link small" disabled={mark.isPending} onClick={() => mark.mutate('REFUSED')}>Отказался</button>
          )}
          {(s === 'REFUSED' || (s === 'AGREED' && p.manualAgreed)) && (
            <button type="button" className="link small" disabled={mark.isPending} onClick={() => mark.mutate('NONE')}>Снять отметку</button>
          )}
        </span>
      )}
      {mark.error && <span className="error small" role="alert">{mark.error.message}</span>}
    </div>
  )
}
