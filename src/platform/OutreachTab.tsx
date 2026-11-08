import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'

import { api, ApiError, unwrap, upload, type Schemas } from '../api/client'
import { Select } from '../layout/Select'
import { Loading } from '../layout/Loading'
import { CITIES } from '../lib/clinicSearch'
import { openLink } from '../lib/telegram'
import { whatsappUrl } from '../lib/texts'
import { formatPhone, shortDate } from '../lib/time'
import { GROUPS, groupOf, messageFor, nextLead, PLACEHOLDER, shareVideo, type Group, type OutreachLead } from './outreach'

type Template = Schemas['ClinicOutreachTemplate']
type Report = Schemas['ClinicOutreachImportReport']

const STAGE_TEXT: Record<string, string> = { DEMO: 'Демо показали', TRIAL: 'Пробный период', PAYING: 'Платит' }

/**
 * «Написать клиникам» (владелец платформы): список стоматологий из 2ГИС и карт — загрузить, написать
 * каждой в WhatsApp своим нажатием (текст с названием клиники и ссылкой на страницу для клиник) и
 * отметить «отправили». Массовой отправки нет нарочно: WhatsApp блокирует номер за рассылки, а первое
 * сообщение должно быть личным. Клиники — те же лиды, что в «Воронке продаж» (Клиники).
 */
export function OutreachTab() {
  const outreach = useQuery({ queryKey: ['platform-outreach'], queryFn: () => unwrap(api.GET('/api/platform/outreach')) })
  const [group, setGroup] = useState<Group | null>(null)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<number | null>(null)
  const [uploading, setUploading] = useState(false)
  const [allDone, setAllDone] = useState(false)
  const data = outreach.data
  const leads = data?.leads ?? []
  const q = query.trim().toLowerCase().replace(/ё/g, 'е')
  const shown = leads.filter((l) => (group == null || groupOf(l) === group)
    && (!q || (l.clinicName ?? '').toLowerCase().replace(/ё/g, 'е').includes(q)))
  const counts = data?.counts ?? {}
  const countOf: Record<Group, number> = { FRESH: counts.fresh ?? 0, SENT: counts.sent ?? 0, FURTHER: counts.further ?? 0, DECLINED: counts.declined ?? 0 }

  const next = () => {
    const lead = nextLead(leads, selected)
    setAllDone(lead == null)
    if (!lead) return
    // Следующая может быть не видна под фильтром или поиском — показываем всех неписаных
    if (!shown.some((l) => l.id === lead.id)) {
      setGroup('FRESH')
      setQuery('')
    }
    setSelected(lead.id!)
    setTimeout(() => document.getElementById(`outreach-${lead.id}`)?.scrollIntoView?.({ block: 'center', behavior: 'smooth' }), 0)
  }

  return (
    <>
      <section className="card-block" aria-label="Написать клиникам">
        <h2>Написать клиникам</h2>
        <p className="hint">Пишите по одной — своим нажатием: WhatsApp блокирует номер за массовые рассылки, а личное сообщение
          читают охотнее. После отправки отметьте «Да» — клиника перейдёт в «Написали» (и в воронке — «Связались»).</p>
        <p className="hint">Порядок: <b>«Написать в WhatsApp»</b> — текст, затем <b>«🎬 Отправить ролик»</b> — видео отдельным файлом.
          У незнакомого номера WhatsApp не делает ссылки кликабельными, поэтому ролик — вложением, а сайт — просто адресом в тексте.</p>
        {outreach.error && <p className="error">{outreach.error.message}</p>}
        {outreach.isPending ? <Loading /> : data && (
          <>
            <div className="segments tabs" role="group" aria-label="Кому писали">
              <button type="button" aria-pressed={group == null} onClick={() => setGroup(null)}>Все · <b className="num">{leads.length}</b></button>
              {GROUPS.map(([key, title]) => (
                <button key={key} type="button" aria-pressed={group === key} onClick={() => setGroup(key)}>
                  {title} · <b className="num">{countOf[key]}</b></button>
              ))}
            </div>
            <div className="actions">
              <input type="search" className="outreach-search" aria-label="Поиск по названию" placeholder="Поиск по названию" value={query}
                onChange={(e) => setQuery(e.target.value)} />
              <button type="button" className="btn primary" onClick={next}>Следующая клиника →</button>
              {!uploading && <button type="button" className="btn" onClick={() => setUploading(true)}>Загрузить список клиник</button>}
            </div>
            {allDone && <p className="tone-ok" role="status">Неписаных клиник нет — всем из списка уже написали.</p>}
            {uploading && <ListUpload onClose={() => setUploading(false)} />}
            {leads.length === 0 ? <p className="hint">Список пуст. Нажмите «Загрузить список клиник» и вставьте клиники из 2ГИС или таблицы.</p>
              : shown.length === 0 ? <p className="hint">Здесь никого.</p>
                : (
                  <div role="list" className="funnel-list" aria-label="Клиники">
                    {shown.map((l) => (
                      <LeadRow key={l.id} lead={l} template={data.template?.text ?? ''} selected={l.id === selected}
                        onSelect={() => setSelected(l.id === selected ? null : l.id!)} />
                    ))}
                  </div>
                )}
          </>
        )}
      </section>
      {data?.template && <TemplateEditor template={data.template} />}
    </>
  )
}

function LeadRow({ lead: l, template, selected, onSelect }: { lead: OutreachLead; template: string; selected: boolean; onSelect: () => void }) {
  const client = useQueryClient()
  const [asking, setAsking] = useState(false)
  const [copied, setCopied] = useState(false)
  const [declining, setDeclining] = useState(false)
  const [reason, setReason] = useState('')
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['platform-outreach'] })
    void client.invalidateQueries({ queryKey: ['platform-funnel'] })
  }
  const sent = useMutation<OutreachLead, ApiError>({
    mutationFn: () => unwrap(api.POST('/api/platform/outreach/{id}/sent', { params: { path: { id: l.id! } } })),
    onSuccess: () => {
      setAsking(false)
      refresh()
    },
  })
  const decline = useMutation<OutreachLead, ApiError>({
    mutationFn: () => unwrap(api.POST('/api/platform/outreach/{id}/decline', { params: { path: { id: l.id! } }, body: { reason: reason || undefined } })),
    onSuccess: () => {
      setDeclining(false)
      refresh()
    },
  })
  const text = messageFor(template, l.clinicName ?? '')
  const lost = l.stage === 'LOST'
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch {
      setCopied(false)
    }
    setAsking(true)
  }
  const g = groupOf(l)
  const status = g === 'FRESH' ? <span className="chip small s-quiet">Не писали</span>
    : g === 'SENT' ? <span className="chip small s-ok">Написали{l.contactedAt ? ` ${shortDate(l.contactedAt)}` : ''}</span>
      : g === 'DECLINED' ? <span className="chip small s-bad">Отказ</span>
        : <span className="chip small s-request">{STAGE_TEXT[l.stage ?? ''] ?? 'Дальше'}</span>
  // Ролик — отдельным файлом (ссылки у незнакомого номера не кликабельны)
  const video = useMutation<Awaited<ReturnType<typeof shareVideo>>, Error>({ mutationFn: shareVideo })
  const error = sent.error ?? decline.error
  return (
    <div role="listitem" id={`outreach-${l.id}`} className={`sub-form form outreach-lead${selected ? ' active' : ''}`} aria-label={`Клиника: ${l.clinicName}`}
      aria-current={selected || undefined}>
      <strong><button type="button" className="row-link" aria-expanded={selected} onClick={onSelect}>{l.clinicName}</button> {status}
        {l.source === 'SITE' && <span className="hint small"> · заявка с сайта</span>}</strong>
      <span className="hint">{[l.city, l.address].filter(Boolean).join(' · ')}
        {l.phone && <>{l.city || l.address ? ' · ' : ''}{formatPhone(l.phone)}</>}
        {l.link && <> · <a href={l.link} target="_blank" rel="noopener noreferrer">ссылка</a></>}
        {g !== 'SENT' && l.contactedAt && <> · написали {shortDate(l.contactedAt)}</>}</span>
      {lost && <span className="tone-bad">Просили не беспокоить{l.lostReason ? `: ${l.lostReason}` : ''} — не пишем.</span>}
      {selected && !lost && <p className="outreach-text" aria-label="Текст сообщения">{text}</p>}
      {!lost && (
        <div className="actions">
          {l.phone && (
            <button type="button" className={g === 'FRESH' ? 'btn primary' : 'btn'}
              onClick={() => { openLink(whatsappUrl(l.phone!, text)); setAsking(true) }}>Написать в WhatsApp</button>
          )}
          {!l.phone && l.link && <button type="button" className="btn" onClick={() => { openLink(l.link!); setAsking(true) }}>Открыть ссылку</button>}
          <button type="button" className="btn" disabled={video.isPending} onClick={() => video.mutate()}>
            {video.isPending ? 'Готовлю ролик…' : '🎬 Отправить ролик'}</button>
          <button type="button" className="btn" onClick={() => void copy()}>Скопировать текст</button>
          {!declining && <button type="button" className="btn ghost" onClick={() => setDeclining(true)}>Не беспокоить</button>}
        </div>
      )}
      {copied && !asking && <span className="tone-ok" role="status">Текст скопирован</span>}
      {video.data && video.data !== 'cancelled' && (
        <span className="tone-ok" role="status">{VIDEO_DONE[video.data]}</span>
      )}
      {video.error && <p className="error" role="alert">Ролик не открылся: {video.error.message}</p>}
      {asking && (
        <div className="outreach-ask" role="group" aria-label="Отправили?">
          <span>{copied ? 'Текст скопирован. ' : ''}Отправили сообщение «{l.clinicName}»?</span>
          <span className="actions">
            <button type="button" className="btn primary small" disabled={sent.isPending} onClick={() => sent.mutate()}>Да</button>
            <button type="button" className="btn small" onClick={() => setAsking(false)}>Нет</button>
          </span>
        </div>
      )}
      {declining && (
        <form className="form" aria-label={`Не беспокоить: ${l.clinicName}`} onSubmit={(e) => { e.preventDefault(); decline.mutate() }}>
          <label className="field"><span>Почему — для себя</span>
            <input value={reason} maxLength={200} placeholder="Не интересно / уже есть программа" onChange={(e) => setReason(e.target.value)} /></label>
          <div className="actions">
            <button type="submit" className="btn" disabled={decline.isPending}>Больше не писать</button>
            <button type="button" className="btn ghost" onClick={() => setDeclining(false)}>Отмена</button>
          </div>
        </form>
      )}
      {error && <p className="error" role="alert">{error.message}</p>}
    </div>
  )
}

const VIDEO_DONE: Record<'shared' | 'downloaded' | 'opened', string> = {
  shared: 'Ролик отправлен через «Поделиться».',
  downloaded: 'Ролик скачан — прикрепите его в чат клиники в WhatsApp.',
  opened: 'Ролик открыт в браузере — нажмите «Поделиться» → WhatsApp → чат клиники.',
}

/** «Загрузить список клиник»: вставить текст или выбрать файл → предпросмотр → добавить новые. */
function ListUpload({ onClose }: { onClose: () => void }) {
  const client = useQueryClient()
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [city, setCity] = useState('Бишкек')
  const input = useRef<HTMLInputElement>(null)
  const form = () => {
    const body = new FormData()
    if (file) body.append('file', file)
    else body.append('text', text)
    body.append('city', city)
    return body
  }
  const preview = useMutation<Report, ApiError>({ mutationFn: () => upload<Report>('/api/platform/outreach/import/preview', form()) })
  const apply = useMutation<Report, ApiError>({
    mutationFn: () => upload<Report>('/api/platform/outreach/import', form()),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['platform-outreach'] })
      void client.invalidateQueries({ queryKey: ['platform-funnel'] })
    },
  })
  const changed = () => {
    preview.reset()
    apply.reset()
  }
  const r = preview.data
  const done = apply.data
  const error = preview.error ?? apply.error
  return (
    <div className="sub-form form" role="group" aria-label="Загрузить список клиник">
      <strong>Загрузить список клиник</strong>
      <p className="hint">Строка — одна клиника: <b>Название; телефон; адрес; ссылка</b> (2ГИС, карты или Instagram). Можно скопировать
        колонки из Excel или Google-таблицы — разделитель «;» или табуляция. Обязательно название и телефон или ссылка.
        Кто уже есть в воронке (тот же телефон или название, в том числе заявки с сайта) — пропустим.</p>
      <label className="field"><span>Список</span>
        <textarea value={text} rows={6} disabled={Boolean(file)} placeholder={'Стоматология «Пример»; 0555 000 000; ул. Примерная, 1; https://2gis.kg/…'}
          onChange={(e) => { setText(e.target.value); changed() }} /></label>
      <label className="field"><span>Или файл .xlsx / .csv</span>
        <input ref={input} type="file" accept=".xlsx,.csv,.txt" onChange={(e) => { setFile(e.target.files?.[0] ?? null); changed() }} /></label>
      {file && <button type="button" className="btn ghost small" onClick={() => { setFile(null); if (input.current) input.current.value = ''; changed() }}>Убрать файл</button>}
      <label className="field"><span>Город, если не указан в строке</span>
        <Select value={city} onChange={(e) => { setCity(e.target.value); changed() }}>
          {CITIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </Select></label>
      {error && <p className="error" role="alert">{Object.values(error.fieldErrors)[0] ?? error.message}</p>}
      {done ? (
        <p className="tone-ok" role="status">Добавлено клиник: {done.added}. Они — в «Не писали», по порядку списка.</p>
      ) : r ? (
        <>
          <p className="stats" aria-label="Итог проверки">
            <span className="chip small s-ok">Новых: <b className="num">{r.fresh}</b></span>
            <span className="chip small s-quiet">Уже есть: <b className="num">{r.duplicates}</b></span>
            <span className={`chip small ${r.errors ? 's-bad' : 's-quiet'}`}>Ошибок: <b className="num">{r.errors}</b></span>
          </p>
          <table className="table" aria-label="Проверка списка">
            <thead><tr><th className="r">Строка</th><th>Клиника</th><th>Телефон</th><th>Итог</th></tr></thead>
            <tbody>
              {(r.rows ?? []).map((row) => (
                <tr key={row.line}>
                  <td className="r num">{row.line}</td>
                  <td>{row.clinicName || '—'}{row.address && <span className="hint"> · {row.address}</span>}</td>
                  <td className="nowrap">{row.phone ? formatPhone(row.phone) : row.link ? 'ссылка' : '—'}</td>
                  <td className={row.status === 'NEW' ? 'tone-ok' : row.status === 'ERROR' ? 'tone-bad' : 'hint'}>
                    {row.status === 'NEW' ? 'Добавим' : row.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
      <div className="actions">
        {!done && (r && (r.fresh ?? 0) > 0
          ? <button type="button" className="btn primary" disabled={apply.isPending} onClick={() => apply.mutate()}>Добавить клиник: {r.fresh}</button>
          : <button type="button" className="btn primary" disabled={preview.isPending || (!file && !text.trim())} onClick={() => preview.mutate()}>Проверить</button>)}
        <button type="button" className="btn ghost" onClick={onClose}>{done ? 'Закрыть' : 'Отмена'}</button>
      </div>
    </div>
  )
}

/** Текст первого сообщения: {клиника} подставится названием; пусто или «Вернуть» — текст по умолчанию. */
function TemplateEditor({ template }: { template: Template }) {
  const client = useQueryClient()
  const [text, setText] = useState(template.text ?? '')
  const save = useMutation<Template, ApiError, string>({
    mutationFn: (value) => unwrap(api.PUT('/api/platform/outreach/template', { body: { text: value } })),
    onSuccess: (t) => {
      setText(t.text ?? '')
      void client.invalidateQueries({ queryKey: ['platform-outreach'] })
    },
  })
  return (
    <section className="card-block" aria-label="Текст сообщения">
      <details>
        <summary>Текст сообщения{template.custom ? ' (свой)' : ''}</summary>
        <form className="form" onSubmit={(e) => { e.preventDefault(); save.mutate(text) }}>
          <p className="hint">{PLACEHOLDER} — подставится название клиники. Ссылка ведёт на страницу для клиник: там ролик на минуту,
            презентация и заявка.</p>
          <label className="field"><span>Текст</span>
            <textarea value={text} rows={8} maxLength={1500} onChange={(e) => setText(e.target.value)} /></label>
          {!text.includes(PLACEHOLDER) && <p className="tone-wait">В тексте нет {PLACEHOLDER} — название клиники не подставится.</p>}
          {save.error && <p className="error" role="alert">{save.error.fieldErrors.text ?? save.error.message}</p>}
          {save.isSuccess && <p className="tone-ok" role="status">Сохранено</p>}
          <div className="actions">
            <button type="submit" className="btn primary" disabled={save.isPending}>Сохранить текст</button>
            {template.custom && <button type="button" className="btn ghost" disabled={save.isPending} onClick={() => save.mutate('')}>Вернуть текст по умолчанию</button>}
          </div>
        </form>
      </details>
    </section>
  )
}
