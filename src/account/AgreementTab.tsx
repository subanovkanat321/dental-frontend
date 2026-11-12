import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ask } from '../lib/confirm'
import { useState, type FormEvent, type ReactNode } from 'react'

import { api, ApiError, unwrap, upload, type Schemas } from '../api/client'
import { download } from '../lib/download'
import { shortDate, todayIn } from '../lib/time'
import { agreementBlocks, agreementValues, fillAgreement, type AgreementForm } from './texts'
import { Loading, Spinner } from '../layout/Loading'
import { EmptyState } from '../layout/EmptyState'

type Agreement = Schemas['AgreementsClinicAgreement']
type Acceptance = Schemas['AgreementsAcceptance']

function acceptanceLine(a: Acceptance): string {
  return `${a.acceptedAt ? shortDate(a.acceptedAt) : ''} · версия ${a.version} — ${a.signerName} · «${a.clinicLegalName}»${a.clinicInn ? `, ИНН ${a.clinicInn}` : ''}`
}

/** Текст договора блоками — только текстом, без HTML. */
function AgreementText({ body }: { body: string }) {
  return (
    <div className="agreement-text">
      {agreementBlocks(body).map((b, i) => b.type === 'heading' ? <h3 key={i}>{b.text}</h3>
        : b.type === 'note' ? <p key={i} className="hint">{b.text}</p>
          : b.type === 'item' ? <p key={i} className="agreement-item">• {b.text}</p> : <p key={i}>{b.text}</p>)}
    </div>
  )
}

/**
 * «Договор» (админ): прочитать действующую версию и подписать от имени клиники (реквизиты +
 * «вправе подписать» — простая электронная подпись по входу через Telegram) или загрузить скан.
 */
export function AgreementTab() {
  const a = useQuery({ queryKey: ['clinic-agreement'], queryFn: () => unwrap(api.GET('/api/clinic/agreement')) })
  if (a.isPending) return <Loading />
  if (a.error) return <p className="error">{a.error.message}</p>
  return <AgreementView a={a.data} />
}

function AgreementView({ a }: { a: Agreement }) {
  const c = a.current
  const [sent, setSent] = useState('')
  const sendPdf = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.POST('/api/clinic/agreement/pdf/send')),
    onSuccess: () => setSent('PDF отправлен в чат с ботом'),
  })
  return (
    <>
      <section className={`card-block pay-status tone-${!c ? 'hint' : a.accepted ? 'ok' : 'wait'}`}>
        {!c ? (
          <><h2>Договор ещё не опубликован</h2><p className="hint">Платформа пришлёт его, когда он будет готов. Скан можно загрузить уже сейчас.</p></>
        ) : a.accepted ? (
          <><h2>Договор подписан</h2><p className="hint">{acceptanceLine(a.accepted)}</p></>
        ) : (
          <><h2>{a.last ? `Договор обновился — версия ${c.version}` : 'Договор не подписан'}</h2>
            <p className="hint">Прочитайте, впишите реквизиты и подпишите ниже — или подпишите на бумаге и загрузите скан.</p></>
        )}
      </section>
      {c && (a.accepted ? (
        <section className="card-block">
          <h2>{c.title}</h2>
          <details className="agreement-box">
            <summary>Текст договора · версия {c.version}</summary>
            <AgreementText body={a.accepted.filledText || fillAgreement(c.body ?? '', {})} />
            <p className="hint">Отпечаток текста: {(a.accepted.filledSha256 || c.sha256 || '').slice(0, 16)}…</p>
          </details>
          <PdfActions onSend={() => sendPdf.mutate()} pending={sendPdf.isPending} label="Подписанный договор — PDF в бот" />
          {sent && <p className="tone-ok" role="status">{sent}</p>}
          {sendPdf.error && <p className="error">{sendPdf.error.message}</p>}
        </section>
      ) : (
        <SignForm a={a} pdf={<PdfActions onSend={() => sendPdf.mutate()} pending={sendPdf.isPending} label="PDF для подписи на бумаге — в бот" />}
          sent={sent || sendPdf.error?.message || ''} />
      ))}
      <Scans scans={a.scans ?? []} />
    </>
  )
}

function PdfActions({ onSend, pending, label }: { onSend: () => void; pending: boolean; label: string }) {
  return (
    <div className="actions">
      <button type="button" className="btn" disabled={pending} onClick={onSend}>{label}</button>
      <button type="button" className="btn" onClick={() => void download('/api/clinic/agreement/pdf', 'dogovor.pdf')}>Скачать PDF</button>
    </div>
  )
}

const FIELDS: [keyof AgreementForm, string, string, number][] = [
  ['clinicName', 'Клиника — ИП или организация, как в документах', 'ИП Садыкова Айгерим Маратовна', 150],
  ['clinicInn', 'ИНН (14 цифр)', '20101199000123', 20],
  ['clinicAddress', 'Юридический адрес', 'г. Бишкек, ул. Киевская, 100', 300],
  ['signerName', 'ФИО подписанта', 'Садыкова Айгерим Маратовна', 150],
  ['signerPosition', 'Должность', 'индивидуального предпринимателя', 100],
  ['signerBasis', 'Действует на основании', 'свидетельства о государственной регистрации', 150],
]
const CHIPS: Partial<Record<keyof AgreementForm, string[]>> = {
  signerPosition: ['индивидуального предпринимателя', 'директора', 'главного врача'],
  signerBasis: ['свидетельства о государственной регистрации', 'Устава', 'доверенности'],
}

/** Реквизиты подставляются в текст по мере ввода — подписывают ровно то, что видят. */
function SignForm({ a, pdf, sent }: { a: Agreement; pdf: ReactNode; sent: string }) {
  const client = useQueryClient()
  const c = a.current!
  const [f, setF] = useState<AgreementForm>({
    clinicName: a.legalName ?? '', clinicInn: '', clinicAddress: a.address ?? '', signerName: '', signerPosition: '', signerBasis: '',
  })
  const [confirm, setConfirm] = useState(false)
  const date = todayIn().split('-').reverse().join('.')
  const accept = useMutation<Agreement, ApiError>({
    mutationFn: () => unwrap(api.POST('/api/clinic/agreement/accept', { body: { sha256: c.sha256, confirm, ...f } })),
    onSuccess: (saved) => client.setQueryData(['clinic-agreement'], saved),
  })
  const err = (k: string) => accept.error?.fieldErrors[k]
  const submit = (e: FormEvent) => {
    e.preventDefault()
    accept.mutate()
  }
  const shown = Object.keys(accept.error?.fieldErrors ?? {}).some((k) => k === 'confirm' || k in f)

  return (
    <section className="card-block agreement">
      <h2>{c.title}</h2>
      <div className="agreement-grid">
        <div className="agreement-box">
          <p className="hint">Текст договора · версия {c.version}</p>
          <AgreementText body={fillAgreement(c.body ?? '', agreementValues(a.platform as Record<string, unknown> | undefined, f, date))} />
          <p className="hint">Отпечаток текста: {(c.sha256 ?? '').slice(0, 16)}…</p>
          {pdf}
          {sent && <p className="tone-ok" role="status">{sent}</p>}
        </div>
        <form className="form" aria-label="Подписать договор" onSubmit={submit}>
          <h3>Реквизиты клиники и подписанта</h3>
          <p className="hint">Они подставятся в договор — текст слева меняется по мере ввода.</p>
          {FIELDS.map(([key, label, placeholder, max]) => (
            <div key={key} className="field">
              <label className="field"><span>{label}</span>
                <input value={f[key]} maxLength={max} placeholder={placeholder} onChange={(e) => setF({ ...f, [key]: e.target.value })} /></label>
              {CHIPS[key] && (
                <div className="chips-pick">
                  {CHIPS[key].map((o) => <button key={o} type="button" className="chip" aria-pressed={f[key] === o} onClick={() => setF({ ...f, [key]: o })}>{o}</button>)}
                </div>
              )}
              {err(key) && <p className="error">{err(key)}</p>}
            </div>
          ))}
          <label className="check"><input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} /> Я вправе подписать договор от имени клиники, прочитал(а) его и принимаю</label>
          {err('confirm') && <p className="error">{err('confirm')}</p>}
          {accept.error && !shown && <p className="error" role="alert">{accept.error.message}</p>}
          <button type="submit" className="btn primary" disabled={accept.isPending}>Подписать договор</button>
          <p className="hint">Это простая электронная подпись: сохраним, кто и когда подписал и какой именно текст (его отпечаток), по вашему входу через Telegram.</p>
        </form>
      </div>
    </section>
  )
}

/** Подписанный скан (PDF, JPEG, PNG до 10 МБ): загрузить, прислать в бот, скачать, удалить. */
function Scans({ scans }: { scans: Schemas['AgreementsScan'][] }) {
  const client = useQueryClient()
  const refresh = () => client.invalidateQueries({ queryKey: ['clinic-agreement'] })
  const [done, setDone] = useState('')
  const add = useMutation<Schemas['AgreementsScan'], ApiError, File>({
    mutationFn: (file) => {
      const body = new FormData()
      body.append('file', file)
      return upload('/api/clinic/agreement/scans', body)
    },
    onSuccess: () => {
      setDone('Скан загружен')
      void refresh()
    },
  })
  const send = useMutation<unknown, ApiError, number>({
    mutationFn: (id) => unwrap(api.POST('/api/clinic/agreement/scans/{id}/send', { params: { path: { id } } })),
    onSuccess: () => setDone('Файл отправлен в чат с ботом'),
  })
  const remove = useMutation<unknown, ApiError, number>({
    mutationFn: (id) => unwrap(api.DELETE('/api/clinic/agreement/scans/{id}', { params: { path: { id } } })),
    onSuccess: () => void refresh(),
  })
  const error = add.error ?? send.error ?? remove.error
  return (
    <section className="card-block">
      <h2>Подписанный скан</h2>
      <p className="hint">Если клинике нужен договор на бумаге с печатью — подпишите, отсканируйте и загрузите (PDF, JPEG или PNG до 10 МБ).</p>
      {scans.length ? (
        <table className="table" aria-label="Сканы договора">
          <tbody>
            {scans.map((x) => (
              <tr key={x.id}>
                <td className="strong">{x.fileName}</td>
                <td className="hint nowrap">{Math.max(1, Math.round(x.sizeBytes / 1024))} КБ · {x.createdAt ? shortDate(x.createdAt) : ''}</td>
                <td className="r nowrap">
                  <button type="button" className="btn small" disabled={send.isPending} onClick={() => send.mutate(x.id)}>В бот</button>{' '}
                  <button type="button" className="btn small ghost" disabled={remove.isPending}
                    onClick={() => void ask(`Удалить скан «${x.fileName}»?`).then((ok) => ok && remove.mutate(x.id))}>Удалить</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <EmptyState compact title="Сканов пока нет" />}
      {error && <p className="error" role="alert">{error.fieldErrors.file ?? error.message}</p>}
      {done && <p className="tone-ok" role="status">{done}</p>}
      <label className="btn">{add.isPending ? <><Spinner />Загружаем…</> : 'Загрузить скан'}
        <input type="file" className="sr-only" accept="application/pdf,image/jpeg,image/png" aria-label="Скан договора"
          onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; setDone(''); if (file) add.mutate(file) }} /></label>
    </section>
  )
}
