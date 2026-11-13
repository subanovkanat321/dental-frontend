import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { ApiError, upload, type Schemas } from '../api/client'
import { FilePicker } from '../layout/FilePicker'
import { Spinner } from '../layout/Loading'
import { MOVE_TEMPLATE_PATH } from '../lib/texts'
import { counted } from './workbook'

type Report = Schemas['WorkbookImportReport']
type Sheet = Schemas['WorkbookImportSheetReport']

/** Сколько ошибок показать сразу; остальные — по «Показать все». */
const SHOWN_ERRORS = 10

/** Что ещё сделаем с уже имеющимися: пациентам — дополним пустое, услугам — поставим цену. */
const UPDATED: Partial<Record<NonNullable<Sheet['kind']>, string>> = {
  PATIENTS: 'дополним пустые поля',
  SERVICES: 'поставим цену',
}

/**
 * «Шаблон Tish (все данные)» в «Загрузить из Excel»: один файл на пациентов, прайс, сотрудников, склад,
 * будущие записи и долги. Файл разбирает сервер; здесь он только в памяти вкладки и уходит заново на
 * «Загрузить». Предпросмотр по листам и ошибки строк (лист, строка, причина), потом одна кнопка.
 */
export function WorkbookImport() {
  const client = useQueryClient()
  const [file, setFile] = useState<File | null>(null)
  const form = (f: File) => {
    const body = new FormData()
    body.append('file', f)
    return body
  }
  const preview = useMutation<Report, ApiError, File>({
    mutationFn: (f) => upload<Report>('/api/clinic/import/workbook/preview', form(f)),
  })
  const apply = useMutation<Report, ApiError>({
    mutationFn: () => upload<Report>('/api/clinic/import/workbook', form(file!)),
    onSuccess: () => {
      for (const key of ['patients', 'service-types', 'members', 'doctors-admin', 'me', 'supplies', 'appointments', 'debts', 'opening-debts']) {
        void client.invalidateQueries({ queryKey: [key] })
      }
    },
  })
  const reset = () => {
    setFile(null)
    preview.reset()
    apply.reset()
  }
  const choose = (f: File | undefined) => {
    apply.reset()
    setFile(f ?? null)
    if (f) preview.mutate(f)
  }
  const r = preview.data
  const done = apply.data
  const fileError = preview.error?.fieldErrors.file ?? preview.error?.message
  const applyError = apply.error ? Object.values(apply.error.fieldErrors)[0] ?? apply.error.message : null
  const changes = (r?.sheets ?? []).some((s) => s.added + s.updated > 0) || (r?.extraPatients ?? 0) > 0
  return (
    <div className="import-workbook" aria-label="Шаблон Tish">
      <p>Один файл на всё: пациенты, услуги и цены, врачи и сотрудники, склад, будущие записи и долги — каждое на своём листе.
        Пустые листы пропустим. Сначала покажем, что добавим, — потом одна кнопка.</p>
      <p className="hint small"><a href={MOVE_TEMPLATE_PATH} download="tish-perenos.xlsx">Скачать шаблон (.xlsx)</a>
        {' '}— на каждом листе серая строка-пример и подсказки у заголовков.</p>
      {done ? (
        <div className="import-done" role="status">
          <p className="tone-ok">✅ Загружено: {added(done) || 'ничего нового'}{done.errorCount ? `. Строк с ошибками не загрузили: ${done.errorCount}` : ''}</p>
          <button type="button" className="btn" onClick={reset}>Загрузить ещё файл</button>
        </div>
      ) : (
        <>
          <FilePicker label="Заполненный шаблон" button="Выбрать файл (.xlsx)" file={file} onChange={choose}
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" />
          {preview.isPending && <p className="hint"><Spinner />Читаем листы…</p>}
          {preview.error && <p className="error" role="alert">{fileError}</p>}
          {r && <Preview report={r} />}
          {applyError && <p className="error" role="alert">{applyError}</p>}
          {r && (
            <div className="actions">
              <button type="button" className="btn primary" disabled={!changes || apply.isPending || preview.isPending}
                onClick={() => apply.mutate()}>
                {apply.isPending ? <><Spinner />Загружаем…</> : 'Загрузить'}</button>
              <button type="button" className="btn ghost" onClick={reset}>Отмена</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

/** «248 пациентов, 35 услуг, 2 сотрудника» — что добавим (добавили) по всем листам. */
function added(r: Report): string {
  const parts = (r.sheets ?? []).filter((s) => s.added > 0 || (s.kind === 'PATIENTS' && r.extraPatients > 0))
    .map((s) => counted(s.added + (s.kind === 'PATIENTS' ? r.extraPatients : 0), s.kind!))
  if (!(r.sheets ?? []).some((s) => s.kind === 'PATIENTS') && r.extraPatients > 0) parts.unshift(counted(r.extraPatients, 'PATIENTS'))
  return parts.join(', ')
}

/** Предпросмотр: итог одной строкой, по листам — что добавим и что уже есть, ошибки строк таблицей. */
function Preview({ report: r }: { report: Report }) {
  const [all, setAll] = useState(false)
  const errors = r.errors ?? []
  const shown = all ? errors : errors.slice(0, SHOWN_ERRORS)
  const sheets = r.sheets ?? []
  const total = added(r)
  return (
    <div className="import-summary" aria-label="Предпросмотр">
      {sheets.length === 0 ? <p className="tone-wait" role="note">Листы пустые — заполните шаблон (строку-пример можно оставить: её пропустим).</p> : (
        <p><b>{total ? `Добавим ${total}` : 'Нового нет — всё уже в Tish'}</b>
          {r.errorCount > 0 && <span className="tone-bad">; строк с ошибкой: <b className="num">{r.errorCount}</b> — их не загрузим</span>}</p>
      )}
      {sheets.length > 0 && (
        <table className="import-sheets" aria-label="По листам">
          <thead><tr><th>Лист</th><th className="num">Строк</th><th className="num">Добавим</th><th className="num">Уже есть</th><th className="num">С ошибкой</th></tr></thead>
          <tbody>
            {sheets.map((s) => (
              <tr key={s.kind}>
                <td>{s.title}{s.updated > 0 && UPDATED[s.kind!] && <span className="hint small"> · {UPDATED[s.kind!]}: {s.updated}</span>}</td>
                <td className="num">{s.rows}</td>
                <td className="num">{s.added + (s.kind === 'PATIENTS' ? r.extraPatients : 0)}</td>
                <td className="num">{s.unchanged}</td>
                <td className={`num${s.errorCount > 0 ? ' tone-bad' : ''}`}>{s.errorCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {r.extraPatients > 0 && (
        <p className="hint small" role="note">Из них {counted(r.extraPatients, 'PATIENTS')} — из записей и долгов: их нет на листе «Пациенты», заведём по имени и номеру.</p>
      )}
      {(r.skipped ?? []).length > 0 && (
        <p className="hint small">Пропустим незнакомые листы: {(r.skipped ?? []).map((s) => `«${s}»`).join(', ')}.</p>
      )}
      {errors.length > 0 && (
        <>
          <table className="import-errors" aria-label="Ошибки в строках">
            <thead><tr><th>Лист</th><th className="num">Строка</th><th>Колонка</th><th>Что не так</th></tr></thead>
            <tbody>
              {shown.map((e, i) => <tr key={i}><td>{e.sheet}</td><td className="num">{e.row}</td><td>{e.column}</td><td>{e.message}</td></tr>)}
            </tbody>
          </table>
          {!all && errors.length > SHOWN_ERRORS && (
            <button type="button" className="link" onClick={() => setAll(true)}>Показать все ошибки ({errors.length}{r.errorCount > errors.length ? ` из ${r.errorCount}` : ''})</button>
          )}
          <p className="hint small">Исправьте эти строки в файле и загрузите его ещё раз — уже загруженное не задвоится.</p>
        </>
      )}
    </div>
  )
}
