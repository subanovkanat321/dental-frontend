import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { sourceChoices, sourceText, useSources } from '../lib/sources'

/**
 * «Откуда узнал о клинике» — отдельной строкой: не указано — видно сразу, выбрать — одним нажатием
 * (раньше только в «Изменить данные», и пустое в карточке не показывалось). По нему — «Касса →
 * Аналитика → Откуда пациенты».
 */
export function SourceLine({ patient: p, canEdit, compact = false, admin = false }: {
  patient: Schemas['PatientView']
  canEdit: boolean
  compact?: boolean
  /** Админ клиники — может сразу добавить свой вариант («＋ Свой вариант»), не уходя в «Настройки» */
  admin?: boolean
}) {
  const client = useQueryClient()
  const sources = useSources()
  const save = useMutation<Schemas['PatientView'], ApiError, string>({
    mutationFn: (source) => unwrap(api.PUT('/api/patients/{id}', {
      params: { path: { id: p.id } },
      body: { fullName: p.fullName, phone: p.phone ? `+${p.phone}` : '', allowDuplicate: true, birthDate: p.birthDate || undefined, workplace: p.workplace ?? '', sourceId: source ? Number(source) : undefined },
    })),
    onSuccess: () => { for (const key of ['patients', 'patient-card', 'appointments', 'appointment', 'sources']) void client.invalidateQueries({ queryKey: [key] }) },
  })
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  // Новый вариант: создаём в списке клиники («Настройки → Откуда приходят пациенты») и сразу выбираем пациенту
  const add = useMutation<Schemas['PatientSourcesOption'][], ApiError, string>({
    mutationFn: (t) => unwrap(api.POST('/api/patient-sources', { body: { emoji: '', title: t } })),
    // Ответ — весь список вариантов клиники: новый — с этим названием и самым большим id
    onSuccess: (list, t) => {
      client.setQueryData(['patient-sources'], list)
      setAdding(false)
      setTitle('')
      const created = list.filter((o) => o.title === t).sort((a, b) => b.id - a.id)[0]
      if (created?.id != null) pick(created.id)
    },
  })
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
          {admin && !adding && <button type="button" className="source-chip add" onClick={() => setAdding(true)}>＋ Свой вариант</button>}
        </div>
      )}
      {admin && adding && (
        <form className="source-add" aria-label="Новый вариант «откуда узнал»"
          onSubmit={(e) => { e.preventDefault(); if (title.trim()) add.mutate(title.trim()) }}>
          <input aria-label="Название варианта" value={title} maxLength={60} autoFocus placeholder="Например: Ярмарка здоровья"
            onChange={(e) => setTitle(e.target.value)} />
          <button type="submit" className="btn small primary" disabled={add.isPending || !title.trim()}>Добавить</button>
          <button type="button" className="btn small ghost" onClick={() => { setAdding(false); setTitle(''); add.reset() }}>Отмена</button>
          {add.error && <p className="error" role="alert">{add.error.fieldErrors.title ?? add.error.message}</p>}
        </form>
      )}
      {save.error && <p className="error" role="alert">{save.error.message}</p>}
    </div>
  )
}
