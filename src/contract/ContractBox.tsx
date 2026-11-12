import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

import { api, ApiError, fetchBlob, unwrap, upload, type Schemas } from '../api/client'
import { DateInput } from '../layout/DateInput'
import { ask } from '../lib/confirm'
import { todayIn } from '../lib/time'
import { resizePhoto } from '../medical/thumb'
import { canPrint } from '../print/paper'
import { PrintSheet } from '../print/PrintSheet'
import { SignaturePad } from './SignaturePad'
import './contract.css'

type Me = Schemas['BookingViewsMe']
type Patient = Schemas['PatientView']
type Contract = Schemas['PatientContractsView']

/** 'YYYY-MM-DD' → «08.11.2026». */
const day = (iso: string) => iso.split('-').reverse().join('.')

function errorText(e: ApiError | null | undefined): string | null {
  return e ? Object.values(e.fieldErrors)[0] ?? e.message : null
}

/**
 * «Договор» во вкладке «Прочее» карточки пациента: договор на стоматологические услуги и
 * информированное согласие (V181 бэкенда). Статус — «Договор подписан 08.11.2026» или «не подписан».
 * «🖨 Распечатать» — лист A4 с подставленными данными и линиями подписи; «✍️ Подписать на экране» —
 * подпись пальцем на планшете; «Отметить подписанным» — подписали на бумаге; к подписанному —
 * скан или фото листа. Текст собирает сервер (у подписанного — снимок на день подписания); отмечают
 * админ, регистратура и врач, ассистент только смотрит (canSign).
 * Свёрнут в одну строку-раскрывашку (как layout/Fold): «📄 Договор: не подписан ›» или «📄 Договор
 * подписан 08.11.2026 ✓» — раскрытый занимал пол-экрана телефона. Врача не выбирают: врач ближайшего
 * или последнего приёма (defaultDoctorId), иначе сам сотрудник, если он врач; нет и его — без врача,
 * сервер напечатает линию, чтобы вписать от руки.
 */
export function ContractBox({ patient, me, defaultDoctorId }: { patient: Patient; me: Me; defaultDoctorId?: number }) {
  const client = useQueryClient()
  const doctorId = defaultDoctorId ?? me.doctorId ?? undefined
  const [open, setOpen] = useState(false)
  const [printing, setPrinting] = useState(false)
  const [signing, setSigning] = useState(false)
  const [marking, setMarking] = useState(false)
  const [signedOn, setSignedOn] = useState(todayIn())
  const [scanStatus, setScanStatus] = useState('')
  const scanInput = useRef<HTMLInputElement>(null)
  const id = patient.id
  const contract = useQuery({
    queryKey: ['contract', id, doctorId ?? null],
    queryFn: () => unwrap(api.GET('/api/patients/{patientId}/contract', { params: { path: { patientId: id }, query: { doctorId } } })),
  })
  const refresh = () => client.invalidateQueries({ queryKey: ['contract', id] })
  const sign = useMutation<Contract, ApiError, { png?: Blob; on?: string }>({
    mutationFn: ({ png, on }) => {
      const form = new FormData()
      if (doctorId != null) form.append('doctorId', String(doctorId))
      if (on) form.append('signedOn', on)
      if (png) form.append('signature', png, 'signature.png')
      return upload<Contract>(`/api/patients/${id}/contract/sign`, form)
    },
    onSuccess: () => {
      setSigning(false)
      setMarking(false)
      void refresh()
    },
  })
  const unsign = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.DELETE('/api/patients/{patientId}/contract', { params: { path: { patientId: id } } })),
    onSuccess: () => void refresh(),
  })

  const sendScan = async (file: File) => {
    setScanStatus('Загружаем…')
    try {
      const form = new FormData()
      // Фото листа уменьшаем, как снимки (до 2000 px); PDF — как есть
      if (file.type === 'application/pdf') form.append('file', file, 'scan.pdf')
      else form.append('file', await resizePhoto(file, 2000, 0.85), 'scan.jpg')
      await upload<Contract>(`/api/patients/${id}/contract/scan`, form)
      setScanStatus('Скан сохранён')
      void refresh()
    }
    catch (e) {
      setScanStatus(e instanceof ApiError ? errorText(e) ?? e.message : 'Файл не открылся — нужно фото или PDF')
    }
    if (scanInput.current) scanInput.current.value = ''
  }

  const openFile = async (kind: 'scan' | 'signature') => {
    const blob = await fetchBlob(`/api/patients/${id}/contract/${kind}`)
    window.open(URL.createObjectURL(blob), '_blank', 'noopener')
  }

  const c = contract.data
  const head = contract.isPending ? <>📄 Договор: <span className="contract-meta">загружаем…</span></>
    : contract.error ? <>📄 Договор: <span className="contract-meta">не загрузился</span></>
      : c!.signed ? <span className="tone-ok">📄 Договор подписан <span className="num">{day(c!.signedOn!)}</span> ✓</span>
        : <>📄 Договор: <b className="tone-wait">не подписан</b></>
  return (
    <section className={open ? 'contract-box fold open' : 'contract-box fold'} aria-label="Договор">
      <button type="button" className="fold-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="contract-head">{head}</span>
        <span className="fold-chev" aria-hidden="true">›</span>
      </button>
      {open && contract.error && <div className="fold-body"><p className="error">{contract.error.message}</p></div>}
      {open && c && <div className="fold-body">{body(c)}</div>}
    </section>
  )

  function body(c: Contract) {
    const by = c.signedBy ? `отметил(а) ${c.signedBy}` : ''
    return (
      <>
        {c.signed && by && <p className="hint">{by}</p>}
        {c.signed && (c.hasSignature || c.hasScan) && (
          <p className="hint">
            {c.hasSignature && <button type="button" className="link" onClick={() => void openFile('signature')}>подпись на экране</button>}
            {c.hasSignature && c.hasScan && ' · '}
            {c.hasScan && <button type="button" className="link" onClick={() => void openFile('scan')}>скан подписанного листа</button>}
          </p>
        )}
        {marking ? (
          <form className="form" aria-label="Отметить договор подписанным" onSubmit={(e) => { e.preventDefault(); sign.mutate({ on: signedOn }) }}>
            <label className="field"><span>Дата подписания</span>
              <DateInput aria-label="Дата подписания" value={signedOn} max={todayIn()} onChange={(e) => setSignedOn(e.target.value)} /></label>
            <div className="actions">
              <button type="submit" className="btn primary" disabled={sign.isPending}>Подписан</button>
              <button type="button" className="btn ghost" onClick={() => setMarking(false)}>Отмена</button>
            </div>
          </form>
        ) : (
          <div className="actions">
            {canPrint() && <button type="button" className="btn" onClick={() => setPrinting(true)}>🖨 Распечатать</button>}
            {!c.signed && c.canSign && <button type="button" className="btn" onClick={() => { sign.reset(); setSigning(true) }}>✍️ Подписать на экране</button>}
            {!c.signed && c.canSign && <button type="button" className="btn" onClick={() => { sign.reset(); setMarking(true) }}>Отметить подписанным</button>}
            {c.signed && c.canSign && (
              <>
                <button type="button" className="btn" onClick={() => scanInput.current?.click()}>{c.hasScan ? 'Заменить скан' : '📎 Загрузить скан'}</button>
                <button type="button" className="btn quiet" disabled={unsign.isPending}
                  onClick={() => void ask('Снять отметку «подписан»? Подпись и скан удалятся — договор нужно будет подписать заново.')
                    .then((ok) => ok && unsign.mutate())}>Снять отметку</button>
              </>
            )}
          </div>
        )}
        <input ref={scanInput} type="file" accept="image/*,application/pdf" hidden aria-label="Скан договора"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void sendScan(f) }} />
        {scanStatus && <p className="hint" role="status">{scanStatus}</p>}
        {!signing && errorText(sign.error) && <p className="error" role="alert">{errorText(sign.error)}</p>}
        {unsign.error && <p className="error" role="alert">{errorText(unsign.error)}</p>}
        {!canPrint() && <p className="hint small">Печать — с компьютера.</p>}
        {signing && (
          <SignaturePad title={`Подпись пациента: ${c.title ?? 'договор'}`} saving={sign.isPending} error={errorText(sign.error)}
            onDone={(png) => sign.mutate({ png })} onCancel={() => setSigning(false)} />
        )}
        {printing && <ContractPrint contract={c} patientId={id} onClose={() => setPrinting(false)} />}
      </>
    )
  }
}

/** Лист A4: заголовок, текст с подстановками, подписи сторон; подпись пальцем — картинкой над линией. */
function ContractPrint({ contract: c, patientId, onClose }: { contract: Contract; patientId: number; onClose: () => void }) {
  const [signature, setSignature] = useState<string | null>(null)
  useEffect(() => {
    if (!c.hasSignature) return
    let url: string | null = null
    let alive = true
    void fetchBlob(`/api/patients/${patientId}/contract/signature`).then((blob) => {
      if (!alive) return
      url = URL.createObjectURL(blob)
      setSignature(url)
    }).catch(() => undefined)
    return () => {
      alive = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [c.hasSignature, patientId])
  return (
    <PrintSheet title="Договор с пациентом" onClose={onClose}>
      {() => (
        <>
          <h1>{c.title}</h1>
          <div className="contract-body">{c.text}</div>
          <div className="contract-signs">
            <div>
              <b>Клиника</b>
              <span className="line" />
              <span className="note">подпись, М. П.</span>
            </div>
            <div>
              <b>Пациент (законный представитель)</b>
              <span className="line">{signature && <img src={signature} alt="Подпись пациента" />}</span>
              <span className="note">{c.signed ? `подписано ${day(c.signedOn!)}` : 'подпись, расшифровка'}</span>
            </div>
          </div>
        </>
      )}
    </PrintSheet>
  )
}
