import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { sourceChoices, sourceText, useSources } from '../lib/sources'

/**
 * «Откуда узнал о клинике» — отдельной строкой: не указано — видно сразу, выбрать — одним нажатием
 * (раньше только в «Изменить данные», и пустое в карточке не показывалось). По нему — «Касса →
 * Аналитика → Откуда пациенты».
 */
export function SourceLine({ patient: p, canEdit, compact = false }: { patient: Schemas['PatientView']; canEdit: boolean; compact?: boolean }) {
  const client = useQueryClient()
  const sources = useSources()
  const save = useMutation<Schemas['PatientView'], ApiError, string>({
    mutationFn: (source) => unwrap(api.PUT('/api/patients/{id}', {
      params: { path: { id: p.id! } },
      body: { fullName: p.fullName ?? '', phone: p.phone ? `+${p.phone}` : '', allowDuplicate: true, birthDate: p.birthDate || undefined, workplace: p.workplace ?? '', sourceId: source ? Number(source) : undefined },
    })),
    onSuccess: () => { for (const key of ['patients', 'patient-card', 'appointments', 'appointment', 'sources']) void client.invalidateQueries({ queryKey: [key] }) },
  })
  const [open, setOpen] = useState(false)
  const choices = sourceChoices(sources.data, p.sourceId)
  const chosen = p.sourceId != null
  const pick = (id: number) => save.mutate(String(id), { onSuccess: () => setOpen(false) })
  // Указано — коротко «📱 Instagram · изменить»; не указано — кнопки-варианты (compact, в карточке приёма —
  // «выбрать», чтобы варианты не сдвигали кнопки приёма вниз)
  return (
    <div className={chosen ? 'source-line' : 'source-line empty'} role="group" aria-label="Откуда узнал о клинике">
      <div className="source-head">
        <span className="hint">Откуда узнал о клинике{chosen ? '' : '?'}</span>
        {chosen && <strong>{sourceText(sources.data, p.sourceId)}</strong>}
        {canEdit && (chosen || compact) && (
          <button type="button" className="link" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'свернуть' : chosen ? 'изменить' : 'выбрать'}</button>
        )}
        {!chosen && !canEdit && <strong>Не указано</strong>}
      </div>
      {canEdit && ((!chosen && !compact) || open) && (
        <div className="source-chips">
          {choices.map((o) => (
            <button key={o.id} type="button" className="source-chip" aria-pressed={o.id === p.sourceId} disabled={save.isPending}
              onClick={() => pick(o.id)}>{o.label}</button>
          ))}
        </div>
      )}
      {save.error && <p className="error" role="alert">{save.error.message}</p>}
    </div>
  )
}
