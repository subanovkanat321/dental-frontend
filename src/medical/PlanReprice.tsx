import { useMutation, useQuery } from '@tanstack/react-query'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { Sheet } from '../layout/Sheet'
import { somText } from '../lib/time'

type Step = Schemas['TreatmentStepView']

/**
 * «💲 Обновить цены» (шаг 4А): старый план по текущему прайсу. Сервер считает «было → стало» для несделанных этапов с
 * услугой из прайса (GET /plan/prices) и после «Обновить» пересчитывает заново сам (POST) — фронт цены не присылает.
 * Сделанные этапы, этапы без услуги прайса и скрытые услуги не меняются.
 */
export function PlanRepriceSheet({ patientId, onClose, onSaved }: {
  patientId: number; onClose: () => void; onSaved: (steps: Step[]) => void
}) {
  const preview = useQuery({
    queryKey: ['plan', patientId, 'prices'],
    queryFn: () => unwrap(api.GET('/api/patients/{patientId}/plan/prices', { params: { path: { patientId } } })),
    gcTime: 0,
  })
  const save = useMutation<Step[], ApiError>({
    mutationFn: () => unwrap(api.POST('/api/patients/{patientId}/plan/prices', { params: { path: { patientId } } })),
    onSuccess: onSaved,
  })
  const p = preview.data
  const changes = p?.changes ?? []
  return (
    <Sheet label="Обновить цены" title="Обновить цены по прайсу" onClose={onClose}>
      {preview.error && <p className="error" role="alert">{preview.error.message}</p>}
      {p && changes.length === 0 && <p role="status">Цены в плане совпадают с прайсом — менять нечего.</p>}
      {changes.length > 0 && (
        <>
          <ul className="reprice-list" aria-label="Было → стало">
            {changes.map((c) => (
              <li key={c.stepId}>
                <span>{c.tooth ? <b>{c.tooth} · </b> : null}{c.title}</span>
                <span className="nowrap num">
                  <s>{c.wasSom != null ? somText(c.wasSom) : 'без цены'}</s> → <b>{somText(c.nowSom)}</b>
                </span>
              </li>
            ))}
          </ul>
          <p className="reprice-total">Осталось по плану: <span className="num">{somText(p!.wasSom ?? 0)} → <b>{somText(p!.nowSom ?? 0)}</b></span></p>
        </>
      )}
      {p && (p.manual ?? 0) > 0 && (
        <p className="hint small">Этапов без услуги из прайса: {p.manual} — их цены вписаны руками и не меняются.</p>
      )}
      {save.error && <p className="error small" role="alert">{save.error.message}</p>}
      <div className="actions">
        {changes.length > 0 && (
          <button type="button" className="btn primary" disabled={save.isPending} onClick={() => save.mutate()}>Обновить цены</button>
        )}
        <button type="button" className="btn ghost" onClick={onClose}>{changes.length > 0 ? 'Отмена' : 'Закрыть'}</button>
      </div>
    </Sheet>
  )
}
