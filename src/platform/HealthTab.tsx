import { useQuery } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { shortDate } from '../lib/time'
import { Loading } from '../layout/Loading'
import { mbText, uptimeText } from './serverHealth'

type Health = Schemas['HealthServiceHealth']
type Job = Schemas['HealthServiceJob']
type Files = Schemas['HealthServiceFiles']
type LogResult = Schemas['LogSearchResult']

const when = (instant?: string) => (instant ? shortDate(instant, true) : '—')

const JOB_STATUS: Record<string, [string, string]> = {
  SUCCESS: ['успешно', 's-ok'],
  ERROR: ['ошибка', 's-bad'],
  STARTED: ['идёт', 's-request'],
  NONE: ['ещё не запускалась', 's-quiet'],
}

/** Строка «что — значение»: тон — ok / bad / wait. */
function Row({ name, children, tone }: { name: string; children: React.ReactNode; tone?: 'ok' | 'bad' | 'wait' }) {
  return (
    <tr>
      <th scope="row">{name}</th>
      <td className={tone ? `tone-${tone}` : undefined}>{children}</td>
    </tr>
  )
}

/**
 * «Здоровье» — только владелец платформы (сервер отвечает 403 остальным): жив ли сервер, база, бэкап,
 * задачи по расписанию, Telegram, SMS, ИИ и ошибки 5xx за сутки; ниже — строки лога по номеру запроса из
 * оповещения. Данных пациентов тут нет: только числа, времена, классы ошибок и шаблоны путей.
 */
/** Режим бота словами: «режим off» владельцу ничего не говорит. */
const TG_MODE: Record<string, string> = {
  off: 'бот выключен (режим off) — сообщения не принимаются и не уходят',
  polling: 'бот спрашивает Telegram сам (polling), без webhook',
}

export function HealthTab() {
  const health = useQuery<Health, ApiError>({
    queryKey: ['platform-health'],
    queryFn: () => unwrap(api.GET('/api/platform/health')),
  })
  const h = health.data
  return (
    <>
      {/* «Проверить снова» — ссылкой в строке «Проверено …», а не одной кнопкой строкой-шапкой над карточкой */}
      <section className="card-block" aria-label="Здоровье сервера">
        <p className="hint small">{h ? `Проверено ${when(h.checkedAt)}. ` : ''}Раз в час то же проверяет сервер и пишет вам в бот, если что-то не так.{' '}
          <button type="button" className="link" disabled={health.isFetching} onClick={() => void health.refetch()}>
            {health.isFetching ? 'Проверяю…' : 'Проверить снова'}</button></p>
        {health.error && <p className="error" role="alert">{health.error.message}</p>}
        {health.isPending ? <Loading /> : h && (
          <>
            {(h.problems?.length ?? 0) > 0 ? (
              <div role="alert" aria-label="Сейчас не так">
                <p className="tone-bad strong">Сейчас не так:</p>
                <ul>{h.problems!.map((p) => <li key={p.code} className="tone-bad">{p.text}</li>)}</ul>
              </div>
            ) : <p className="tone-ok strong" role="status">Всё в порядке</p>}
          </>
        )}
      </section>
      {h && <Sections h={h} />}
      <LogSearch />
    </>
  )
}

function Sections({ h }: { h: Health }) {
  const app = h.app
  const db = h.db
  const backup = h.backup
  const tg = h.telegram
  return (
    <>
      <section className="card-block">
        <h2>Приложение и база</h2>
        <table className="table" aria-label="Приложение и база">
          <tbody>
            {app && <>
              <Row name="Работает">{uptimeText(app.uptimeSeconds)} · с {when(app.startedAt)}</Row>
              <Row name="Версия">{app.version ?? '—'} · коммит {app.commit ?? 'не указан'}{app.builtAt ? ` · собрано ${when(app.builtAt)}` : ''}</Row>
              <Row name="Java">{app.java}</Row>
              <Row name="Память и процессор">
                куча {app.heapUsedMb} из {app.heapMaxMb} МБ · процессор {app.cpuPercent != null ? `${app.cpuPercent}%` : '—'} · ядер {app.processors}
              </Row>
              <Row name="Диск" tone={app.disk ? (app.disk.usedPercent > 85 ? 'bad' : 'ok') : undefined}>
                {app.disk ? `занято ${app.disk.usedPercent}% · свободно ${mbText(app.disk.freeMb)} из ${mbText(app.disk.totalMb)}` : 'не узнать'}
              </Row>
            </>}
            {db && (db.up ? (
              <Row name="База" tone={(db.queryMs ?? 0) > 1000 ? 'bad' : 'ok'}>
                отвечает за {db.queryMs} мс · {mbText(db.sizeMb ?? 0)} · соединений {db.connections}
                {db.poolMax != null && ` · пул приложения: занято ${db.poolActive ?? 0} из ${db.poolMax}`}
              </Row>
            ) : <Row name="База" tone="bad">недоступна ({db.error})</Row>)}
            <Row name="Последний бэкап" tone={!backup?.lastAt ? 'wait' : backup.stale ? 'bad' : 'ok'}>
              {!backup ? '—' : backup.lastAt
                ? `${when(backup.lastAt)} · ${backup.ageHours} ч назад · ${mbText(backup.sizeMb ?? 0)} · ${backup.offsite ? 'копия в R2 ушла' : 'только на сервере'}`
                : 'отметок нет — обновите deploy/backup.sh на сервере (RUNBOOK, «Бэкап»)'}
            </Row>
            {h.files && <FilesRow files={h.files} />}
          </tbody>
        </table>
      </section>
      <section className="card-block">
        <h2>Связи</h2>
        <table className="table" aria-label="Связи">
          <tbody>
            {tg && (tg.mode !== 'webhook' ? <Row name="Telegram" tone={tg.mode === 'off' ? 'wait' : undefined}>{TG_MODE[tg.mode ?? ''] ?? `режим ${tg.mode}`}</Row> : tg.error
              ? <Row name="Telegram" tone="wait">не удалось спросить Telegram ({tg.error})</Row>
              : (
                <Row name="Telegram" tone={tg.webhookSet === false ? 'bad' : 'ok'}>
                  {tg.webhookSet === false ? 'webhook не установлен' : 'webhook установлен'} · ждут доставки {tg.pendingUpdates ?? 0}
                  {tg.lastErrorAt && ` · последняя ошибка ${when(tg.lastErrorAt)}: ${tg.lastError}`}
                </Row>
              ))}
            {h.sms && (
              <Row name="SMS" tone={!h.sms.configured ? undefined : h.sms.lastErrorAt ? 'wait' : 'ok'}>
                {h.sms.configured ? 'подключены' : 'не подключены'} · последняя отправлена {when(h.sms.lastSentAt)}
                {h.sms.lastErrorAt && ` · ошибка ${when(h.sms.lastErrorAt)}: ${h.sms.lastError}`}
              </Row>
            )}
            {h.ai && (
              <Row name="ИИ" tone={!h.ai.configured ? undefined : h.ai.errors24h > 0 ? 'wait' : 'ok'}>
                {h.ai.configured ? 'ключ есть' : 'ключа нет — ИИ выключен'} · удачный вызов {when(h.ai.lastOkAt)} · ошибок за сутки {h.ai.errors24h}
                {h.ai.lastErrorAt && ` · последняя ${when(h.ai.lastErrorAt)}${h.ai.lastError ? ` (${h.ai.lastError})` : ''}`}
              </Row>
            )}
          </tbody>
        </table>
      </section>
      {h.errors && (
        <section className="card-block">
          <h2>Ошибки сервера за сутки: {h.errors.total24h}</h2>
          {(h.errors.top?.length ?? 0) > 0 ? (
            <table className="table" aria-label="Ошибки сервера за сутки">
              <thead><tr><th>Эндпоинт</th><th>Исключение</th><th>Раз</th><th>Последняя</th><th>Номер запроса</th></tr></thead>
              <tbody>
                {h.errors.top!.map((e) => (
                  <tr key={`${e.method} ${e.path} ${e.exception}`}>
                    <td className="nowrap">{e.method} {e.path}</td>
                    <td>{e.exception ?? '—'}</td>
                    <td className="num">{e.count}</td>
                    <td className="hint nowrap">{when(e.lastAt)}</td>
                    <td><code>{e.lastRequestId ?? '—'}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="hint">Ошибок 5xx не было.</p>}
        </section>
      )}
      {(h.jobs?.length ?? 0) > 0 && <Jobs jobs={h.jobs!} />}
    </>
  )
}

/**
 * Файлы пациентов и клиник (снимки, сканы): где хранятся новые — R2 или база, сколько старых уже перенесено в R2,
 * сколько в корзине (удалённые, 30 дней) и последняя ошибка R2 с запуска.
 */
function FilesRow({ files: f }: { files: Files }) {
  const tone = f.lastErrorAt ? 'wait' : f.storage === 'R2' && f.moved >= f.total ? 'ok' : undefined
  return (
    <Row name="Файлы" tone={tone}>
      {f.storage ?? '—'} · перенесено {f.moved} из {f.total} · в корзине {f.trash}
      {f.lastErrorAt && ` · ошибка ${when(f.lastErrorAt)}${f.lastError ? `: ${f.lastError}` : ''}`}
    </Row>
  )
}

function Jobs({ jobs }: { jobs: Job[] }) {
  return (
    <section className="card-block">
      <h2>Задачи по расписанию</h2>
      <p className="hint small">С последнего запуска приложения.</p>
      <table className="table" aria-label="Задачи по расписанию">
        <thead><tr><th>Задача</th><th>Последний запуск</th><th>Следующий</th></tr></thead>
        <tbody>
          {jobs.map((j) => {
            const [label, chip] = JOB_STATUS[j.status ?? 'NONE'] ?? ['', 's-quiet']
            return (
              <tr key={`${j.code}-${j.schedule}`}>
                <td>{j.name}<span className="hint small"> · {j.schedule}</span></td>
                <td className="nowrap"><span className={`chip small ${chip}`}>{label}</span>
                  {j.status !== 'NONE' && <span className="hint"> {when(j.lastRunAt)}</span>}
                  {j.error && <span className="tone-bad"> {j.error}</span>}</td>
                <td className="hint nowrap">{when(j.nextRunAt)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </section>
  )
}

/** Номер запроса из оповещения «⚠️ ошибок сервера» → строки лога этого запроса (не больше 200). */
function LogSearch() {
  const [input, setInput] = useState('')
  const [id, setId] = useState<string | null>(null)
  const result = useQuery<LogResult, ApiError>({
    queryKey: ['platform-health-logs', id],
    queryFn: () => unwrap(api.GET('/api/platform/health/logs', { params: { query: { requestId: id! } } })),
    enabled: id != null,
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    setId(input.trim())
  }
  const r = result.data
  return (
    <section className="card-block">
      <h2>Поиск по номеру запроса</h2>
      <form className="form narrow" aria-label="Поиск по номеру запроса" onSubmit={submit}>
        <p className="hint">Номер — в оповещении об ошибках в боте и в таблице ошибок выше.</p>
        <label className="field"><span>Номер запроса</span>
          <input value={input} required placeholder="например, 3f9a2c41b7d0" onChange={(e) => setInput(e.target.value)} /></label>
        <button type="submit" className="btn primary" disabled={!input.trim() || result.isFetching}>Найти строки лога</button>
      </form>
      {result.error && <p className="error" role="alert">{result.error.fieldErrors.requestId ?? result.error.message}</p>}
      {result.isFetching && <Loading />}
      {r && !result.isFetching && (!r.available ? <p className="hint">Файл логов не подключён (так на ноутбуке; на сервере — /app/logs/dental.log).</p>
        : (r.lines?.length ?? 0) === 0 ? <p className="hint">Строк с номером {r.requestId} нет (искали в: {r.files?.join(', ')}).</p> : (
          <>
            <p className="hint small">Строк: {r.lines!.length}{r.truncated ? ' (показаны первые)' : ''} · файл: {r.files?.at(-1)}</p>
            <table className="table" aria-label="Строки лога">
              <tbody>
                {r.lines!.map((l, i) => (
                  <tr key={i}>
                    <td className="hint nowrap">{l.time ? shortDate(l.time, true) : ''}</td>
                    <td className={l.level === 'ERROR' ? 'tone-bad' : l.level === 'WARN' ? 'tone-wait' : 'hint'}>{l.level}</td>
                    <td>
                      {l.message}
                      {l.logger && <span className="hint small"> · {l.logger.split('.').at(-1)}</span>}
                      {l.error && <div className="tone-bad">{l.error}</div>}
                      {l.stack && <details><summary>Стек</summary><pre className="small">{l.stack}</pre></details>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ))}
    </section>
  )
}
