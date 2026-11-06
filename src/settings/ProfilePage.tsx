import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, botUsername, unwrap, type Schemas } from '../api/client'
import { PhoneInput } from '../clinic/PhoneInput'
import { phoneFromInput } from '../clinic/phone'
import { ask, notify } from '../lib/confirm'
import { openSettings } from '../lib/route'
import { DoctorPanel } from '../team/DoctorPanel'
import { PHONE_HINT } from '../team/PhoneParts'
import { phoneText } from '../team/texts'
import { SubHeader } from './SubHeader'
import { Loading, Spinner } from '../layout/Loading'
import { CodeInput, ResendLink } from '../layout/CodeStep'
import { useCountdown } from '../lib/otp'
import { NewPasswordFields } from '../layout/PasswordFields'
import { passwordProblem } from '../lib/password'
import { telegram } from '../lib/telegram'
import { PasswordSection } from './PasswordSection'

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
      <PasswordSection />
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
 * «Телефон» в «Моём профиле»: свой номер для входа на сайте. Привязывается только подтверждённым:
 * <ul>
 * <li>у кого есть Telegram — «Подтвердить через Telegram» (бесплатно): в Mini App — запрос контакта
 * Telegram, на сайте — бот по ссылке «?start=phone» с кнопкой «📱 Поделиться номером». Telegram отдаёт
 * номер своего аккаунта, поэтому это и есть подтверждение (код в свой же Telegram не доказал бы, что
 * номер ваш);</li>
 * <li>запасной способ — кодом из SMS на этот номер: номер → «Получить код» → код → «Подтвердить» → только
 * потом «Придумайте пароль для входа по номеру» (сервер выдал одноразовый пропуск; шаг можно пропустить и
 * задать пароль позже в «Пароль и вход»).</li>
 * </ul>
 * Убрать (у кого есть Telegram) — без кода.
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
  const [wait, restart] = useCountdown()
  // Пропуск после «Подтвердить»: с ним — шаг «Придумайте пароль» (вторая SMS не нужна)
  const [token, setToken] = useState('')
  const [fresh, setFresh] = useState({ password: '', repeat: '' })
  const [problem, setProblem] = useState('')
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['me-phone'] })
    void client.invalidateQueries({ queryKey: ['me-password'] })
  }
  const sendCode = useMutation<unknown, ApiError, string>({
    mutationFn: (p) => unwrap(api.POST('/api/me/phone/code', { body: { phone: p } })),
    onSuccess: (_r, p) => { setSentTo(p); setCode(''); restart() },
  })
  const confirm = useMutation<Schemas['MyPhoneControllerPhoneConfirmed'], ApiError>({
    mutationFn: () => unwrap(api.PUT('/api/me/phone', { body: { phone: sentTo, code } })),
    onSuccess: (r) => {
      if (!r.setupToken) {
        refresh()
        void notify('Номер подтверждён.')
        return
      }
      // Номер уже привязан; карточку не перерисовываем, пока не пройден шаг пароля
      setToken(r.setupToken)
      setFresh({ password: '', repeat: '' })
    },
  })
  const savePassword = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.PUT('/api/me/password', { body: { setupToken: token, newPassword: fresh.password } })),
    onSuccess: () => {
      refresh()
      void notify('Номер подтверждён, пароль задан. Теперь можно входить на сайте по номеру и паролю.')
    },
  })
  const skipPassword = () => {
    refresh()
    void notify('Номер подтверждён. Пароль для входа по номеру можно задать позже — «Пароль и вход».')
  }
  const remove = useMutation<unknown, ApiError>({ mutationFn: () => unwrap(api.DELETE('/api/me/phone')), onSuccess: refresh })
  const viaTelegram = useTelegramShare(state.phone ?? null, refresh)
  const close = () => {
    setOpen(false)
    setSentTo('')
    setCode('')
    sendCode.reset()
    confirm.reset()
  }
  const error = confirm.error ?? sendCode.error
  const phoneDigits = sentTo.replace(/\D/g, '')

  return (
    <div className="card-block">
      {state.phone ? <p>{phoneText(state.phone)}</p> : <p className="hint">Телефон не указан.</p>}
      <p className="hint">{PHONE_HINT}{state.phoneOnly ? ' Без Telegram это ваш единственный вход: номер можно сменить, но не убрать.' : ''}</p>
      {!open ? (
        <div className="actions">
          {state.telegram && (
            <button type="button" className={state.phone ? 'btn' : 'btn primary'} disabled={viaTelegram.busy} onClick={viaTelegram.start}>
              {viaTelegram.busy ? <><Spinner />Ждём номер…</> : state.phone ? 'Сменить на номер Telegram' : 'Подтвердить через Telegram'}</button>
          )}
          {state.sms
            ? <button type="button" className="btn" onClick={() => setOpen(true)}>{state.phone ? 'Изменить' : state.telegram ? 'Указать по SMS' : 'Указать телефон'}</button>
            : !state.telegram && <p className="hint">SMS не подключены — номер для входа сейчас не задать.</p>}
          {state.phone && !state.phoneOnly && (
            <button type="button" className="btn ghost" disabled={remove.isPending}
              onClick={() => void ask('Убрать свой телефон? Входить по номеру будет нельзя, через Telegram — как раньше.').then((ok) => ok && remove.mutate())}>
              Убрать номер</button>
          )}
          {remove.error && <p className="error" role="alert">{remove.error.message}</p>}
          {viaTelegram.note && <p className="hint" role="status">{viaTelegram.note}</p>}
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
      ) : !token ? (
        <form className="form narrow" aria-label="Подтвердить номер" onSubmit={(e) => { e.preventDefault(); confirm.mutate() }}>
          <p className="hint" role="status">Отправили SMS с кодом на {phoneText(sentTo.replace(/\s/g, ''))}. Код действует 5 минут.</p>
          <CodeInput value={code} onChange={setCode} />
          {error && <p className="error" role="alert">{error.fieldErrors.code ?? error.fieldErrors.phone ?? error.message}</p>}
          <ResendLink wait={wait} sms={false} busy={sendCode.isPending} onSms={() => sendCode.mutate(sentTo)} onAgain={() => sendCode.mutate(sentTo)} />
          <div className="actions">
            <button type="submit" className="btn primary" disabled={confirm.isPending || code.length !== 6}>
              {confirm.isPending ? <><Spinner />Проверяем…</> : 'Подтвердить'}</button>
            <button type="button" className="btn ghost" onClick={close}>Отмена</button>
          </div>
        </form>
      ) : (
        <form className="form narrow" aria-label="Придумайте пароль для входа по номеру" onSubmit={(e) => {
          e.preventDefault()
          const p = passwordProblem(fresh.password, fresh.repeat, phoneDigits)
          setProblem(p)
          if (!p) savePassword.mutate()
        }}>
          <h3>Придумайте пароль для входа по номеру</h3>
          <p className="hint">Номер {phoneText(sentTo.replace(/\s/g, ''))} подтверждён. Паролем будете входить на сайте по номеру.</p>
          <NewPasswordFields password={fresh.password} repeat={fresh.repeat} phone={phoneDigits} label="Пароль для входа по номеру"
            onPassword={(v) => setFresh({ ...fresh, password: v })} onRepeat={(v) => setFresh({ ...fresh, repeat: v })} />
          {(problem || savePassword.error) && <p className="error" role="alert">{problem
            || (savePassword.error && (savePassword.error.fieldErrors.newPassword ?? savePassword.error.fieldErrors.setupToken ?? savePassword.error.message))}</p>}
          <div className="actions">
            <button type="submit" className="btn primary" disabled={savePassword.isPending}>
              {savePassword.isPending ? <><Spinner />Сохраняем…</> : 'Сохранить пароль'}</button>
            <button type="button" className="btn ghost" onClick={skipPassword}>Пропустить</button>
          </div>
        </form>
      )}
    </div>
  )
}

/**
 * «Подтвердить через Telegram»: номер своего аккаунта Telegram — боту сотрудников, бот привязывает его.
 * В Mini App — requestContact (Telegram сам спросит «Поделиться номером?»), потом ждём номер в
 * /api/me/phone. На сайте — бот по ссылке «?start=phone» (там кнопка «📱 Поделиться номером»); вернулись
 * на вкладку — номер подтянется сам (react-query перечитывает при возврате на вкладку).
 */
function useTelegramShare(current: string | null, refresh: () => void) {
  const client = useQueryClient()
  const bot = useQuery({ queryKey: ['bot-username'], queryFn: botUsername, staleTime: Infinity, enabled: !telegram() })
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const start = () => {
    setNote('')
    const app = telegram()
    if (!app) {
      if (!bot.data) {
        setNote('Откройте бота клиники в Telegram и нажмите «📱 Поделиться номером» (или команда /phone).')
        return
      }
      window.open(`https://t.me/${bot.data}?start=phone`, '_blank', 'noopener,noreferrer')
      setNote('В Telegram нажмите внизу «📱 Поделиться номером» — потом вернитесь сюда, номер появится сам.')
      return
    }
    if (!app.requestContact || (app.isVersionAtLeast && !app.isVersionAtLeast('6.9'))) {
      setNote('Обновите Telegram или отправьте боту команду /phone — там кнопка «📱 Поделиться номером».')
      return
    }
    app.requestContact((shared) => {
      if (!shared) {
        setNote('Номер не отправлен. Можно указать его по SMS или позже.')
        return
      }
      setBusy(true)
      void (async () => {
        for (let i = 0; i < 10; i += 1) {
          await new Promise((r) => setTimeout(r, 800))
          const fresh = await unwrap(api.GET('/api/me/phone')).catch(() => null)
          if (fresh?.phone && fresh.phone !== current) {
            client.setQueryData(['me-phone'], fresh)
            refresh()
            setBusy(false)
            void notify('Номер подтверждён через Telegram. Теперь задайте пароль для входа на сайте — ниже, в «Пароль и вход».')
            return
          }
        }
        setBusy(false)
        setNote('Номер пока не пришёл — бот ответит в чате. Если номер уже у другого сотрудника, бот так и напишет.')
      })()
    })
  }
  return { start, busy, note }
}
