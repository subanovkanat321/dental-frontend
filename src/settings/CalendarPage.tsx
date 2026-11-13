import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { openLink, telegram } from '../lib/telegram'
import { shortDate } from '../lib/time'
import { SubHeader } from './SubHeader'
import './calendar.css'
import { Loading } from '../layout/Loading'

type Feed = Schemas['CalendarFeedControllerFeedView']

const KEY = ['calendar-feed']

/**
 * «📅 Календарь в телефоне»: приёмы врача в Google или Apple Календаре — подписка на ленту по
 * секретной ссылке (только чтение). Сервер хранит хеш ссылки: сама ссылка видна один раз, сразу
 * после «Включить» или «Сменить ссылку», — её не пишем ни в localStorage, ни в адрес страницы.
 */
export function CalendarPage({ onBack }: { onBack: () => void }) {
  return (
    <section className="schedule-main">
      <SubHeader title="Календарь в телефоне" onBack={onBack} />
      <CalendarFeed />
    </section>
  )
}

export function CalendarFeed() {
  const client = useQueryClient()
  const feed = useQuery({ queryKey: KEY, queryFn: () => unwrap(api.GET('/api/calendar-feed')) })
  // Свежая ссылка — только в памяти этой страницы
  const [link, setLink] = useState<Feed | null>(null)
  const saved = (data: Feed) => client.setQueryData(KEY, { ...data, httpsUrl: undefined, webcalUrl: undefined })
  const rotate = useMutation<Feed, ApiError>({
    mutationFn: () => unwrap(api.POST('/api/calendar-feed')),
    onSuccess: (data) => { setLink(data); saved(data) },
  })
  const off = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.DELETE('/api/calendar-feed')),
    onSuccess: () => { setLink(null); client.setQueryData<Feed>(KEY, { enabled: false, showPatientNames: false }) },
  })

  if (feed.isPending) return <Loading />
  if (feed.error) return <p className="error">{feed.error.message}</p>
  const enabled = feed.data.enabled
  const error = rotate.error ?? off.error

  return (
    <div className="calendar-feed">
      <div className="card-block">
        <p>Ваши приёмы — в календаре телефона рядом с личными делами: Google Календарь или Календарь iPhone сам подтягивает
          новые записи и переносы. Только просмотр: записывать и переносить — по-прежнему в Tish.</p>
        {!enabled && (
          <div className="actions">
            <button type="button" className="btn primary" disabled={rotate.isPending} onClick={() => rotate.mutate()}>📅 Включить календарь</button>
          </div>
        )}
        {enabled && !link && (
          <p className="hint">Календарь включён{feed.data.createdAt ? ` ${shortDate(feed.data.createdAt)}` : ''}. Ссылка показывается один раз —
            потеряли или хотите подключить ещё телефон — нажмите «Сменить ссылку», старая перестанет работать.</p>
        )}
        {link?.httpsUrl && <FeedLink https={link.httpsUrl} webcal={link.webcalUrl ?? link.httpsUrl} />}
        {enabled && (
          <div className="actions">
            <button type="button" className="btn" disabled={rotate.isPending} onClick={() => rotate.mutate()}>🔄 Сменить ссылку</button>
            <button type="button" className="btn danger" disabled={off.isPending} onClick={() => off.mutate()}>Выключить</button>
          </div>
        )}
        {error && <p className="error" role="alert">{error.message}</p>}
      </div>
      {enabled && <PatientNames feed={feed.data} onSaved={saved} />}
      <Instructions />
    </div>
  )
}

/** Ссылка один раз: открыть в календаре (webcal — iPhone сразу предлагает подписаться) или скопировать. */
function FeedLink({ https, webcal }: { https: string; webcal: string }) {
  const [copied, setCopied] = useState('')
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(https)
      setCopied('Скопировано — вставьте в Google Календарь')
    } catch {
      setCopied('Не получилось скопировать — выделите ссылку')
    }
  }
  return (
    <div className="invite">
      <p className="hint">Ваша ссылка — как ключ: по ней видно ваше расписание. Не пересылайте её никому; утекла — «Сменить ссылку».</p>
      <span className="invite-link" aria-label="Ссылка календаря">{https}</span>
      <div className="actions">
        {/* Ссылкой, а не window.open: webcal:// браузер отдаёт календарю системы. В Telegram — его openLink */}
        <a className="btn primary" href={webcal} onClick={(e) => { if (telegram()) { e.preventDefault(); openLink(webcal) } }}>Открыть в календаре</a>
        <button type="button" className="btn" onClick={() => void copy()}>Скопировать</button>
      </div>
      {copied && <p className="tone-ok" role="status">{copied}</p>}
    </div>
  )
}

/**
 * Имя пациента в событиях — только по выбору врача и после предупреждения: календарь — сервис
 * Google или Apple, данные пациента уйдут к ним. Телефона и комментария в ленте нет никогда.
 */
function PatientNames({ feed, onSaved }: { feed: Feed; onSaved: (data: Feed) => void }) {
  const [asking, setAsking] = useState(false)
  const save = useMutation<Feed, ApiError, boolean>({
    mutationFn: (show) => unwrap(api.PUT('/api/calendar-feed/names', { body: { showPatientNames: show } })),
    onSuccess: (data) => { setAsking(false); onSaved(data) },
  })
  const on = Boolean(feed.showPatientNames)
  return (
    <div className="card-block">
      <h2>Что видно в событии</h2>
      <p>{on ? 'Имя пациента и услуга: «Имя Фамилия · Пломба». Телефона нет.' : 'Только услуга: «Приём · Пломба». Имени и телефона пациента нет.'}</p>
      <label className="check">
        <input type="checkbox" checked={on || asking} disabled={save.isPending}
          onChange={(e) => (e.target.checked ? setAsking(true) : asking ? setAsking(false) : save.mutate(false))} />
        Показывать имя пациента
      </label>
      {asking && (
        <div className="calendar-warning" role="alertdialog" aria-label="Показывать имена пациентов?">
          <p><strong>Имена пациентов уйдут в Google или Apple.</strong> Календарь хранит их на своих серверах и показывает
            на экране блокировки и в уведомлениях. Это медицинская тайна: включайте, только если телефон — лично ваш и под паролем.</p>
          <div className="actions">
            <button type="button" className="btn primary" disabled={save.isPending} onClick={() => save.mutate(true)}>Показывать имена</button>
            <button type="button" className="btn ghost" onClick={() => setAsking(false)}>Не надо</button>
          </div>
        </div>
      )}
      {save.error && <p className="error" role="alert">{save.error.message}</p>}
    </div>
  )
}

function Instructions() {
  return (
    <div className="card-block guide">
      <h2>Как подключить</h2>
      <p><strong>iPhone:</strong></p>
      <ol>
        <li>Откройте эту страницу на iPhone и нажмите «Открыть в календаре».</li>
        <li>Подтвердите «Подписаться» — приёмы появятся в «Календаре».</li>
        <li>Или вручную: «Настройки → Приложения → Календарь → Учётные записи → Добавить → Другое → Подписной календарь» и вставьте ссылку.</li>
      </ol>
      <p><strong>Google Календарь (Android):</strong></p>
      <ol>
        <li>Скопируйте ссылку и откройте calendar.google.com на компьютере.</li>
        <li>Слева «Другие календари» → «＋» → «Добавить по URL», вставьте ссылку.</li>
        <li>Календарь появится в телефоне сам (в приложении включите его в списке календарей).</li>
      </ol>
      <p className="hint small">Google обновляет подписные календари реже — до нескольких часов; iPhone — примерно раз в полчаса.
        Свежее всегда в Tish.</p>
    </div>
  )
}
