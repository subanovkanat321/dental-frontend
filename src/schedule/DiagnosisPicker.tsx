import { useQuery } from '@tanstack/react-query'
import { useId, useState } from 'react'

import { api, unwrap, type Schemas } from '../api/client'
import { useDebounced } from '../lib/useDebounced'
import { dxLabel, joinText, mergeCodes, type Dx } from './noteSections'

type Formulation = Schemas['DiagnosesFormulation']

/** Зуб по FDI — как на сервере (Teeth.valid): постоянные 11–48, молочные 51–85. */
function validTooth(n: number): boolean {
  const q = Math.floor(n / 10)
  const t = n % 10
  return (q >= 1 && q <= 4 && t >= 1 && t <= 8) || (q >= 5 && q <= 8 && t >= 1 && t <= 5)
}

/**
 * Раздел «Диагноз» (шаг 3, опыт Dentist Plus): чипы диагнозов МКБ-10 («K02.1 Кариес дентина · 36», зуб — в чипе,
 * ✕ — убрать), поиск с подсказками — МКБ-10 из списка сервера (K00–K14) и свои формулировки клиники (что врачи уже
 * писали, частые сверху) — и текст своими словами. Подсказки — с сервера (/api/diagnoses/suggest): код проверяет он.
 * Медданные в URL не попадают: в запросе только то, что врач ищет («пульп»), без пациента.
 */
export function DiagnosisPicker({ codes, text, onCodes, onText, autoFocus, noTooth }: {
  codes: Dx[]
  text: string
  onCodes: (codes: Dx[]) => void
  onText: (text: string) => void
  autoFocus?: boolean
  /** Шаблон приёма: зуба у диагноза нет — он ляжет на зубы, выбранные при применении */
  noTooth?: boolean
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const q = useDebounced(query.trim(), 200)
  const listId = useId()
  const suggest = useQuery({
    queryKey: ['diagnoses', q],
    queryFn: () => unwrap(api.GET('/api/diagnoses/suggest', { params: { query: { q } } })),
    enabled: open,
    staleTime: 60_000,
    retry: false,
  })
  const icd = (suggest.data?.codes ?? []).filter((c) => !codes.some((d) => d.code === c.code && d.tooth == null))
  const own = suggest.data?.own ?? []

  const close = () => { setOpen(false); setQuery('') }
  const addCode = (c: Dx) => { onCodes(mergeCodes(codes, [c])); close() }
  const pickOwn = (f: Formulation) => {
    onText(joinText(text, f.text))
    if (f.code) onCodes(mergeCodes(codes, [{ code: f.code, title: f.title }]))
    close()
  }
  const setTooth = (i: number, raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, 2)
    const n = Number(digits)
    onCodes(codes.map((d, j) => (j === i ? { ...d, tooth: digits.length === 2 && validTooth(n) ? n : undefined } : d)))
  }
  const shown = open && (icd.length > 0 || own.length > 0)

  return (
    <div className="dx">
      {codes.length > 0 && (
        <ul className="dx-chips" aria-label="Диагнозы МКБ-10">
          {codes.map((d, i) => (
            <li key={`${d.code}-${i}`} className="chip dx-chip">
              <span className="dx-code num">{d.code}</span>
              <span className="dx-title">{d.title}</span>
              {!noTooth && <ToothInput value={d.tooth} label={`Зуб к диагнозу ${d.code}`} onChange={(v) => setTooth(i, v)} />}
              <button type="button" className="dx-remove" aria-label={`Убрать диагноз ${dxLabel(d)}`}
                onClick={() => onCodes(codes.filter((_, j) => j !== i))}>✕</button>
            </li>
          ))}
        </ul>
      )}
      <div className="dx-search">
        <input type="search" role="combobox" aria-label="Диагноз по МКБ-10" aria-expanded={shown} aria-controls={listId}
          aria-autocomplete="list" placeholder="МКБ-10: код или слово — K02, пульпит" value={query} autoFocus={autoFocus}
          autoComplete="off" enterKeyHint="search"
          onFocus={() => setOpen(true)} onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
          onBlur={(e) => { if (!e.currentTarget.parentElement?.contains(e.relatedTarget as Node | null)) setOpen(false) }}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && open) {
              // Закрыть подсказки, а не карточку приёма (у неё Esc на window)
              e.preventDefault()
              e.stopPropagation()
              close()
            }
            if (e.key === 'Enter') {
              e.preventDefault()
              if (icd[0]) addCode(icd[0])
              else if (own[0]) pickOwn(own[0])
            }
          }} />
        {shown && (
          <div className="dx-list" id={listId} role="listbox" aria-label="Подсказки диагноза">
            {icd.length > 0 && <div className="dx-group" role="presentation">{q ? 'МКБ-10' : 'Частые коды клиники'}</div>}
            {icd.map((c) => (
              <button key={c.code} type="button" role="option" aria-selected={false} className="dx-option"
                onMouseDown={(e) => e.preventDefault()} onClick={() => addCode(c)}>
                <span className="dx-code num">{c.code}</span>{' '}<span className="dx-opt-text">{c.title}</span>
              </button>
            ))}
            {own.length > 0 && <div className="dx-group" role="presentation">Свои формулировки</div>}
            {own.map((f) => (
              <button key={f.text} type="button" role="option" aria-selected={false} className="dx-option"
                onMouseDown={(e) => e.preventDefault()} onClick={() => pickOwn(f)}>
                <span className="dx-opt-text">{f.text}</span>
                <span className="hint small">{[f.code, f.uses > 1 ? `${f.uses}×` : null].filter(Boolean).join(' · ')}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <textarea aria-label="Диагноз своими словами" rows={text.length > 60 ? 2 : 1} maxLength={2000} value={text}
        placeholder="Своими словами (необязательно)" onChange={(e) => onText(e.target.value)} />
    </div>
  )
}

/** Номер зуба в чипе: пока печатают — как ввели, в диагноз — только верный номер FDI. */
function ToothInput({ value, label, onChange }: { value?: number; label: string; onChange: (v: string) => void }) {
  const [draft, setDraft] = useState(value != null ? String(value) : '')
  // Номер поменялся снаружи (убрали соседний чип с тем же кодом) — показать его; неполный ввод не трогаем
  const [seen, setSeen] = useState(value)
  if (value !== seen) {
    setSeen(value)
    if (value != null || draft.length !== 1) setDraft(value != null ? String(value) : '')
  }
  return (
    <input className="dx-tooth num" aria-label={label} inputMode="numeric" maxLength={2} placeholder="зуб" value={draft}
      onChange={(e) => { const v = e.target.value.replace(/\D/g, ''); setDraft(v); onChange(v) }} />
  )
}
