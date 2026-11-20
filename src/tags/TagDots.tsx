import type { Schemas } from '../api/client'
import { ActionMenu, type ActionItem } from '../layout/ActionMenu'
import { canTag, colorEmoji, tagsOf, usePatientTags, useToggleTag, VIP } from './tags'

type Patient = Schemas['PatientView']
type Me = Schemas['BookingViewsMe']

/**
 * Метки пациента цветными точками у имени (расписание: сетка «Дня», список дня, карточка приёма). Название — в title
 * и для скринридера («Метки: Боится, Опаздывает»). «ВИП» здесь не рисуем — её показывает ⭐ в значках приёма.
 * Метки клиники грузятся, только если у пациента они есть: у большинства записей запроса нет.
 */
export function TagDots({ patient, className = '', named = false }: {
  patient: Pick<Patient, 'tagIds'>; className?: string
  /** Первая метка — словом, остальные — «＋1» (карточка приёма: точки без подписи непонятны) */
  named?: boolean
}) {
  const has = (patient.tagIds?.length ?? 0) > 0
  const tags = usePatientTags(has)
  const shown = tagsOf(patient, tags.data, false)
  if (!shown.length) return null
  const names = shown.map((t) => t.name).join(', ')
  if (named) {
    const [first] = shown
    return (
      <span className={`tag-chip tag-named ${className}`.trim()} role="img" aria-label={`Метки: ${names}`} title={names}>
        <span className={`tag-dot tag-${first!.color ?? 'gray'}`} aria-hidden="true" />{first!.name}
        {shown.length > 1 && <span className="hint"> ＋{shown.length - 1}</span>}
      </span>
    )
  }
  return (
    <span className={`tag-dots ${className}`.trim()} role="img" aria-label={`Метки: ${names}`} title={names}>
      {shown.map((t) => <span key={t.id} className={`tag-dot tag-${t.color ?? 'gray'}`} />)}
    </span>
  )
}

/**
 * Метки в шапке карточки пациента: цветные чипы одной строкой («● Боится · ● По рекомендации»). Руководитель и
 * регистратура нажимают на строку — список всех меток клиники с ✓, нажатие ставит или снимает (и «ВИП» — она же ⭐).
 * Остальным — только чипы; меток нет — строки нет (у кого можно ставить — тихая ссылка «＋ Метка»).
 */
export function PatientTagsLine({ patient, me }: { patient: Patient; me: Me }) {
  const editable = canTag(me)
  const tags = usePatientTags(editable || (patient.tagIds?.length ?? 0) > 0)
  const toggle = useToggleTag(patient.id)
  const shown = tagsOf(patient, tags.data, false)
  const list = tags.data ?? []
  if (!editable && !shown.length) return null
  if (editable && !list.length) return null
  const chips = shown.length
    ? shown.map((t) => <span key={t.id} className="tag-chip"><span className={`tag-dot tag-${t.color ?? 'gray'}`} aria-hidden="true" />{t.name}</span>)
    : null
  if (!editable) return <div className="patient-tags" aria-label="Метки пациента">{chips}</div>
  const ids = new Set(patient.tagIds ?? [])
  const items: ActionItem[] = list.map((t) => ({
    label: t.code === VIP ? `${t.name} ⭐` : t.name ?? '',
    icon: colorEmoji(t.color),
    checked: ids.has(t.id),
    disabled: toggle.isPending,
    onSelect: () => toggle.mutate({ tagId: t.id, on: !ids.has(t.id) }),
  }))
  return (
    <div className="patient-tags">
      <ActionMenu label="Метки пациента" buttonLabel={shown.length ? `Метки: ${shown.map((t) => t.name).join(', ')}. Изменить` : 'Добавить метку'}
        className="patient-tags-btn" caret={false} items={items}
        content={chips ? <>{chips}<span className="tag-edit" aria-hidden="true">✎</span></> : <span className="link small">＋ Метка</span>} />
      {toggle.error && <p className="error" role="alert">{toggle.error.message}</p>}
    </div>
  )
}
