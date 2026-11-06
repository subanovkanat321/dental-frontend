import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { PhoneInput } from '../clinic/PhoneInput'
import { phoneFromInput } from '../clinic/phone'
import { ask, notify } from '../lib/confirm'
import { openSettings } from '../lib/route'
import { DoctorPanel } from '../team/DoctorPanel'
import { PHONE_HINT } from '../team/PhoneParts'
import { phoneText } from '../team/texts'
import { SubHeader } from './SubHeader'
import { Loading, Spinner } from '../layout/Loading'
import { NewPasswordFields } from '../layout/PasswordFields'
import { passwordProblem } from '../lib/password'

type Me = Schemas['BookingViewsMe']
type Doctor = Schemas['DoctorAdminView']

/**
 * «Мой профиль»: свой телефон (для связи и входа по номеру) — у всех, и владельца платформы тоже; врачу —
 * ещё своя карточка во всю ширину: фото, имя, «о себе» (их видят пациенты в боте), часы работы.
 * Список врачей и «Добавить врача» — в «Врачах».
 */
export function ProfilePage({ me, onBack }: { me: Me; onBack: () => void }) {
  const admin = useQuery({
    queryKey: ['doctors-admin'],
    queryFn: () => unwrap(api.GET('/api/doctors/admin')),
    enabled: Boolean(me.admin) && me.doctorId != null,
  })
  const own: Doctor | undefined = me.admin
    ? admin.data?.find((d) => d.id === me.doctorId)
    : (me.doctors ?? []).find((d) => d.id === me.doctorId)

  return (
    <section className="schedule-main">
      <SubHeader title="Мой профиль" onBack={onBack} />
      <MyPhone />
      {me.doctorId == null ? (
        <div className="card-block">
          <p>Профиль для пациентов есть у врачей: фото, имя и «о себе» видны при записи в боте.</p>
          <p className="hint">Вы и принимаете пациентов? Добавьте себя врачом в «Врачах» — «Я тоже веду приём».</p>
          <button type="button" className="btn" onClick={() => openSettings('doctors')}>Персонал</button>
        </div>
      ) : me.admin && admin.isPending ? <Loading />
        : admin.error ? <p className="error">{admin.error.message}</p>
          : own ? <DoctorPanel key={own.id} doctor={own} me={me} onClose={onBack} inline />
            : <p className="hint">Профиль не найден — обновите страницу.</p>}
    </section>
  )
}

type MyPhoneState = Schemas['MyPhoneControllerMyPhone']

/**
 * «Телефон» в «Моём профиле»: свой номер для входа на сайте по номеру. Привязывается только кодом из
 * SMS на этот номер: номер → «Получить код» → код → «Подтвердить» (так номер для входа задаёт лишь
 * тот, у кого телефон в руках). SMS не подключены — задать нельзя. Убрать (у кого есть Telegram) — без кода.
 */
function MyPhone() {
  const phone = useQuery({ queryKey: ['me-phone'], queryFn: () => unwrap(api.GET('/api/me/phone')) })
  return (
    <section className="settings-group" aria-label="Телефон">
      <h2>Телефон</h2>
      {phone.isPending ? <Loading /> : phone.error ? <p className="error">{phone.error.message}</p>
        : <MyPhoneCard key={phone.data.phone ?? ''} state={phone.data} />}
    </section>
  )
}

function MyPhoneCard({ state }: { state: MyPhoneState }) {
  const client = useQueryClient()
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const [sentTo, setSentTo] = useState('')
  const [code, setCode] = useState('')
  // Пароль для входа по номеру — сразу при подтверждении, тем же кодом (вторая SMS не нужна)
  const [fresh, setFresh] = useState({ password: '', repeat: '' })
  const [problem, setProblem] = useState('')
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['me-phone'] })
    void client.invalidateQueries({ queryKey: ['me-password'] })
  }
  const sendCode = useMutation<unknown, ApiError, string>({
    mutationFn: (p) => unwrap(api.POST('/api/me/phone/code', { body: { phone: p } })),
    onSuccess: (_r, p) => { setSentTo(p); setCode('') },
  })
  const confirm = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.PUT('/api/me/phone', { body: { phone: sentTo, code, password: fresh.password } })),
    onSuccess: () => {
      refresh()
      void notify('Номер подтверждён, пароль задан. Теперь можно входить на сайте по номеру и паролю.')
    },
  })
  const remove = useMutation<unknown, ApiError>({ mutationFn: () => unwrap(api.DELETE('/api/me/phone')), onSuccess: refresh })
  const close = () => {
    setOpen(false)
    setSentTo('')
    setCode('')
    sendCode.reset()
    confirm.reset()
  }
  const error = confirm.error ?? sendCode.error

  return (
    <div className="card-block">
      {state.phone ? <p>{phoneText(state.phone)}</p> : <p className="hint">Телефон не указан.</p>}
      <p className="hint">{PHONE_HINT}{state.phoneOnly ? ' Без Telegram это ваш единственный вход: номер можно сменить, но не убрать.' : ''}</p>
      {!open ? (
        <div className="actions">
          {state.sms
            ? <button type="button" className="btn" onClick={() => setOpen(true)}>{state.phone ? 'Изменить' : 'Указать телефон'}</button>
            : <p className="hint">SMS не подключены — номер для входа сейчас не задать.</p>}
          {state.phone && !state.phoneOnly && (
            <button type="button" className="btn ghost" disabled={remove.isPending}
              onClick={() => void ask('Убрать свой телефон? Входить по номеру будет нельзя, через Telegram — как раньше.').then((ok) => ok && remove.mutate())}>
              Убрать номер</button>
          )}
          {remove.error && <p className="error" role="alert">{remove.error.message}</p>}
        </div>
      ) : !sentTo ? (
        <form className="form narrow" aria-label="Мой телефон" onSubmit={(e) => { e.preventDefault(); sendCode.mutate(phoneFromInput(value)) }}>
          <label className="field"><span>Новый номер</span>
            <PhoneInput label="Телефон" value={value} onChange={setValue} />
          </label>
          <p className="hint">Пришлём код на этот номер — им подтвердите, что номер ваш.</p>
          {error && <p className="error" role="alert">{error.fieldErrors.phone ?? error.message}</p>}
          <div className="actions">
            <button type="submit" className="btn primary" disabled={sendCode.isPending || !value.trim()}>
              {sendCode.isPending ? <><Spinner />Отправляем…</> : 'Получить код'}</button>
            <button type="button" className="btn ghost" onClick={close}>Отмена</button>
          </div>
        </form>
      ) : (
        <form className="form narrow" aria-label="Подтвердить номер" onSubmit={(e) => {
          e.preventDefault()
          const p = passwordProblem(fresh.password, fresh.repeat, sentTo.replace(/\D/g, ''))
          setProblem(p)
          if (!p) confirm.mutate()
        }}>
          <p className="hint">Код отправлен на {phoneText(sentTo.replace(/\s/g, ''))}. Действует 5 минут.</p>
          <label className="field"><span>Код из SMS</span>
            <input value={code} autoComplete="one-time-code" inputMode="numeric" maxLength={6} placeholder="123456"
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
          </label>
          <p className="hint">И сразу придумайте пароль — им будете входить на сайте по номеру, без Telegram.</p>
          <NewPasswordFields password={fresh.password} repeat={fresh.repeat} phone={sentTo.replace(/\D/g, '')} label="Пароль для входа по номеру"
            onPassword={(v) => setFresh({ ...fresh, password: v })} onRepeat={(v) => setFresh({ ...fresh, repeat: v })} />
          {(problem || error) && <p className="error" role="alert">{problem || (error && (error.fieldErrors.code ?? error.fieldErrors.password ?? error.fieldErrors.phone ?? error.message))}</p>}
          <div className="actions">
            <button type="submit" className="btn primary" disabled={confirm.isPending || code.length !== 6}>
              {confirm.isPending ? <><Spinner />Проверяем…</> : 'Подтвердить'}</button>
            <button type="button" className="btn ghost" onClick={close}>Отмена</button>
          </div>
        </form>
      )}
    </div>
  )
}
