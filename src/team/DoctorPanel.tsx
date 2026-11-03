import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type ChangeEvent, type FormEvent } from 'react'

import { api, ApiError, unwrap, upload, type Schemas } from '../api/client'
import { SaveBar } from '../layout/SaveBar'
import { resizePhoto } from '../medical/thumb'
import { useDirty } from '../lib/unsaved'
import { useClose } from '../lib/useClose'
import { HoursEditor } from './HoursEditor'
import { DoctorServices } from './DoctorServices'
import { InviteLink } from './InviteLink'

type Me = Schemas['BookingViewsMe']
type Doctor = Schemas['DoctorAdminView']

/** Врачи нужны почти везде (переключатель в «Расписании», «Касса», склад) — перечитать и me. */
function useRefreshDoctors() {
  const client = useQueryClient()
  return () => {
    void client.invalidateQueries({ queryKey: ['doctors-admin'] })
    void client.invalidateQueries({ queryKey: ['me'] })
  }
}

function firstError(e: ApiError | null): string | null {
  return e ? Object.values(e.fieldErrors)[0] ?? e.message : null
}

/**
 * Карточка врача справа. Админ: имя, «кратко», Telegram, «работает», приглашение по ссылке, права
 * администратора, удалить. Врач сам себе — профиль и фото (их видят пациенты в боте) и часы работы.
 */
export function DoctorPanel({ doctor: d, me, onClose, inline = false }: {
  doctor: Doctor
  me: Me
  onClose: () => void
  /** «Мой профиль»: карточка во всю рабочую область, а не панель справа */
  inline?: boolean
}) {
  // Встроена в «Мой профиль»: «назад» и Esc — у страницы, иначе Esc уводит с несохранённым текстом
  const close = useClose(onClose, !inline)
  const refresh = useRefreshDoctors()
  const self = d.id === me.doctorId
  // Профиль и фото — сам врач или админ; регистратура — только часы работы
  const editsProfile = Boolean(me.admin) || self
  const [form, setForm] = useState({ fullName: d.fullName ?? '', about: d.about ?? '', telegramId: d.telegramId == null ? '' : String(d.telegramId), active: d.active !== false })
  // Telegram id и «работает» меняет только админ — у врача их нет в форме
  const { dirty, commit } = useDirty(me.admin ? form : { fullName: form.fullName, about: form.about })
  const [invite, setInvite] = useState<string | null>(null)
  const [photoError, setPhotoError] = useState('')
  const tgInvalid = form.telegramId.trim() !== '' && !/^\d{3,15}$/.test(form.telegramId.trim())

  const save = useMutation<unknown, ApiError>({
    mutationFn: () => (me.admin
      ? unwrap(api.PUT('/api/doctors/{id}', {
        params: { path: { id: d.id! } },
        body: { fullName: form.fullName, about: form.about, telegramId: form.telegramId.trim() ? Number(form.telegramId) : undefined, active: form.active },
      }))
      : unwrap(api.PUT('/api/doctors/{id}/profile', { params: { path: { id: d.id! } }, body: { fullName: form.fullName, about: form.about } }))),
    onSuccess: () => {
      commit()
      refresh()
    },
  })
  const photo = useMutation<unknown, ApiError | Error, File>({
    mutationFn: async (file) => {
      const body = new FormData()
      body.append('photo', await resizePhoto(file, 800, 0.85), 'photo.jpg')
      return upload(`/api/doctors/${d.id}/photo`, body)
    },
    onSuccess: refresh,
    onError: (e) => setPhotoError(e instanceof ApiError ? e.fieldErrors.photo ?? e.message : 'Не получилось открыть фото — выберите другое'),
  })
  const removePhoto = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.DELETE('/api/doctors/{id}/photo', { params: { path: { id: d.id! } } })),
    onSuccess: refresh,
  })
  const makeInvite = useMutation<Schemas['DoctorInvitesInvite'], ApiError>({
    mutationFn: () => unwrap(api.POST('/api/doctors/{id}/invite', { params: { path: { id: d.id! } } })),
    onSuccess: (i) => setInvite(i.token ?? null),
  })
  const isAdmin = d.role === 'ADMIN'
  const rights = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.PUT('/api/doctors/{id}/admin', { params: { path: { id: d.id! } }, body: { admin: !isAdmin } })),
    onSuccess: () => {
      // Свои права поменялись — меню и доступы другие: проще начать заново
      if (self) window.location.reload()
      else refresh()
    },
  })
  const remove = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.DELETE('/api/doctors/{id}', { params: { path: { id: d.id! } } })),
    onSuccess: () => {
      refresh()
      onClose()
    },
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!tgInvalid) save.mutate()
  }
  const pick = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    setPhotoError('')
    if (file) photo.mutate(file)
  }
  const set = (key: 'fullName' | 'about' | 'telegramId') => (e: { target: { value: string } }) => {
    save.reset()
    setForm({ ...form, [key]: e.target.value })
  }

  return (
    <aside className={inline ? 'card-block doctor-inline' : 'panel'} aria-label="Врач">
      <header className="panel-head">
        <div>
          <h2>{d.fullName}</h2>
          <span className="hint">{[self ? 'это вы' : null, isAdmin ? 'и администратор' : null, d.active === false ? 'скрыт' : null].filter(Boolean).join(' · ') || 'Врач'}</span>
        </div>
        {!inline && <button type="button" className="btn ghost" aria-label="Закрыть" onClick={close}>✕</button>}
      </header>

      {editsProfile && <>
      <div className="profile-photo">
        {d.photoUrl ? <img src={d.photoUrl} alt="Фото врача" /> : <span className="photo-empty" aria-hidden="true">{(d.fullName ?? '?').slice(0, 1)}</span>}
        <div className="actions">
          <label className="btn">
            {photo.isPending ? 'Загружаем…' : d.photoUrl ? 'Сменить фото' : 'Загрузить фото'}
            <input type="file" accept="image/*" className="sr-only" aria-label="Фото врача" disabled={photo.isPending} onChange={pick} />
          </label>
          {d.photoUrl && <button type="button" className="btn ghost" disabled={removePhoto.isPending} onClick={() => removePhoto.mutate()}>Удалить фото</button>}
        </div>
      </div>
      {(photoError || removePhoto.error) && <p className="error" role="alert">{photoError || removePhoto.error?.message}</p>}

      <form className="form" aria-label="Данные врача" onSubmit={submit}>
        <label className="field"><span>Имя</span>
          <input value={form.fullName} required maxLength={100} onChange={set('fullName')} />
        </label>
        <label className="field"><span>Кратко — видят пациенты в боте</span>
          <textarea value={form.about} maxLength={300} rows={2} placeholder="Например: ортодонт, брекеты" onChange={set('about')} />
        </label>
        {me.admin && (
          <>
            <label className="field"><span>Telegram id врача</span>
              <input value={form.telegramId} inputMode="numeric" placeholder="Например: 512345678" onChange={set('telegramId')} />
            </label>
            {tgInvalid && <p className="error">Только цифры, как пишет @userinfobot</p>}
            <label className="check"><input type="checkbox" checked={form.active} onChange={(e) => { save.reset(); setForm({ ...form, active: e.target.checked }) }} /> Работает (показывать пациентам)</label>
          </>
        )}
        <SaveBar dirty={dirty} saving={save.isPending} saved={save.isSuccess} disabled={tgInvalid} savedText="Профиль врача сохранён"
          error={save.error && (save.error.code === 'telegram-taken' ? save.error.message : firstError(save.error))} />
      </form>
      </>}

      {editsProfile && <DoctorServices key={d.id} doctorId={d.id!} me={me} />}

      <section className="form">
        <h3>Часы работы</h3>
        <p className="hint">В эти дни и часы пациенты могут записаться к врачу в боте. Обед и намаз — во вкладке «Перерывы».</p>
        <HoursEditor doctorId={d.id!} />
      </section>

      {me.admin && (
        <section className="form">
          <h3>Вход врача</h3>
          <p className="hint">{d.telegramId
            ? `Telegram привязан (${d.telegramId}). Если врач сменил аккаунт — пришлите новую ссылку.`
            : 'Telegram не привязан — уведомления о приёмах приходят вам. Пришлите врачу ссылку: он нажмёт «Начать» в боте, и всё готово.'}</p>
          {invite
            ? <InviteLink start={`join_${invite}`} name={d.fullName ?? ''} toWhom="врачу" />
            : <button type="button" className="btn" disabled={makeInvite.isPending} onClick={() => makeInvite.mutate()}>
              {d.telegramId ? 'Новая ссылка-приглашение' : 'Пригласить по ссылке'}</button>}
          {makeInvite.error && <p className="error">{makeInvite.error.message}</p>}
        </section>
      )}

      {/* Права дают тому, кто вошёл: администратор — это Telegram врача. Не вошёл — объясняем, что сделать */}
      {me.admin && d.telegramId == null && (
        <section className="form">
          <h3>Права</h3>
          <p className="hint">Сделать врача администратором можно, когда он войдёт: нажмите выше «Пригласить по ссылке»,
            отправьте ему — он откроет ссылку и нажмёт «Начать» в Telegram. После этого здесь появится кнопка
            «Сделать администратором клиники».</p>
        </section>
      )}
      {me.admin && d.telegramId != null && (
        <section className="form">
          <h3>Права</h3>
          <p className="hint">{isAdmin
            ? 'Этот врач — и администратор: ведёт «О клинике», врачей, сотрудников, видит выручку клиники.'
            : 'Врач сможет вести клинику вместе с вами: «О клинике», врачи, сотрудники, выручка клиники. Лечить и вести своё расписание он продолжит.'}</p>
          <button type="button" className="btn" disabled={rights.isPending}
            onClick={() => (!isAdmin || !self || window.confirm('Снять с себя права администратора?')) && rights.mutate()}>
            {isAdmin ? 'Снять права администратора' : 'Сделать администратором клиники'}</button>
          {rights.error && <p className="error" role="alert">{rights.error.message}</p>}
        </section>
      )}

      {me.admin && (
        <div className="danger-zone">
          <p className="hint">Удалить можно врача без приёмов — например, заведённого для пробы. Ушедшего врача скройте: снимите «Работает».</p>
          <button type="button" className="btn danger" disabled={remove.isPending}
            onClick={() => window.confirm(`Удалить врача «${d.fullName}»?`) && remove.mutate()}>Удалить врача</button>
          {remove.error && <p className="error" role="alert">{remove.error.message}</p>}
        </div>
      )}
    </aside>
  )
}

/** Новый врач: имя и «кратко»; Telegram — потом, ссылкой-приглашением из его карточки. */
export function NewDoctorPanel({ onClose, onCreated }: { onClose: () => void; onCreated: (d: Doctor) => void }) {
  useClose(onClose)
  const refresh = useRefreshDoctors()
  const [form, setForm] = useState({ fullName: '', about: '' })
  const create = useMutation<Doctor, ApiError>({
    mutationFn: () => unwrap(api.POST('/api/doctors', { body: { fullName: form.fullName, about: form.about, active: true } })),
    onSuccess: (d) => {
      refresh()
      onCreated(d)
    },
  })
  return (
    <aside className="panel" aria-label="Новый врач">
      <header className="panel-head">
        <h2>Новый врач</h2>
        <button type="button" className="btn ghost" aria-label="Закрыть" onClick={onClose}>✕</button>
      </header>
      <form className="form" onSubmit={(e) => { e.preventDefault(); create.mutate() }}>
        <label className="field"><span>Имя</span>
          <input value={form.fullName} required maxLength={100} autoFocus placeholder="Например: Айгерим Садыкова" onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
        </label>
        <label className="field"><span>Кратко — видят пациенты в боте</span>
          <input value={form.about} maxLength={300} placeholder="Например: ортодонт, брекеты" onChange={(e) => setForm({ ...form, about: e.target.value })} />
        </label>
        <p className="hint">После «Добавить» откроется карточка врача: там ссылка-приглашение, фото и часы работы.</p>
        {create.error && <p className="error" role="alert">{firstError(create.error)}</p>}
        <button type="submit" className="btn primary" disabled={create.isPending}>Добавить</button>
      </form>
    </aside>
  )
}
