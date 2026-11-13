import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { ApiError, upload, type Schemas } from '../api/client'
import { FilePicker } from '../layout/FilePicker'
import { Select } from '../layout/Select'
import { Spinner } from '../layout/Loading'
import { download } from '../lib/download'
import { WorkbookImport } from './WorkbookImport'
import './import.css'

type Report = Schemas['DataImportReport']
type Columns = Schemas['ImportColumns']
type Kind = NonNullable<Report['kind']>
type Field = keyof Columns

/** Поля, которые можно сопоставить с колонкой таблицы: пациенты и прайс. Обязательные — со звёздочкой. */
const FIELDS: Record<Kind, [Field, string][]> = {
  PATIENTS: [['fullName', 'ФИО'], ['lastName', 'Фамилия'], ['firstName', 'Имя'], ['middleName', 'Отчество'],
    ['phone', 'Телефон *'], ['birthDate', 'Дата рождения'], ['workplace', 'Место работы']],
  SERVICES: [['name', 'Название услуги *'], ['price', 'Цена, сом'], ['duration', 'Длительность, мин'], ['group', 'Раздел']],
}

/** Сколько ошибок показать сразу; остальные — по «Показать все». */
const SHOWN_ERRORS = 10

/**
 * «Загрузить из Excel»: новая клиника переносит пациентов и прайс из таблицы (.xlsx или .csv). Файл
 * разбирает сервер; здесь он живёт только в памяти вкладки (не в localStorage) и уходит заново на
 * каждый шаг: «Колонки» (угаданы по заголовкам — можно поправить), предпросмотр (сколько добавим,
 * дубли по номеру, ошибки по строкам) и «Загрузить» — одной транзакцией.
 */
export function ImportData() {
  const client = useQueryClient()
  const [kind, setKind] = useState<Kind>('PATIENTS')
  // «Шаблон Tish» — всё одним файлом (переезд клиники); иначе — отдельные таблицы пациентов или прайса
  const [workbook, setWorkbook] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [columns, setColumns] = useState<Columns | null>(null)

  const form = (f: File, cols: Columns | null) => {
    const body = new FormData()
    body.append('file', f)
    body.append('kind', kind)
    for (const [key, value] of Object.entries(cols ?? {})) if (value != null) body.append(key, String(value))
    return body
  }
  const preview = useMutation<Report, ApiError, { f: File; cols: Columns | null }>({
    mutationFn: ({ f, cols }) => upload<Report>('/api/clinic/import/preview', form(f, cols)),
    onSuccess: (r, { cols }) => { if (!cols) setColumns(r.columns ?? {}) },
  })
  const apply = useMutation<Report, ApiError>({
    mutationFn: () => upload<Report>('/api/clinic/import', form(file!, columns)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['service-types'] })
      void client.invalidateQueries({ queryKey: ['patients'] })
    },
  })

  const reset = (next?: Kind) => {
    setFile(null)
    setColumns(null)
    preview.reset()
    apply.reset()
    if (next) setKind(next)
    setWorkbook(false)
  }
  const choose = (f: File | undefined) => {
    apply.reset()
    setColumns(null)
    setFile(f ?? null)
    if (f) preview.mutate({ f, cols: null })
  }
  const pick = (field: Field, value: string) => {
    const next = { ...columns, [field]: value === '' ? undefined : Number(value) }
    setColumns(next)
    if (file) preview.mutate({ f: file, cols: next })
  }

  const r = preview.data
  const done = apply.data
  const fileError = preview.error?.fieldErrors.file ?? preview.error?.message
  const applyError = apply.error ? Object.values(apply.error.fieldErrors)[0] ?? apply.error.message : null
  const ready = r && (kind === 'SERVICES' ? columns?.name != null
    : columns?.phone != null && (columns.fullName != null || columns.lastName != null || columns.firstName != null))
  const exampleName = kind === 'PATIENTS' ? 'пациенты-пример' : 'прайс-пример'
  return (
    <section className="card-block import-data" aria-label="Загрузить из Excel">
      <h2>Загрузить из Excel</h2>
      <p>Перенесите базу из таблицы: всё сразу по шаблону Tish или отдельно — пациентов (ФИО, телефон, дата рождения) или прайс услуг
        (название, цена, длительность, раздел). Подойдёт .xlsx до 5 МБ и 10 000 строк на лист (отдельные таблицы — и .csv).</p>
      <div className="segments" role="group" aria-label="Что загружаем">
        <button type="button" aria-pressed={workbook} onClick={() => { reset(); setWorkbook(true) }}>Шаблон Tish (всё)</button>
        <button type="button" aria-pressed={!workbook && kind === 'PATIENTS'} onClick={() => reset('PATIENTS')}>Пациенты</button>
        <button type="button" aria-pressed={!workbook && kind === 'SERVICES'} onClick={() => reset('SERVICES')}>Прайс услуг</button>
      </div>
      {workbook ? <WorkbookImport /> : <>
      <p className="hint small">Скачать пример:{' '}
        <button type="button" className="link" onClick={() => void download(`/api/clinic/import/template?kind=${kind}&format=xlsx`, `${exampleName}.xlsx`)}>Excel (.xlsx)</button>
        {' · '}
        <button type="button" className="link" onClick={() => void download(`/api/clinic/import/template?kind=${kind}&format=csv`, `${exampleName}.csv`)}>CSV</button>
      </p>
      {done ? (
        <div className="import-done" role="status">
          <p className="tone-ok">✅ Загружено: добавлено {done.added}, {kind === 'PATIENTS' ? 'дополнено' : 'поставлено цен'} {done.updated},
            {' '}пропущено {done.unchanged + done.errorCount}{done.errorCount ? ` (с ошибками ${done.errorCount})` : ''}</p>
          <button type="button" className="btn" onClick={() => reset()}>Загрузить ещё файл</button>
        </div>
      ) : (
        <>
          <FilePicker label="Файл таблицы" button="Выбрать файл (.xlsx, .csv)" file={file} onChange={choose}
            accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" />
          {preview.isPending && <p className="hint"><Spinner />Читаем таблицу…</p>}
          {preview.error && <p className="error" role="alert">{fileError}</p>}
          {r && columns && (
            <>
              <h3>Колонки</h3>
              <p className="hint small">Угадали по заголовкам — проверьте и поправьте, если не так.
                {kind === 'PATIENTS' && ' ФИО — одной колонкой или по частям: Фамилия, Имя, Отчество.'}</p>
              <div className="import-columns">
                {FIELDS[kind].map(([field, label]) => (
                  <label key={field} className="field"><span>{label}</span>
                    <Select aria-label={label} value={columns[field] != null ? String(columns[field]) : ''} onChange={(e) => pick(field, e.target.value)}>
                      <option value="">— нет —</option>
                      {(r.headers ?? []).map((h, i) => <option key={i} value={String(i)}>{h}</option>)}
                    </Select>
                  </label>
                ))}
              </div>
              <div className="import-sample">
                <table aria-label="Первые строки файла">
                  <thead><tr>{(r.headers ?? []).map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
                  <tbody>
                    {(r.sample ?? []).map((row, i) => <tr key={i}>{row.map((c, j) => <td key={j}>{c}</td>)}</tr>)}
                  </tbody>
                </table>
              </div>
              {ready ? <Summary kind={kind} report={r} /> : (
                <p className="tone-wait" role="note">{kind === 'PATIENTS' ? 'Выберите колонки с ФИО и телефоном' : 'Выберите колонку с названием услуги'}</p>
              )}
              {applyError && <p className="error" role="alert">{applyError}</p>}
              <div className="actions">
                <button type="button" className="btn primary" disabled={!ready || !r.added && !r.updated || apply.isPending || preview.isPending}
                  onClick={() => apply.mutate()}>
                  {apply.isPending ? <><Spinner />Загружаем…</> : 'Загрузить'}</button>
                <button type="button" className="btn ghost" onClick={() => reset()}>Отмена</button>
              </div>
            </>
          )}
        </>
      )}
      </>}
    </section>
  )
}

/** Предпросмотр: что будет добавлено, что уже есть, что с ошибками (строки с ошибками не загрузятся). */
function Summary({ kind, report: r }: { kind: Kind; report: Report }) {
  const [all, setAll] = useState(false)
  const errors = r.errors ?? []
  const shown = all ? errors : errors.slice(0, SHOWN_ERRORS)
  const patients = kind === 'PATIENTS'
  return (
    <div className="import-summary" aria-label="Предпросмотр">
      <p>Строк в файле: <b className="num">{r.rows}</b></p>
      <ul className="import-counts">
        <li className="tone-ok">Будет добавлено: <b className="num">{r.added}</b></li>
        {r.updated > 0 && (
          <li>{patients ? 'Уже есть — дополним пустую дату рождения или место работы' : 'Уже есть без цены — поставим цену'}: <b className="num">{r.updated}</b></li>
        )}
        {r.unchanged > 0 && (
          <li className="hint">{patients ? 'Уже есть (тот же номер и имя) — пропустим' : 'Уже есть — пропустим, цену не меняем'}: <b className="num">{r.unchanged}</b></li>
        )}
        {r.errorCount > 0 && <li className="tone-bad">С ошибками — не загрузим: <b className="num">{r.errorCount}</b></li>}
      </ul>
      {patients && r.sharedPhone > 0 && (
        <p className="hint small" role="note">Из новых {r.sharedPhone} — на номере, где уже есть другой человек (семья на одном номере):
          заведём отдельные карточки.</p>
      )}
      {errors.length > 0 && (
        <>
          <table className="import-errors" aria-label="Ошибки в строках">
            <thead><tr><th>Строка</th><th>Колонка</th><th>Что не так</th></tr></thead>
            <tbody>
              {shown.map((e, i) => <tr key={i}><td className="num">{e.row}</td><td>{e.column}</td><td>{e.message}</td></tr>)}
            </tbody>
          </table>
          {!all && errors.length > SHOWN_ERRORS && (
            <button type="button" className="link" onClick={() => setAll(true)}>Показать все ошибки ({errors.length}{r.errorCount > errors.length ? ` из ${r.errorCount}` : ''})</button>
          )}
          <p className="hint small">Исправьте эти строки в таблице и загрузите файл ещё раз — уже загруженные не задвоятся.</p>
        </>
      )}
    </div>
  )
}
