import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api, unwrap, type ApiError, type Schemas } from '../api/client'
import { Sheet } from '../layout/Sheet'
import { Loading } from '../layout/Loading'
import { EmptyState } from '../layout/EmptyState'
import { formatPhone, shortDate } from '../lib/time'
import { plural } from '../lib/plural'
import { CalmRow } from './CalmList'
import { reasonText, useDuplicatePairs, useDuplicates } from './duplicatesModel'

type Me = Schemas['BookingViewsMe']
type Patient = Schemas['PatientView']
type Match = Schemas['PatientDuplicatesMatch']
type Pair = Schemas['PatientDuplicatesPair']
type Preview = Schemas['PatientMergesPreview']



/**
 * «Похожие карточки: 1» под именем в карточке пациента — только когда они есть. Нажать — окно: похожие карточки
 * («Открыть») и у руководителя — «Объединить…».
 */
export function DuplicatesLine({ patient, me, onOpenPatient }: { patient: Patient; me: Me; onOpenPatient?: (id: number) => void }) {
  const found = useDuplicates(patient.id)
  const [open, setOpen] = useState(false)
  const matches = found.data ?? []
  if (!matches.length) return null
  return (
    <>
      <button type="button" className="link patient-duplicates" onClick={() => setOpen(true)}>
        👥 Похожие карточки: <span className="num">{matches.length}</span>
      </button>
      {open && (
        <DuplicatesSheet patient={patient} matches={matches} me={me} onClose={() => setOpen(false)}
          onOpenPatient={onOpenPatient ? (id) => { setOpen(false); onOpenPatient(id) } : undefined} />
      )}
    </>
  )
}

function DuplicatesSheet({ patient, matches, me, onClose, onOpenPatient }: {
  patient: Patient; matches: Match[]; me: Me; onClose: () => void; onOpenPatient?: (id: number) => void
}) {
  // Одна похожая — сразу предпросмотр объединения (руководителю); несколько — сначала выбрать
  const [other, setOther] = useState<Patient | null>(me.admin && matches.length === 1 ? matches[0]!.patient : null)
  if (other && me.admin) {
    return <MergeSheet a={patient} b={other} onClose={onClose} onBack={matches.length > 1 ? () => setOther(null) : undefined}
      onMerged={(keep) => (onOpenPatient ? onOpenPatient(keep) : onClose())} />
  }
  return (
    <Sheet label="Похожие карточки" title="Похожие карточки" onClose={onClose}>
      <p className="hint">Возможно, это тот же человек, что и «{patient.fullName}».</p>
      <ul className="calm-list merge-matches">
        {matches.map((m) => (
          <CalmRow key={m.patient.id} open={onOpenPatient ? () => onOpenPatient(m.patient.id) : null} name={m.patient.fullName}
            sub={[m.patient.phone ? formatPhone(m.patient.phone) : null, reasonText(m.reason)].filter(Boolean).join(' · ')}
            action={me.admin ? <button type="button" className="btn small" onClick={() => setOther(m.patient)}>Объединить…</button> : undefined} />
        ))}
      </ul>
      {!me.admin && <p className="hint small">Объединить карточки может руководитель.</p>}
    </Sheet>
  )
}

/**
 * Окно объединения (руководитель): какая карточка остаётся — выбрать нажатием, что перейдёт в неё, что заполнится,
 * что останется в архиве второй. Одна главная кнопка «Объединить»; «Это разные люди» — ссылкой.
 */
export function MergeSheet({ a, b, onClose, onBack, onMerged }: {
  a: Patient; b: Patient; onClose: () => void; onBack?: () => void
  /** Объединили — номер основной карточки */
  onMerged: (keepId: number) => void
}) {
  const client = useQueryClient()
  const [keepId, setKeepId] = useState(a.id)
  const otherId = keepId === a.id ? b.id : a.id
  const preview = useQuery<Preview, ApiError>({
    queryKey: ['merge-preview', keepId, otherId],
    queryFn: () => unwrap(api.GET('/api/patients/{id}/merge/{otherId}', { params: { path: { id: keepId, otherId } } })),
    retry: false,
  })
  const done = () => {
    void client.invalidateQueries({ queryKey: ['duplicates'] })
    void client.invalidateQueries({ queryKey: ['patients'] })
    void client.invalidateQueries({ queryKey: ['patient-card'] })
    void client.invalidateQueries({ queryKey: ['patient-timeline'] })
  }
  const merge = useMutation<Patient, ApiError>({
    mutationFn: () => unwrap(api.POST('/api/patients/{id}/merge/{otherId}', { params: { path: { id: keepId, otherId } } })),
    onSuccess: (keep) => { done(); onMerged(keep.id) },
  })
  const dismiss = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.POST('/api/patients/{id}/not-duplicate/{otherId}', { params: { path: { id: keepId, otherId } } })),
    onSuccess: () => { done(); onClose() },
  })
  const p = preview.data
  const visitsOf = (id: number) => (p ? (id === keepId ? p.keepVisits : p.otherVisits) : undefined)
  return (
    <Sheet label="Объединить карточки" title="Объединить карточки" onClose={onClose} wide>
      {onBack && <button type="button" className="link merge-back" onClick={onBack}>‹ Другие похожие</button>}
      <p className="hint">Какая карточка остаётся? Всё из второй перейдёт в неё, вторая уйдёт в архив.</p>
      <div className="merge-cards" role="radiogroup" aria-label="Какая карточка остаётся">
        {[a, b].map((x) => (
          <button key={x.id} type="button" role="radio" aria-checked={keepId === x.id}
            className={`merge-card${keepId === x.id ? ' keep' : ''}`} onClick={() => setKeepId(x.id)}>
            <span className="merge-card-tag">{keepId === x.id ? 'Остаётся' : 'Уйдёт в архив'}</span>
            <strong>{x.fullName}</strong>
            <span className="hint small">
              {[x.phone ? formatPhone(x.phone) : null, x.birthDate ? shortDate(`${x.birthDate}T12:00:00Z`) : null,
                x.telegram ? 'в боте' : null].filter(Boolean).join(' · ')}
            </span>
            {visitsOf(x.id) != null && (
              <span className="hint small">{visitsOf(x.id)} {plural(visitsOf(x.id)!, 'запись', 'записи', 'записей')}</span>
            )}
          </button>
        ))}
      </div>
      {preview.isPending && <Loading />}
      {preview.error && <p className="error" role="alert">{preview.error.message}</p>}
      {p && (
        <>
          <section className="merge-section" aria-label="Перейдёт в основную">
            <h4>Перейдёт в основную</h4>
            {p.moves.length ? (
              <ul className="merge-moves">
                {p.moves.map((m) => <li key={m.label}><span>{m.label}</span><span className="num">{m.count}</span></li>)}
              </ul>
            ) : <p className="hint small">У второй карточки ничего нет — только сама карточка.</p>}
          </section>
          {p.fills.length > 0 && <p className="merge-note">Заполним пустые поля: {p.fills.join(', ')}.</p>}
          {p.stays.length > 0 && (
            <p className="merge-note hint">
              У основной уже есть своё — останется в архиве второй карточки: {p.stays.map((s) => `${s.label.toLowerCase()} (${s.count})`).join(', ')}.
            </p>
          )}
          {p.blocked && <p className="error merge-blocked" role="alert">{p.blocked}</p>}
          {merge.error && <p className="error" role="alert">{merge.error.message}</p>}
          {dismiss.error && <p className="error" role="alert">{dismiss.error.message}</p>}
          <div className="merge-actions">
            <button type="button" className="btn primary" disabled={Boolean(p.blocked) || merge.isPending} onClick={() => merge.mutate()}>
              {merge.isPending ? 'Объединяем…' : 'Объединить'}</button>
            <button type="button" className="link" disabled={dismiss.isPending} onClick={() => dismiss.mutate()}>Это разные люди</button>
          </div>
          {!p.blocked && <p className="hint small">Отменить объединение кнопкой нельзя — проверьте список.</p>}
        </>
      )}
    </Sheet>
  )
}

/** «Пациенты → Похожие карточки» (руководитель): пары клиники и «Объединить…» в строке. */
export function DuplicatePairs({ onOpen }: { onOpen: (id: number) => void }) {
  const pairs = useDuplicatePairs(true)
  const [merging, setMerging] = useState<Pair | null>(null)
  if (pairs.isPending) return <Loading />
  if (pairs.error) return <p className="error">{pairs.error.message}</p>
  if (!pairs.data.length) return <EmptyState title="Похожих карточек нет">Если пациента завели дважды, он появится здесь.</EmptyState>
  return (
    <section className="card-block" aria-label="Похожие карточки">
      <p className="hint small">Возможно, один и тот же пациент заведён дважды. Объединить — перенести всё в одну карточку.</p>
      <ul className="calm-list" aria-label="Пары похожих карточек">
        {pairs.data.map((p) => (
          <CalmRow key={`${p.a.id}-${p.b.id}`} open={() => onOpen(p.a.id)} name={`${p.a.fullName} · ${p.b.fullName}`}
            sub={[p.a.phone ? formatPhone(p.a.phone) : null, reasonText(p.reason)].filter(Boolean).join(' · ')}
            action={<button type="button" className="btn small" onClick={() => setMerging(p)}>Объединить…</button>} />
        ))}
      </ul>
      {merging && <MergeSheet a={merging.a} b={merging.b} onClose={() => setMerging(null)} onMerged={(keep) => { setMerging(null); onOpen(keep) }} />}
    </section>
  )
}

