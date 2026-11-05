import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ask } from '../lib/confirm'
import { useRef, useState } from 'react'

import { api, ApiError, fetchBlob, unwrap, upload, type Schemas } from '../api/client'
import { DateInput } from '../layout/DateInput'
import { EmptyState } from '../layout/EmptyState'
import { shortDate, todayIn } from '../lib/time'
import { PublicationBlock } from './BeforeAfter'
import { isComposite } from './composite'
import { resizePhoto } from './thumb'
import { Thumb } from './Thumb'

type FileView = Schemas['PatientFilesView']
type Kind = NonNullable<FileView['kind']>

const KINDS: [Kind, string][] = [['XRAY', '🩻 Рентген'], ['PHOTO', '📷 Фото зубов'], ['OTHER', '📄 Документ']]
/** Что именно загружать под каждым видом — чтобы не гадать, «снимок» это или «фото». */
const KIND_HINT: Record<Kind, string> = {
  XRAY: 'Прицельный снимок, панорама, КТ — для лечения.',
  PHOTO: 'Фото зубов и улыбки во рту — для медкарты. Из них же собирается «до / после» для Instagram.',
  OTHER: 'Анализы, заключения, направления, согласия — фото или скан.',
}
const kindName = (k?: Kind) => KINDS.find(([x]) => x === k)?.[1].replace(/^\S+ /, '')

/**
 * «Снимки и фото» пациента: список с миниатюрами, загрузка (сфотографировать или выбрать файлы) и
 * «до / после» для Instagram. В медкарте — целиком; в карточке приёма — свёрнуто под одной кнопкой.
 */
export function PatientFiles({ patientId, readOnly, compact = false, defaultKind = 'XRAY', takenOn: day }: {
  patientId: number
  readOnly: boolean
  /** В карточке приёма: свёрнуто под одной кнопкой, видны последние 4 — остальное в медкарте */
  compact?: boolean
  defaultKind?: Kind
  /** Дата снимка по умолчанию — день приёма; иначе сегодня */
  takenOn?: string
}) {
  const client = useQueryClient()
  const files = useQuery({
    queryKey: ['files', patientId],
    queryFn: () => unwrap(api.GET('/api/patients/{patientId}/files', { params: { path: { patientId } } })),
  })
  const [kind, setKind] = useState<Kind>(defaultKind)
  const [open, setOpen] = useState(!compact)
  const [caption, setCaption] = useState('')
  const [takenOn, setTakenOn] = useState(day && day <= todayIn() ? day : todayIn())
  const [status, setStatus] = useState('')
  const input = useRef<HTMLInputElement>(null)

  const send = async (picked: File[]) => {
    let done = 0
    for (const file of picked) {
      setStatus(`Загружаем ${done + 1} из ${picked.length}…`)
      try {
        const form = new FormData()
        form.append('file', await resizePhoto(file, 2560, 0.9), 'image.jpg')
        form.append('thumb', await resizePhoto(file, 400, 0.8), 'thumb.jpg')
        form.append('kind', kind)
        if (caption.trim()) form.append('caption', caption.trim())
        if (takenOn) form.append('takenOn', takenOn)
        await upload(`/api/patients/${patientId}/files`, form)
        done++
      }
      catch (e) {
        setStatus(e instanceof ApiError ? Object.values(e.fieldErrors)[0] ?? e.message : `«${file.name}» — не картинка или не открылась`)
        break
      }
    }
    if (done === picked.length) {
      setStatus(`Загружено: ${done}`)
      setCaption('')
    }
    if (input.current) input.current.value = ''
    void client.invalidateQueries({ queryKey: ['files', patientId] })
  }

  const remove = useMutation<unknown, ApiError, number>({
    mutationFn: (fileId) => unwrap(api.DELETE('/api/patients/{patientId}/files/{fileId}', { params: { path: { patientId, fileId } } })),
    onSuccess: () => client.invalidateQueries({ queryKey: ['files', patientId] }),
  })
  const view = async (f: FileView) => {
    const blob = await fetchBlob(`/api/patients/${patientId}/files/${f.id}`)
    window.open(URL.createObjectURL(blob), '_blank', 'noopener')
  }

  // Медкарта — снимки, фото, документы; готовые «до / после» для Instagram — отдельно, внизу
  const medical = (files.data ?? []).filter((f) => !isComposite(f))
  const insta = (files.data ?? []).filter(isComposite)
  const count = medical.length
  // В карточке приёма — строка-раскрывашка «Снимки · 3», как «Зубы» и «Материалы»
  const head = compact && (
    <button type="button" className="fold-head" aria-expanded={open} onClick={() => setOpen(!open)}>
      <span className="fold-title">Снимки и фото</span>
      <span className="fold-meta">{count ? count : 'нет'}{insta.length ? ` · Instagram: ${insta.length}` : ''}</span>
      <span className="fold-chev" aria-hidden="true">›</span>
    </button>
  )
  if (compact && !open) return <section className="fold" aria-label="Снимки и фото">{head}</section>
  const shown = compact ? medical.slice(0, 4) : medical
  return (
    <section className={compact ? 'fold open files-compact' : 'card-block'} aria-label="Снимки и фото">
      {compact ? head : <h2>Снимки и фото{count ? <span className="hint"> · {count}</span> : null}</h2>}
      {compact && count > 4 && <p className="hint small">Последние 4 — все в медкарте.</p>}
      {!compact && <p className="hint small">Для лечения — видит только клиника. В соцсети отсюда ничего не уходит.</p>}
      {medical.length ? (
        <ul className="files">
          {shown.map((f) => (
            <li key={f.id}>
              <button type="button" className="file" onClick={() => void view(f)} aria-label={`Открыть: ${f.caption ?? kindName(f.kind)}`}>
                <Thumb path={`/api/patients/${patientId}/files/${f.id}?thumb=true`} alt="" />
              </button>
              <span>{f.caption ?? kindName(f.kind)}</span>
              <span className="hint">{f.takenOn ? shortDate(`${f.takenOn}T12:00:00Z`) : ''}{f.createdBy ? ` · ${f.createdBy}` : ''}</span>
              {f.postText && <PostTextCopy text={f.postText} />}
              {f.canDelete && (
                <button type="button" className="link danger-link" onClick={() => void ask('Удалить снимок?').then((ok) => ok && remove.mutate(f.id!))}>Удалить</button>
              )}
            </li>
          ))}
        </ul>
      ) : files.isSuccess ? <EmptyState compact icon="🩻" title="Снимков пока нет." /> : null}
      <div className="upload">
        <div className="segments" role="group" aria-label="Что загружаем">
          {KINDS.map(([k, name]) => <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>{name}</button>)}
        </div>
        <p className="hint small kind-hint">{KIND_HINT[kind]}</p>
        <input aria-label="Что на снимке" placeholder="Что на снимке, например «36 до лечения» — необязательно" maxLength={200} value={caption} onChange={(e) => setCaption(e.target.value)} />
        <DateInput aria-label="Дата снимка" value={takenOn} max={todayIn()} onChange={(e) => setTakenOn(e.target.value)} />
        <label className="btn primary">
          📷 Сфотографировать
          <input type="file" accept="image/*" capture="environment" className="sr-only" aria-label="Сфотографировать снимок"
            onChange={(e) => e.target.files?.length && void send([...e.target.files])} />
        </label>
        <label className="btn">
          ＋ Выбрать файлы
          <input ref={input} type="file" accept="image/*" multiple className="sr-only" aria-label="Файлы снимков"
            onChange={(e) => e.target.files?.length && void send([...e.target.files])} />
        </label>
      </div>
      {status && <p role="status" className={status.startsWith('Загружено') ? 'tone-ok' : 'hint'}>{status}</p>}
      {remove.error && <p className="error">{remove.error.message}</p>}
      {files.data && (
        <section className="insta-block" aria-label="Для Instagram">
          <h3>📣 Для Instagram</h3>
          <p className="hint small">Только с согласием пациента. Готовые картинки «до / после» — здесь, отдельно от медкарты.</p>
          {insta.length > 0 && (
            <ul className="files">
              {insta.map((f) => (
                <li key={f.id}>
                  <button type="button" className="file" onClick={() => void view(f)} aria-label="Открыть: до / после">
                    <Thumb path={`/api/patients/${patientId}/files/${f.id}?thumb=true`} alt="" />
                  </button>
                  <span>До / после</span>
                  <span className="hint">{f.takenOn ? shortDate(`${f.takenOn}T12:00:00Z`) : ''}{f.createdBy ? ` · ${f.createdBy}` : ''}</span>
                  {f.postText && <PostTextCopy text={f.postText} />}
                  {f.canDelete && (
                    <button type="button" className="link danger-link" onClick={() => void ask('Удалить картинку «до / после»?').then((ok) => ok && remove.mutate(f.id!))}>Удалить</button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <PublicationBlock patientId={patientId} files={files.data} readOnly={readOnly} />
        </section>
      )}
    </section>
  )
}

/** Текст поста у готовой «до / после»: скопировать и вставить в Instagram — собирать заново не нужно. */
function PostTextCopy({ text }: { text: string }) {
  const [done, setDone] = useState('')
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setDone('скопирован')
    }
    catch {
      setDone('не скопировался — откройте и выделите')
    }
  }
  return (
    <span className="post-copy">
      <button type="button" className="link" title={text} onClick={() => void copy()}>📋 Текст поста</button>
      {done && <span className="hint small" role="status"> {done}</span>}
    </span>
  )
}
