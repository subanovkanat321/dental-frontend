import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { ask } from '../lib/confirm'
import { Loading } from '../layout/Loading'
import { SubHelp } from '../layout/PageHead'
import { MAX_NAME, MAX_TAGS, missingDefaults, TAG_COLORS, usePatientTags, VIP, type Tag } from '../tags/tags'
import { SubHeader } from './SubHeader'
import { EditButton } from '../layout/EditButton'

type Me = Schemas['BookingViewsMe']

/** Свежий список меток — в кэш; карточки и расписание перечитают названия и цвета. */
function useSaveTags() {
  const client = useQueryClient()
  return (list: Tag[]) => {
    client.setQueryData(['patient-tags'], list)
    for (const key of ['patient-card', 'appointments']) void client.invalidateQueries({ queryKey: [key] })
  }
}

/** Ошибка поля из 422 (errors[]) — под формой, иначе общее сообщение. */
function errorText(e: ApiError | null): string | null {
  if (!e) return null
  return Object.values(e.fieldErrors)[0] ?? e.message
}

/**
 * «Настройки → Метки пациентов» (V239 бэкенда) — свои цветные метки клиники: «ВИП», «Опаздывает», «Боится»… Видны в
 * шапке карточки пациента, точками у имени в расписании и в карточке приёма. Список меняет руководитель (до 12 меток,
 * название до 20 символов); ставят пациенту руководитель и регистратура. «ВИП» — встроенная: она же ⭐, её можно
 * переименовать и перекрасить, но не удалить.
 */
export function TagsPage({ me, onBack }: { me: Me; onBack: () => void }) {
  const tags = usePatientTags()
  const list = tags.data ?? []
  const admin = Boolean(me.admin)
  return (
    <section className="schedule-main tags-page">
      <SubHeader title="Метки пациентов" onBack={onBack}>
        <SubHelp title="Метки пациентов">Цветные метки — то, что важно знать о пациенте с одного взгляда: «Друг», «Родственник»,
          «По рекомендации», «Опаздывает», «Боится». Видны в шапке карточки пациента и точками у имени в расписании (наведите — название).
          Ставят и снимают руководитель и регистратура: в «Новой записи» (строка «Метки:») или в карточке пациента → строка меток под именем.
          Пациент меток не видит. «ВИП» — встроенная метка, она же ⭐ на записи. Скидка по метке (✎ → «Скидка, %») — Tish подставит её
          в оплату такому пациенту; сотрудник может поменять или убрать, правила «Настройки → Скидки» те же.</SubHelp>
      </SubHeader>
      {tags.isPending ? <Loading />
        : tags.error ? <p className="error" role="alert">{tags.error.message}</p>
          : (
            <>
              <ul className="tag-list" aria-label="Метки клиники">
                {list.map((t) => <TagRow key={t.id} tag={t} admin={admin} />)}
              </ul>
              {admin && <AddDefaults list={list} />}
              {admin && (list.length < MAX_TAGS
                ? <NewTag />
                : <p className="hint">Это {MAX_TAGS} меток — больше уже трудно выбирать. Ненужную можно удалить.</p>)}
              {!admin && <p className="hint">Метки задаёт руководитель клиники.</p>}
            </>
          )}
    </section>
  )
}

/** Выбор цвета — кружками палитры (радиокнопки). */
function ColorPick({ value, onChange, name }: { value: string; onChange: (color: string) => void; name: string }) {
  return (
    <div className="tag-colors" role="radiogroup" aria-label="Цвет">
      {TAG_COLORS.map((c) => (
        <label key={c.key} className="tag-color" title={c.name}>
          <input type="radio" name={name} value={c.key} checked={value === c.key} onChange={() => onChange(c.key)} aria-label={c.name} />
          <span className={`tag-dot tag-${c.key}`} aria-hidden="true" />
        </label>
      ))}
    </div>
  )
}

/** «＋ Добавить готовые» (V255 бэкенда): вернуть удалённые «Друг», «Родственник»… — только каких нет; свои не трогаем. */
function AddDefaults({ list }: { list: Tag[] }) {
  const save = useSaveTags()
  const missing = missingDefaults(list)
  const add = useMutation<Tag[], ApiError>({
    mutationFn: () => unwrap(api.POST('/api/patient-tags/defaults')),
    onSuccess: save,
  })
  if (!missing.length) return null
  return (
    <div className="tags-defaults">
      <button type="button" className="btn small" disabled={add.isPending} title={missing.join(', ')} onClick={() => add.mutate()}>
        ＋ Добавить готовые ({missing.length})</button>
      <span className="hint small"> {missing.join(', ')}</span>
      {add.error && <p className="error" role="alert">{errorText(add.error)}</p>}
    </div>
  )
}

/** «Скидка, %» у метки: пусто — без скидки; 1–100 (проверит и сервер). */
function DiscountInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="tag-discount-field">Скидка по метке, %
      <input type="number" min={1} max={100} inputMode="numeric" placeholder="нет" value={value}
        onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}

/** Строка «Скидка, %» → число для запроса; пусто — без скидки. */
function percentOf(value: string): number | undefined {
  return value.trim() === '' ? undefined : Number(value)
}

function NewTag() {
  const save = useSaveTags()
  const [name, setName] = useState('')
  const [color, setColor] = useState('blue')
  const add = useMutation<Tag[], ApiError>({
    mutationFn: () => unwrap(api.POST('/api/patient-tags', { body: { name, color } })),
    onSuccess: (list) => {
      save(list)
      setName('')
    },
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    add.mutate()
  }
  return (
    <form className="card-block tag-new" onSubmit={submit} aria-label="Новая метка">
      <label className="field">Новая метка
        <input value={name} maxLength={MAX_NAME} placeholder="Например, Опаздывает" onChange={(e) => { add.reset(); setName(e.target.value) }} />
      </label>
      <ColorPick name="new-tag-color" value={color} onChange={setColor} />
      <button type="submit" className="btn primary" disabled={add.isPending || !name.trim()}>Добавить</button>
      {add.error && <p className="error" role="alert">{errorText(add.error)}</p>}
    </form>
  )
}

/** Метка: точка, название, сколько пациентов; руководитель — «изменить» (название и цвет) и «удалить». */
function TagRow({ tag, admin }: { tag: Tag; admin: boolean }) {
  const save = useSaveTags()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(tag.name ?? '')
  const [color, setColor] = useState(tag.color ?? 'gray')
  const [percent, setPercent] = useState(tag.discountPercent ? String(tag.discountPercent) : '')
  const update = useMutation<Tag[], ApiError>({
    mutationFn: () => unwrap(api.PUT('/api/patient-tags/{id}', {
      params: { path: { id: tag.id } }, body: { name, color, discountPercent: percentOf(percent) },
    })),
    onSuccess: (list) => {
      save(list)
      setEditing(false)
    },
  })
  const remove = useMutation<Tag[], ApiError>({
    mutationFn: () => unwrap(api.DELETE('/api/patient-tags/{id}', { params: { path: { id: tag.id } } })),
    onSuccess: save,
  })
  const vip = tag.code === VIP
  const count = tag.patients ? `${tag.patients} пац.` : 'ни у кого'
  if (editing) {
    return (
      <li className="tag-row editing">
        <form className="tag-edit-form" aria-label={`Изменить метку ${tag.name}`} onSubmit={(e) => { e.preventDefault(); update.mutate() }}>
          <input aria-label="Название" value={name} maxLength={MAX_NAME} onChange={(e) => { update.reset(); setName(e.target.value) }} />
          <ColorPick name={`tag-color-${tag.id}`} value={color} onChange={setColor} />
          <DiscountInput value={percent} onChange={(v) => { update.reset(); setPercent(v) }} />
          <span className="tag-edit-actions">
            <button type="submit" className="btn primary small" disabled={update.isPending || !name.trim()}>Сохранить</button>
            <button type="button" className="btn small" onClick={() => {
              setEditing(false); setName(tag.name ?? ''); setColor(tag.color ?? 'gray'); setPercent(tag.discountPercent ? String(tag.discountPercent) : '')
            }}>Отмена</button>
          </span>
          {update.error && <p className="error" role="alert">{errorText(update.error)}</p>}
        </form>
      </li>
    )
  }
  return (
    <li className="tag-row">
      <span className={`tag-dot tag-${tag.color ?? 'gray'}`} aria-hidden="true" />
      <span className="tag-name">{tag.name}{vip && <span className="hint"> · ⭐ встроенная</span>}</span>
      {tag.discountPercent != null && <span className="tag-discount num" title="Скидка по метке — подставится в оплату">скидка {tag.discountPercent} %</span>}
      <span className="hint num">{count}</span>
      {admin && (
        <span className="tag-actions">
          <EditButton label={`Изменить метку ${tag.name}`} onClick={() => setEditing(true)} />
          {!vip && (
            <button type="button" className="link small danger" disabled={remove.isPending} aria-label={`Удалить метку ${tag.name}`}
              onClick={async () => {
                // Ни у кого не стоит — без «снимется у всех пациентов (ни у кого)»
                const question = tag.patients ? `Удалить метку «${tag.name}»? Она снимется у всех пациентов (${count}).` : `Удалить метку «${tag.name}»?`
                if (await ask(question, { ok: 'Удалить', danger: true })) remove.mutate()
              }}>удалить</button>
          )}
        </span>
      )}
      {remove.error && <p className="error" role="alert">{errorText(remove.error)}</p>}
    </li>
  )
}
