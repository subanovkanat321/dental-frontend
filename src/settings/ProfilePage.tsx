import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'

import { api, ApiError, botUsername, unwrap, WEB_CONFIG_KEY, webConfig, type Schemas } from '../api/client'
import { PhoneInput } from '../clinic/PhoneInput'
import { phoneFromInput } from '../clinic/phone'
import { ask, notify } from '../lib/confirm'
import { DoctorPanel } from '../team/DoctorPanel'
import { AddSelf } from '../team/AddSelf'
import { PHONE_HINT, type Doctor } from '../team/PhoneParts'
import { phoneText } from '../team/texts'
import { SubHeader } from './SubHeader'
import { Loading, Spinner } from '../layout/Loading'
import { CodeInput, ResendLink } from '../layout/CodeStep'
import { useCountdown } from '../lib/otp'
import { NewPasswordFields } from '../layout/PasswordFields'
import { passwordProblem } from '../lib/password'
import { telegram } from '../lib/telegram'
import { PasswordSection } from './PasswordSection'
import { HelpHint } from '../help/HelpHint'
import { Icon } from '../layout/Icon'
import { RowMenu } from '../patients/CalmList'
import { SaveBar } from '../layout/SaveBar'
import { useDirty } from '../lib/unsaved'

type Me = Schemas['BookingViewsMe']

/**
 * «Мой профиль» — всё о себе заполняет сам сотрудник (админ только приглашает). Разделы — подпись над
 * карточкой; на компьютере — сеткой в две колонки во всю ширину (с 2026-11-14, crm.css): сверху кто вы — врачу «Для пациентов» (фото, имя, «о себе» —
 * их видят в боте), остальным (админ без кресла, регистратура, ассистент) «Имя» — как видят коллеги; дальше
 * «Телефон» (у всех, и у владельца платформы), врачу — «Работа» и «Вход и права». В самом низу — «Пароль и
 * вход»: с Telegram он необязателен (только для входа по номеру), и «Выйти».
 */
export function ProfilePage({ me, onBack, footer }: { me: Me; onBack: () => void; footer?: ReactNode }) {
  const admin = useQuery({
    queryKey: ['doctors-admin'],
    queryFn: () => unwrap(api.GET('/api/doctors/admin')),
    enabled: Boolean(me.admin) && me.doctorId != null,
  })
  const own: Doctor | undefined = me.admin
    ? admin.data?.find((d) => d.id === me.doctorId)
    : (me.doctors ?? []).find((d) => d.id === me.doctorId)

  return (
    <section className="schedule-main profile-page">
      <SubHeader title="Мой профиль" onBack={onBack} />
      {me.doctorId == null ? (
        <>
        <MyName />
        <MyPhone />
        <section className="settings-group" aria-label="Для пациентов">
          <h2>Для пациентов</h2>
          <div className="card-block">
            {me.admin || me.reception ? <AddSelf />
              : <p className="hint">Профиль для пациентов есть у врачей: фото, имя и «о себе» видны при записи в боте.</p>}
          </div>
        </section>
        </>
      ) : me.admin && admin.isPending ? <Loading />
        : admin.error ? <p className="error">{admin.error.message}</p>
          : own ? <DoctorPanel key={own.id} doctor={own} me={me} onClose={onBack} inline afterProfile={<MyPhone />} />
            : <><MyPhone /><p className="hint">Профиль не найден — обновите страницу.</p></>}
      {/* Внизу, не «надо сделать»: с Telegram пароль не нужен — только для входа по номеру */}
      <PasswordSection />
      {footer}
    </section>
  )
}

/**
 * «Имя» сотрудника без кресла: при приглашении его вписал админ (черновик) — дальше человек правит сам
 * ({@code PUT /api/me/name}, в журнал — «изменил(а) своё имя»). У входа поддержки имени в клинике нет — блока нет.
 */
function MyName() {
  const name = useQuery({ queryKey: ['me-name'], queryFn: () => unwrap(api.GET('/api/me/name')) })
  if (name.isPending) return <Loading />
  if (name.error) return <p className="error">{name.error.message}</p>
  if (!name.data.editable) return null
  return (
    <section className="settings-group" aria-label="Имя">
      <h2>Имя</h2>
      <MyNameForm current={name.data.fullName ?? ''} />
    </section>
  )
}

function MyNameForm({ current }: { current: string }) {
  const client = useQueryClient()
  const [value, setValue] = useState(current)
  const { dirty, commit } = useDirty(value)
  const save = useMutation<Schemas['StaffMembersOwnName'], ApiError>({
    mutationFn: () => unwrap(api.PUT('/api/me/name', { body: { fullName: value } })),
    onSuccess: (r) => {
      commit()
      client.setQueryData(['me-name'], r)
      void client.invalidateQueries({ queryKey: ['members'] })
    },
  })
  return (
    <form className="card-block form narrow" aria-label="Моё имя" onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
      <label className="field"><span>Имя</span>
        <input value={value} required maxLength={100} placeholder="Например: Айпери Исакова" onChange={(e) => { save.reset(); setValue(e.target.value) }} />
      </label>
      <p className="hint">Так вас видят коллеги в «Персонале», графике смен и журнале действий.</p>
      <SaveBar dirty={dirty} saving={save.isPending} saved={save.isSuccess} savedText="Имя сохранено"
        error={save.error && (save.error.fieldErrors.fullName ?? save.error.message)} />
    </form>
  )
}

type MyPhoneState = Schemas['MyPhoneControllerMyPhone']

/** Бот берёт номер аккаунта Telegram и ставит его вместо текущего (раньше — «Сменить на номер Telegram»). */
const TAKE_FROM_TELEGRAM = 'Взять номер из Telegram'

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
    <div className="card-block phone-card">
      {!open ? (
        <>
          <div className="setting-line">
            <div className="setting-what">
              {state.phone ? <p className="phone-number num">{phoneText(state.phone)}</p> : <p className="hint">Телефон не указан.</p>}
              <p className="hint setting-sub">{state.phoneOnly ? 'Ваш вход без Telegram — номер и пароль' : 'Для входа без Telegram — с паролем'}{' '}
                <HelpHint title="Номер для входа">{PHONE_HINT}{state.phoneOnly ? ' Без Telegram это ваш единственный вход: номер можно сменить, но не убрать.' : ''}</HelpHint></p>
            </div>
            <div className="setting-actions">
              {state.phone ? (
                <>
                  {state.sms
                    ? <button type="button" className="btn" onClick={() => setOpen(true)}><Icon name="edit" />Изменить</button>
                    : state.telegram && <button type="button" className="btn" disabled={viaTelegram.busy} onClick={viaTelegram.start}>
                      {viaTelegram.busy ? <><Spinner />Ждём номер…</> : TAKE_FROM_TELEGRAM}</button>}
                  <RowMenu label="Ещё действия с номером" items={[
                    ...(state.telegram && state.sms ? [{ label: TAKE_FROM_TELEGRAM, onSelect: viaTelegram.start, disabled: viaTelegram.busy }] : []),
                    ...(!state.phoneOnly ? [{ label: 'Убрать номер', tone: 'bad' as const, disabled: remove.isPending,
                      onSelect: () => void ask('Убрать свой телефон? Входить по номеру будет нельзя, через Telegram — как раньше.').then((ok) => ok && remove.mutate()) }] : []),
                  ]} />
                </>
              ) : (
                <>
                  {state.telegram && (
                    <button type="button" className="btn primary" disabled={viaTelegram.busy} onClick={viaTelegram.start}>
                      {viaTelegram.busy ? <><Spinner />Ждём номер…</> : 'Подтвердить через Telegram'}</button>
                  )}
                  {state.sms && <button type="button" className="btn" onClick={() => setOpen(true)}>{state.telegram ? 'Указать по SMS' : 'Указать телефон'}</button>}
                </>
              )}
            </div>
          </div>
          {!state.sms && !state.telegram && <p className="hint">SMS не подключены — номер для входа сейчас не задать.</p>}
          {viaTelegram.busy && state.phone && state.sms && <p className="hint" role="status"><Spinner />Ждём номер из Telegram…</p>}
          {remove.error && <p className="error" role="alert">{remove.error.message}</p>}
          {viaTelegram.note && <p className="hint" role="status">{viaTelegram.note}</p>}
        </>
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
  const bot = useQuery({ queryKey: WEB_CONFIG_KEY, queryFn: webConfig, staleTime: Infinity, enabled: !telegram(), select: botUsername })
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
            void notify('Номер подтверждён через Telegram.')
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
