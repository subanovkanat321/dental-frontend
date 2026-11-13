import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ask } from '../lib/confirm'
import { useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react'

import { api, ApiError, unwrap, upload, type Schemas } from '../api/client'
import { SaveBar } from '../layout/SaveBar'
import { resizePhoto } from '../medical/thumb'
import { useDirty } from '../lib/unsaved'
import { useClose } from '../lib/useClose'
import { ChairField, ChairHoursHint } from './ChairField'
import { HoursEditor } from './HoursEditor'
import { DoctorServices } from './DoctorServices'
import { InviteLink } from './InviteLink'
import { DoctorPhone, StaffPhone, type Doctor } from './PhoneParts'
import { isPhoneLogin } from './texts'
import { Spinner } from '../layout/Loading'

type Me = Schemas['BookingViewsMe']

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

/** Подсказка у чужого вошедшего врача: профиль для пациентов он ведёт сам. */
export const SELF_PROFILE_HINT = 'Фото, имя и «о себе» врач заполняет сам — в «Моём профиле» (нажать на себя внизу меню).'

/**
 * Карточка врача (панель справа в «Персонале» или во всю ширину в «Моём профиле») — три раздела:
 * <ul>
 * <li>«Для пациентов» — фото, имя, «Кратко»: их видят пациенты в боте, ведёт сам врач. Админ у чужого
 * вошедшего врача видит их только для чтения; пока врач не вошёл («ждём входа») — заполняет черновик,
 * иначе бот покажет пациентам пустую карточку;</li>
 * <li>«Работа» — «Работает» (админ), услуги (админ или сам врач), часы работы (и регистратура);</li>
 * <li>«Вход и права» — Telegram подключён или «ждём входа», приглашение, телефон, права администратора.</li>
 * </ul>
 * Telegram id руками не вписывают: привязка — ссылкой-приглашением или номером. Те же права проверяет сервер.
 */
export function DoctorPanel({ doctor: d, me, onClose, inline = false, afterProfile }: {
  doctor: Doctor
  me: Me
  onClose: () => void
  /** «Мой профиль»: разделы — карточками во всю рабочую область, а не панель справа */
  inline?: boolean
  /** «Мой профиль»: что поставить сразу под «Для пациентов» (телефон) */
  afterProfile?: ReactNode
}) {
  // Встроена в «Мой профиль»: «назад» и Esc — у страницы, иначе Esc уводит с несохранённым текстом
  const close = useClose(onClose, !inline)
  const refresh = useRefreshDoctors()
  const self = d.id === me.doctorId
  const admin = Boolean(me.admin)
  // Вошёл — Telegram или номер привязаны. У не-админа DoctorView без id — есть только признак
  const linked = d.telegramId != null || Boolean((d as Schemas['DoctorView']).telegramLinked)
  // Профиль для пациентов: сам врач; админ — только черновик до входа врача
  const editsProfile = self || (admin && !linked)
  // Услуги — сам врач или админ; регистратура — только часы работы
  const editsWork = self || admin
  const who = [self ? 'это вы' : null, d.role === 'ADMIN' ? 'и руководитель' : null, d.active === false ? 'скрыт' : null,
    admin && !linked ? 'ждём входа' : null].filter(Boolean).join(' · ') || 'Врач'
  // Свой профиль: «Работает» и «Удалить врача» — не здесь (снять с себя «Работает» — закрыть себе вход),
  // а у чужих врачей в «Персонале»
  const own = inline && self

  const forPatients = editsProfile
    ? <ProfileForm key={d.id} doctor={d} draft={!self} onSaved={refresh} who={inline ? <><strong>{d.fullName}</strong><span className="hint">{who}</span></> : undefined} />
    : <ProfileView doctor={d} />
  const work = (
    <>
      {!own && <ActiveSwitch doctor={d} admin={admin} onSaved={refresh} />}
      {editsWork && <DoctorServices key={d.id} doctorId={d.id} me={me} />}
      <section className="form">
        <h4>Часы работы</h4>
        <p className="hint">В эти дни и часы пациенты могут записаться к врачу в боте. Обед и намаз — в «Рабочее время → Перерывы и выходные».</p>
        <HoursEditor doctorId={d.id} doctorName={d.fullName ?? ''} />
        <ChairHoursHint doctorId={d.id} me={me} />
      </section>
      <ChairField key={`chair-${d.id}`} doctorId={d.id} me={me} />
    </>
  )
  const access = admin ? <AccessAdmin doctor={d} self={self} inline={inline} onDone={refresh} />
    : <p className="hint">Телефон — в «Телефон» выше; пароль нужен только для входа без Telegram — «Пароль и вход» внизу. Права: врач — своё расписание,
      пациенты и медкарты; сделать руководителем может руководитель клиники.</p>

  if (inline) {
    // «Мой профиль»: каждый раздел — подпись над карточкой, как «Телефон» и «Пароль и вход» на той же странице
    return (
      <aside className="doctor-inline" aria-label="Врач">
        <section className="settings-group" aria-label="Для пациентов">
          <h2>Для пациентов</h2>
          <div className="card-block">{forPatients}</div>
        </section>
        {afterProfile}
        <section className="settings-group" aria-label="Работа">
          <h2>Работа</h2>
          <div className="card-block doctor-work">{work}</div>
        </section>
        {(admin || self) && (
          <section className="settings-group" aria-label="Вход и права">
            <h2>Вход и права</h2>
            <div className="card-block">{access}</div>
          </section>
        )}
        {admin && !own && <RemoveDoctor doctor={d} onDone={() => { refresh(); onClose() }} />}
      </aside>
    )
  }

  return (
    <aside className="panel" aria-label="Врач">
      <header className="panel-head">
        <div>
          <h2>{d.fullName}</h2>
          <span className="hint">{who}</span>
        </div>
        <button type="button" className="btn ghost" aria-label="Закрыть" onClick={close}>✕</button>
      </header>

      <section className="doctor-group" aria-label="Для пациентов">
        <h3 className="group-title">Для пациентов</h3>
        {forPatients}
      </section>

      <section className="doctor-group" aria-label="Работа">
        <h3 className="group-title">Работа</h3>
        {work}
      </section>

      {(admin || self) && (
        <section className="doctor-group" aria-label="Вход и права">
          <h3 className="group-title">Вход и права</h3>
          {access}
        </section>
      )}

      {admin && <RemoveDoctor doctor={d} onDone={() => { refresh(); onClose() }} />}
    </aside>
  )
}

/** «Для пациентов» — форма: фото, имя, «Кратко». draft — админ заполняет за врача, который ещё не вошёл. */
function ProfileForm({ doctor: d, draft, onSaved, who }: { doctor: Doctor; draft: boolean; onSaved: () => void; who?: ReactNode }) {
  const [form, setForm] = useState({ fullName: d.fullName ?? '', about: d.about ?? '' })
  const { dirty, commit } = useDirty(form)
  const [photoError, setPhotoError] = useState('')
  const save = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.PUT('/api/doctors/{id}/profile', { params: { path: { id: d.id } }, body: form })),
    onSuccess: () => {
      commit()
      onSaved()
    },
  })
  const photo = useMutation<unknown, ApiError | Error, File>({
    mutationFn: async (file) => {
      const body = new FormData()
      body.append('photo', await resizePhoto(file, 800, 0.85), 'photo.jpg')
      return upload(`/api/doctors/${d.id}/photo`, body)
    },
    onSuccess: onSaved,
    onError: (e) => setPhotoError(e instanceof ApiError ? e.fieldErrors.photo ?? e.message : 'Не получилось открыть фото — выберите другое'),
  })
  const removePhoto = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.DELETE('/api/doctors/{id}/photo', { params: { path: { id: d.id } } })),
    onSuccess: onSaved,
  })
  const pick = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    setPhotoError('')
    if (file) photo.mutate(file)
  }
  const set = (key: 'fullName' | 'about') => (e: { target: { value: string } }) => {
    save.reset()
    setForm({ ...form, [key]: e.target.value })
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate()
  }
  return (
    <>
      {draft && <p className="hint">Врач ещё не вошёл — можно заполнить черновик, чтобы пациенты не видели пустую карточку. Войдёт — поправит сам.</p>}
      <div className="profile-photo">
        {d.photoUrl ? <img src={d.photoUrl} alt="Фото врача" /> : <span className="photo-empty" aria-hidden="true">{(d.fullName ?? '?').slice(0, 1)}</span>}
        <div className="profile-photo-side">
        {who && <p className="profile-who">{who}</p>}
        <div className="actions">
          <label className="btn">
            {photo.isPending ? <><Spinner />Загружаем…</> : d.photoUrl ? 'Сменить фото' : 'Загрузить фото'}
            <input type="file" accept="image/*" className="sr-only" aria-label="Фото врача" disabled={photo.isPending} onChange={pick} />
          </label>
          {d.photoUrl && <button type="button" className="btn ghost" disabled={removePhoto.isPending} onClick={() => removePhoto.mutate()}>Удалить фото</button>}
        </div>
        </div>
      </div>
      {(photoError || removePhoto.error) && <p className="error" role="alert">{photoError || removePhoto.error?.message}</p>}
      <form className="form" aria-label="Данные врача" onSubmit={submit}>
        <label className="field"><span>Имя</span>
          <input value={form.fullName} required maxLength={100} onChange={set('fullName')} />
        </label>
        <label className="field"><span>Кратко о себе — видят пациенты в боте</span>
          <textarea value={form.about} maxLength={300} rows={2} placeholder="Например: ортодонт, брекеты" onChange={set('about')} />
        </label>
        <SaveBar dirty={dirty} saving={save.isPending} saved={save.isSuccess} savedText="Профиль врача сохранён" error={firstError(save.error)} />
      </form>
    </>
  )
}

/** «Для пациентов» — только посмотреть: чужой вошедший врач ведёт свой профиль сам. */
function ProfileView({ doctor: d }: { doctor: Doctor }) {
  return (
    <div className="profile-view">
      <div className="profile-photo">
        {d.photoUrl ? <img src={d.photoUrl} alt="Фото врача" /> : <span className="photo-empty" aria-hidden="true">{(d.fullName ?? '?').slice(0, 1)}</span>}
        <dl className="profile-facts">
          <dt>Имя</dt><dd>{d.fullName}</dd>
          <dt>Кратко о себе</dt><dd>{d.about?.trim() || <span className="hint">не заполнено</span>}</dd>
        </dl>
      </div>
      <p className="hint">{SELF_PROFILE_HINT}</p>
    </div>
  )
}

/** «Работает (показывать пациентам)»: меняет админ сразу, без «Сохранить»; остальным — как есть. */
function ActiveSwitch({ doctor: d, admin, onSaved }: { doctor: Doctor; admin: boolean; onSaved: () => void }) {
  const active = d.active !== false
  const save = useMutation<unknown, ApiError, boolean>({
    mutationFn: (next) => unwrap(api.PUT('/api/doctors/{id}/active', { params: { path: { id: d.id } }, body: { active: next } })),
    onSuccess: onSaved,
  })
  if (!admin) {
    return <p className="hint">{active ? 'Работает — пациенты видят врача в боте.' : 'Скрыт — пациенты врача не видят.'}</p>
  }
  return (
    <div className="form">
      <label className="check">
        <input type="checkbox" checked={save.isPending ? !active : active} disabled={save.isPending}
          onChange={(e) => save.mutate(e.target.checked)} /> Работает (показывать пациентам)
      </label>
      <p className="hint small">Снимите, когда врач ушёл: пациенты его не увидят, а вход врача в приложение закроется. История приёмов останется.</p>
      {save.error && <p className="error" role="alert">{save.error.message}</p>}
    </div>
  )
}

/** «Вход и права» для админа: Telegram подключён или «ждём входа», приглашение, телефон, права администратора. */
function AccessAdmin({ doctor: d, self, inline, onDone }: { doctor: Doctor; self: boolean; inline: boolean; onDone: () => void }) {
  const [invite, setInvite] = useState<string | null>(null)
  const byPhone = isPhoneLogin(d.telegramId)
  const linked = d.telegramId != null
  const isAdmin = d.role === 'ADMIN'
  const makeInvite = useMutation<Schemas['DoctorInvitesInvite'], ApiError>({
    mutationFn: () => unwrap(api.POST('/api/doctors/{id}/invite', { params: { path: { id: d.id } } })),
    onSuccess: (i) => setInvite(i.token ?? null),
  })
  const rights = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.PUT('/api/doctors/{id}/admin', { params: { path: { id: d.id } }, body: { admin: !isAdmin } })),
    onSuccess: () => {
      // Свои права поменялись — меню и доступы другие: проще начать заново
      if (self) window.location.reload()
      else onDone()
    },
  })
  return (
    <>
      <p className={linked ? 'tone-ok' : 'tone-wait'}>{byPhone ? '✓ Входит по номеру (без Telegram)' : linked ? '✓ Telegram подключён' : 'Ждём входа'}</p>
      <p className="hint">{byPhone
        ? 'Появился Telegram — пришлите ссылку: после «Начать» в боте врач будет входить через Telegram.'
        : linked
          ? 'Врач сменил аккаунт Telegram — пришлите новую ссылку.'
          : 'Уведомления о приёмах пока приходят вам. Пришлите врачу ссылку: он нажмёт «Начать» в боте и дальше сам заполнит фото, имя и «о себе».'}</p>
      {invite
        ? <InviteLink start={`join_${invite}`} name={d.fullName ?? ''} toWhom="врачу" />
        : <button type="button" className="btn" disabled={makeInvite.isPending} onClick={() => makeInvite.mutate()}>
          {linked ? 'Новая ссылка-приглашение' : 'Пригласить по ссылке'}</button>}
      {makeInvite.error && <p className="error">{makeInvite.error.message}</p>}
      <DoctorPhone doctor={d} onDone={onDone} />
      {linked && !inline && <StaffPhone telegramId={d.telegramId!} phone={d.phone} phoneOnly={d.phoneOnly} name={d.fullName} />}

      <h4>Права</h4>
      {/* Права дают тому, кто вошёл: администратор — это Telegram врача. Не вошёл — объясняем, что сделать */}
      {!linked ? (
        <p className="hint">Сделать врача руководителем можно, когда он войдёт: нажмите выше «Пригласить по ссылке»,
          отправьте ему — он откроет ссылку и нажмёт «Начать» в Telegram. После этого здесь появится кнопка
          «Сделать руководителем клиники».</p>
      ) : (
        <>
          <p className="hint">{isAdmin
            ? 'Этот врач — и руководитель: ведёт «О клинике», врачей, сотрудников, видит выручку клиники.'
            : 'Врач сможет вести клинику вместе с вами: «О клинике», врачи, сотрудники, выручка клиники. Лечить и вести своё расписание он продолжит.'}</p>
          <button type="button" className="btn" disabled={rights.isPending}
            onClick={() => void (!isAdmin || !self ? Promise.resolve(true) : ask('Снять с себя права руководителя?')).then((ok) => ok && rights.mutate())}>
            {isAdmin ? 'Снять права руководителя' : 'Сделать руководителем клиники'}</button>
          {rights.error && <p className="error" role="alert">{rights.error.message}</p>}
        </>
      )}
    </>
  )
}

function RemoveDoctor({ doctor: d, onDone }: { doctor: Doctor; onDone: () => void }) {
  const remove = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.DELETE('/api/doctors/{id}', { params: { path: { id: d.id } } })),
    onSuccess: onDone,
  })
  return (
    <div className="danger-zone">
      <p className="hint">Удалить можно врача без приёмов — например, заведённого для пробы. Ушедшего врача скройте: снимите «Работает».</p>
      <button type="button" className="btn danger" disabled={remove.isPending}
        onClick={() => void ask(`Удалить врача «${d.fullName}»?`).then((ok) => ok && remove.mutate())}>Удалить врача</button>
      {remove.error && <p className="error" role="alert">{remove.error.message}</p>}
    </div>
  )
}

/** Новый врач: имя и «кратко» — черновик до входа; Telegram — потом, ссылкой-приглашением из его карточки. */
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
        <label className="field"><span>Кратко о себе — видят пациенты в боте</span>
          <input value={form.about} maxLength={300} placeholder="Например: ортодонт, брекеты" onChange={(e) => setForm({ ...form, about: e.target.value })} />
        </label>
        <p className="hint">Имя и «кратко» — черновик: войдёт врач — поправит сам, вместе с фото. После «Добавить» откроется карточка врача:
          там ссылка-приглашение и часы работы.</p>
        {create.error && <p className="error" role="alert">{firstError(create.error)}</p>}
        <button type="submit" className="btn primary" disabled={create.isPending}>Добавить</button>
      </form>
    </aside>
  )
}
