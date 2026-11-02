import { useMutation, useQueryClient } from '@tanstack/react-query'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { sourceChoices, sourceText, useSources } from '../lib/sources'

/**
 * «Откуда узнал о клинике» — отдельной строкой: не указано — видно сразу, выбрать — одним нажатием
 * (раньше только в «Изменить данные», и пустое в карточке не показывалось). По нему — «Касса →
 * Аналитика → Откуда пациенты».
 */
export function SourceLine({ patient: p, canEdit }: { patient: Schemas['PatientView']; canEdit: boolean }) {
  const client = useQueryClient()
  const sources = useSources()
  const save = useMutation<Schemas['PatientView'], ApiError, string>({
    mutationFn: (source) => unwrap(api.PUT('/api/patients/{id}', {
      params: { path: { id: p.id! } },
      body: { fullName: p.fullName ?? '', phone: p.phone ? `+${p.phone}` : '', allowDuplicate: true, birthDate: p.birthDate || undefined, workplace: p.workplace ?? '', sourceId: source ? Number(source) : undefined },
    })),
    onSuccess: () => { for (const key of ['patients', 'patient-card', 'appointments', 'appointment', 'sources']) void client.invalidateQueries({ queryKey: [key] }) },
  })
  return (
    <div className="source-line">
      <span className="hint">Откуда узнал о клинике</span>
      {canEdit ? (
        <select aria-label="Откуда узнал о клинике" value={p.sourceId ?? ''} disabled={save.isPending}
          className={p.sourceId != null ? '' : 'empty'} onChange={(e) => save.mutate(e.target.value)}>
          <option value="">— не указано, выбрать</option>
          {sourceChoices(sources.data, p.sourceId).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      ) : <strong>{sourceText(sources.data, p.sourceId)}</strong>}
      {save.error && <p className="error" role="alert">{save.error.message}</p>}
    </div>
  )
}
