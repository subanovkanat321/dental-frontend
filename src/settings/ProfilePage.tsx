import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'

import { api, ApiError, botUsername, unwrap, WEB_CONFIG_KEY, webConfig, type Schemas } from '../api/client'
import { ask, notify } from '../lib/confirm'
import { DoctorPanel } from '../team/DoctorPanel'
import { AddSelf } from '../team/AddSelf'
import { PHONE_HINT, type Doctor } from '../team/PhoneParts'
import { phoneText } from '../team/texts'
import { SubHeader } from './SubHeader'
import { Loading, Spinner } from '../layout/Loading'
import { CodeInput, ResendLink } from '../layout/CodeStep'
import { useCountdown } from '../lib/otp'
import { Icon } from '../layout/Icon'
import { telegram } from '../lib/telegram'
import { PasswordSection } from './PasswordSection'
import { TelegramSection } from './TelegramSection'
import { showsPlatform } from '../platform/platformAccess'
import { HelpHint } from '../help/HelpHint'
import { RowMenu } from '../patients/CalmList'
import { SaveBar } from '../layout/SaveBar'
import { useDirty } from '../lib/unsaved'

type Me = Schemas['BookingViewsMe']

/**
 * «Мой профиль» — всё о себе заполняет сам сотрудник (админ только приглашает). Разделы — подпись над
 * карточкой; на компьютере — сеткой в две колонки во всю ширину (с 2026-11-14, crm.css): сверху кто вы — врачу «Для пациентов» (фото, имя, «о себе» —
 * их видят в боте), остальным (админ без кресла, регистратура, ассистент) «Имя» — как видят коллеги; дальше
 * «Телефон» и под ним «Почта» (у всех, и у владельца платформы), врачу — «Работа» и «Вход и права»; дальше «Telegram» (сменить
 * Telegram или подключить его, TelegramSection). В самом низу — «Пароль и
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
      {/* Как вы входите: Telegram (сменить на другой аккаунт) или «Подключить Telegram» */}
      <TelegramSection />
      {/* Внизу, не «надо сделать»: логин с паролем — для входа без Telegram */}
      <PasswordSection platform={showsPlatform(me)} />
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

/** Без Telegram номер не подтвердить самому: SMS убраны (2026-11-27) — номер и пароль выдаёт руководитель. */
export const NO_TELEGRAM_PHONE = 'Номер подтверждается кнопкой в Telegram. Telegram нет — номер меняет руководитель («Клиника → Персонал»), а пароль — «Логин и пароль» ниже (забыли — «Забыли пароль?» на странице входа: код на почту).'

/**
 * «Телефон» в «Моём профиле»: свой номер для входа на сайте. Привязывается только подтверждённым:
 * <ul>
 * <li>у кого есть Telegram — «Подтвердить через Telegram» (бесплатно): в Mini App — запрос контакта
 * Telegram, на сайте — бот по ссылке «?start=phone» с кнопкой «📱 Поделиться номером». Telegram отдаёт
 * номер своего аккаунта, поэтому это и есть подтверждение (код в свой же Telegram не доказал бы, что
 * номер ваш);</li>
 * <li>запасной способ — кодом из SMS на этот номер: номер → «Получить код» → код → «Подтвердить» → только
 * потом «Придумайте пароль для входа по номеру» (сервер выдал одноразовый пропуск; шаг можно пропустить и
 * задать пароль позже в «Логин и пароль»).</li>
 * </ul>
 * Убрать (у кого есть Telegram) — без кода.
 */
function MyPhone() {
  const phone = useQuery({ queryKey: ['me-phone'], queryFn: () => unwrap(api.GET('/api/me/phone')) })
  return (
    <>
      <section className="settings-group" aria-label="Телефон">
        <h2>Телефон</h2>
        {phone.isPending ? <Loading /> : phone.error ? <p className="error">{phone.error.message}</p>
          : <MyPhoneCard key={phone.data.phone ?? ''} state={phone.data} />}
      </section>
      <MyEmail />
    </>
  )
}

type MyEmailState = Schemas['MyEmailControllerMyEmail']

const EMAIL_HINT = 'Почта — чтобы восстановить пароль, если нет Telegram: на странице входа «Забыли пароль? / Первый вход» → номер → «На почту». Сохраняется только после кода из письма.'

/**
 * «Почта» в «Моём профиле» (рядом с «Телефоном»): на неё придёт код «Забыли пароль?», если нет Telegram. Добавить или
 * сменить — адрес → письмо с кодом → «Подтвердить»: без кода сервер почту не сохраняет (иначе кто-то вписал бы свою и
 * восстановил чужой пароль). Убрать — без кода. Почта — у номера входа: без телефона блок просит сначала его. Почта на
 * сервере не настроена (MAIL_*) — блока нет. Адрес не пишем ни в консоль, ни в localStorage.
 */
function MyEmail() {
  const email = useQuery({ queryKey: ['me-email'], queryFn: () => unwrap(api.GET('/api/me/email')) })
  if (email.isPending || email.error || !email.data.available) return null
  return (
    <section className="settings-group" aria-label="Почта">
      <h2>Почта</h2>
      <MyEmailCard key={email.data.email ?? ''} state={email.data} />
    </section>
  )
}

function MyEmailCard({ state }: { state: MyEmailState }) {
  const client = useQueryClient()
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const [sentTo, setSentTo] = useState('')
  const [code, setCode] = useState('')
  const [wait, restart] = useCountdown()
  const sendCode = useMutation<unknown, ApiError, string>({
    mutationFn: (email) => unwrap(api.POST('/api/me/email/code', { body: { email } })),
    onSuccess: (_r, email) => { setSentTo(email.trim().toLowerCase()); setCode(''); restart() },
  })
  const confirm = useMutation<MyEmailState, ApiError>({
    mutationFn: () => unwrap(api.PUT('/api/me/email', { body: { email: sentTo, code } })),
    onSuccess: (r) => {
      client.setQueryData(['me-email'], r)
      void notify('Почта подтверждена. Забудете пароль — код можно получить на неё.')
    },
  })
  const remove = useMutation<MyEmailState, ApiError>({
    mutationFn: () => unwrap(api.DELETE('/api/me/email')),
    onSuccess: (r) => client.setQueryData(['me-email'], r),
  })
  const close = () => {
    setOpen(false)
    setSentTo('')
    setCode('')
    sendCode.reset()
    confirm.reset()
  }
  const error = confirm.error ?? sendCode.error

  if (!state.phoneLogin) {
    return (
      <div className="card-block">
        <p className="hint">Почта нужна, чтобы восстановить пароль входа по номеру. Сначала укажите телефон — выше, в «Телефоне».{' '}
          <HelpHint title="Почта">{EMAIL_HINT}</HelpHint></p>
      </div>
    )
  }

  return (
    <div className="card-block email-card">
      {!open ? (
        <>
          <div className="setting-line">
            <div className="setting-what">
              {state.email ? <p className="email-address">{state.email}</p> : <p className="hint">Почта не указана.</p>}
              <p className="hint setting-sub">Чтобы восстановить пароль без Telegram{' '}
                <HelpHint title="Почта">{EMAIL_HINT}</HelpHint></p>
            </div>
            <div className="setting-actions">
              {state.email ? (
                <>
                  <button type="button" className="btn" onClick={() => setOpen(true)}><Icon name="edit" />Изменить</button>
                  <RowMenu label="Ещё действия с почтой" items={[{ label: 'Убрать почту', tone: 'bad' as const, disabled: remove.isPending,
                    onSelect: () => void ask('Убрать почту? Код «Забыли пароль?» тогда придёт только в Telegram или по SMS.').then((ok) => ok && remove.mutate()) }]} />
                </>
              ) : (
                <button type="button" className="btn" onClick={() => setOpen(true)}>Добавить почту</button>
              )}
            </div>
          </div>
          {remove.error && <p className="error" role="alert">{remove.error.message}</p>}
        </>
      ) : !sentTo ? (
        <form className="form narrow" aria-label="Моя почта" onSubmit={(e) => { e.preventDefault(); sendCode.mutate(value) }}>
          <label className="field"><span>{state.email ? 'Новая почта' : 'Почта'}</span>
            <input type="email" value={value} autoComplete="email" inputMode="email" maxLength={254} placeholder="name@gmail.com"
              onChange={(e) => { sendCode.reset(); setValue(e.target.value) }} />
          </label>
          <p className="hint">Пришлём письмо с кодом — им подтвердите, что почта ваша.</p>
          {error && <p className="error" role="alert">{error.fieldErrors.email ?? error.message}</p>}
          <div className="actions">
            <button type="submit" className="btn primary" disabled={sendCode.isPending || !value.trim()}>
              {sendCode.isPending ? <><Spinner />Отправляем…</> : 'Получить код'}</button>
            <button type="button" className="btn ghost" onClick={close}>Отмена</button>
          </div>
        </form>
      ) : (
        <form className="form narrow" aria-label="Подтвердить почту" onSubmit={(e) => { e.preventDefault(); confirm.mutate() }}>
          <p className="hint" role="status">Отправили письмо с кодом на <b>{sentTo}</b>. Код действует 10 минут; письма нет — проверьте «Спам».</p>
          <CodeInput value={code} onChange={setCode} />
          {error && <p className="error" role="alert">{error.fieldErrors.code ?? error.fieldErrors.email ?? error.message}</p>}
          <ResendLink wait={wait} busy={sendCode.isPending} onAgain={() => sendCode.mutate(sentTo)} />
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

/**
 * «Телефон» в «Моём профиле»: номер для входа на сайте по номеру (или логину) и паролю. Подтверждается только кнопкой в
 * Telegram («📱 Поделиться номером» — Telegram сам отдаёт номер аккаунта); подтверждения кодом из SMS нет (убрано
 * 2026-11-27). Сотруднику без Telegram номер задаёт руководитель («Клиника → Персонал»), пароль — «Логин и пароль».
 */
function MyPhoneCard({ state }: { state: MyPhoneState }) {
  const client = useQueryClient()
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['me-phone'] })
    void client.invalidateQueries({ queryKey: ['me-password'] })
    // Почта живёт у номера входа: номер появился или убран — блок «Почта» меняется
    void client.invalidateQueries({ queryKey: ['me-email'] })
  }
  const remove = useMutation<unknown, ApiError>({ mutationFn: () => unwrap(api.DELETE('/api/me/phone')), onSuccess: refresh })
  const viaTelegram = useTelegramShare(state.phone ?? null, refresh)

  return (
    <div className="card-block phone-card">
      <div className="setting-line">
        <div className="setting-what">
          {state.phone ? <p className="phone-number num">{phoneText(state.phone)}</p> : <p className="hint">Телефон не указан.</p>}
          <p className="hint setting-sub">{state.phoneOnly ? 'Ваш вход без Telegram — номер и пароль' : 'Для входа без Telegram — с паролем'}{' '}
            <HelpHint title="Номер для входа">{PHONE_HINT}{state.phoneOnly ? ' Без Telegram это ваш единственный вход: номер меняет руководитель, убрать его нельзя.' : ''}</HelpHint></p>
        </div>
        <div className="setting-actions">
          {state.telegram && (
            <button type="button" className={state.phone ? 'btn' : 'btn primary'} disabled={viaTelegram.busy} onClick={viaTelegram.start}>
              {viaTelegram.busy ? <><Spinner />Ждём номер…</> : state.phone ? TAKE_FROM_TELEGRAM : 'Подтвердить через Telegram'}</button>
          )}
          {state.phone && !state.phoneOnly && (
            <RowMenu label="Ещё действия с номером" items={[{ label: 'Убрать номер', tone: 'bad' as const, disabled: remove.isPending,
              onSelect: () => void ask('Убрать свой телефон? Входить по номеру будет нельзя, через Telegram — как раньше.').then((ok) => ok && remove.mutate()) }]} />
          )}
        </div>
      </div>
      {!state.telegram && <p className="hint">{NO_TELEGRAM_PHONE}</p>}
      {remove.error && <p className="error" role="alert">{remove.error.message}</p>}
      {viaTelegram.note && <p className="hint" role="status">{viaTelegram.note}</p>}
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
        setNote('Номер не отправлен. Можно подтвердить позже — той же кнопкой или командой /phone в боте.')
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
