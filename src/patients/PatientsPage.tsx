import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { api, unwrap, type Schemas } from '../api/client'
import { useWaitlist } from '../api/settings'
import { formatPhone, shortDate } from '../lib/time'
import { MedicalRecord } from '../medical/MedicalRecord'
import { NewPatientPanel } from './PatientForm'
import { PatientPanel } from './PatientPanel'
import { RecallTab, WaitlistTab } from './WaitlistTab'

type Me = Schemas['BookingViewsMe']
type Row = Schemas['PatientListControllerPatientRow']
type Patient = Schemas['PatientView']

type SortKey = 'name' | 'last' | 'next'

/** Пауза перед поиском на сервере: не дёргать его на каждую букву. */
function useDebounced(value: string, ms = 300): string {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return debounced
}

/** Строка поиска как цифры номера: «0555 12» → «55512» (без 0 и кода страны). */
function phoneDigits(text: string): string {
  return text.replace(/\D/g, '').replace(/^(996|0)/, '')
}

/**
 * «Пациенты»: таблица с поиском и сортировкой, карточка — справа. Список — последние 300 по
 * дате визита (/api/patients/recent, как в приложении); не нашли среди них — ищем на сервере
 * по всей клинике (/api/patients/search).
 */
export function PatientsPage({ me, onBook, initialPatient }: { me: Me; onBook: (p: Patient) => void; initialPatient?: number }) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'last', desc: true })
  const [selected, setSelected] = useState<number | 'new' | null>(initialPatient ?? null)
  // Медкарта — на месте таблицы, во всю ширину: карте зубов нужно место
  const [medical, setMedical] = useState<Patient | null>(null)
  // Вкладки: все пациенты, лист ожидания, «позвать на профосмотр» — как в «Пациентах» приложения
  const [tab, setTab] = useState<'all' | 'waitlist' | 'recall'>('all')
  const waitlist = useWaitlist()
  const close = useCallback(() => setSelected(null), [])

  const recent = useQuery({
    queryKey: ['patients', 'recent'],
    queryFn: () => unwrap(api.GET('/api/patients/recent')),
  })

  const text = query.trim().toLowerCase()
  const digits = phoneDigits(text)
  const local = useMemo(() => (recent.data ?? []).filter((p) => !text
    || p.fullName?.toLowerCase().includes(text)
    || (digits.length >= 3 && p.phone?.includes(digits))), [recent.data, text, digits])

  // Среди последних 300 нет — спросить сервер (он ищет по всей клинике)
  const search = useDebounced(text)
  const remote = useQuery({
    queryKey: ['patients', 'search', search],
    queryFn: () => unwrap(api.POST('/api/patients/search', { body: { query: search } })),
    enabled: search.length >= 2 && recent.isSuccess && local.length === 0,
  })
  const rows: Row[] = local.length || !text ? local : (remote.data ?? []).map((p) => ({ ...p }))

  const sorted = useMemo(() => {
    const value = (r: Row) => (sort.key === 'name' ? r.fullName ?? '' : sort.key === 'last' ? r.lastVisit ?? '' : r.nextVisit ?? '')
    return [...rows].sort((a, b) => {
      const x = value(a)
      const y = value(b)
      // Пустые даты — всегда в конце, в какую сторону ни сортируй
      if (!x && y) return 1
      if (x && !y) return -1
      const order = sort.key === 'name' ? x.localeCompare(y, 'ru') : x < y ? -1 : x > y ? 1 : 0
      return sort.desc ? -order : order
    })
  }, [rows, sort])

  const header = (key: SortKey, title: string) => (
    <th aria-sort={sort.key === key ? (sort.desc ? 'descending' : 'ascending') : 'none'}>
      <button type="button" className="th-sort" onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : key !== 'name' }))}>
        {title}{sort.key === key ? (sort.desc ? ' ↓' : ' ↑') : ''}
      </button>
    </th>
  )

  if (medical) {
    return (
      <div className="schedule">
        <MedicalRecord patient={medical} onBack={() => { setSelected(medical.id!); setMedical(null) }} />
      </div>
    )
  }

  return (
    <div className={selected ? 'schedule with-panel' : 'schedule'}>
      <section className="schedule-main">
        <header className="toolbar">
          <h1>Пациенты</h1>
          <div className="segments tabs" role="tablist" aria-label="Списки пациентов">
            {([['all', 'Все'], ['waitlist', `Лист ожидания${waitlist.data?.length ? ` · ${waitlist.data.length}` : ''}`], ['recall', 'Профосмотр']] as const)
              .map(([key, title]) => (
                <button key={key} type="button" role="tab" aria-selected={tab === key} aria-pressed={tab === key} onClick={() => setTab(key)}>{title}</button>
              ))}
          </div>
          {tab === 'all' && (
            <>
              <input type="search" className="search" aria-label="Поиск пациента" placeholder="Имя или номер телефона"
                value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
              <button type="button" className="btn" onClick={() => setSelected('new')}>＋ Новый пациент</button>
              <span className="hint">
                {recent.isPending ? 'Загрузка…' : text ? `Найдено: ${sorted.length}` : `Последние по визитам: ${sorted.length}`}
              </span>
            </>
          )}
        </header>
        {tab === 'waitlist' && <WaitlistTab me={me} onOpen={setSelected} />}
        {tab === 'recall' && <RecallTab onOpen={setSelected} onBook={onBook} />}
        {tab === 'all' && recent.error && <p className="error">{recent.error.message}</p>}
        {tab === 'all' && recent.isSuccess && sorted.length === 0 && (
          <p className="hint">{text ? (remote.isFetching ? 'Ищем по всей клинике…' : `Никого не нашли по «${query.trim()}».`) : 'Пациентов пока нет — они появятся с первой записью.'}</p>
        )}
        {tab === 'all' && sorted.length > 0 && (
          <table className="table">
            <thead>
              <tr>
                {header('name', 'Пациент')}
                <th>Телефон</th>
                {header('last', 'Был')}
                {header('next', 'Записан')}
              </tr>
            </thead>
            <tbody>
              {sorted.map((p) => (
                <tr key={p.id} className={p.id === selected ? 'active' : undefined}>
                  <td>
                    <button type="button" className="row-link" onClick={() => setSelected(p.id!)}>{p.fullName}</button>
                    {p.telegram && <span className="tg" title="Пишет боту в Telegram — напоминания придут туда">Telegram</span>}
                  </td>
                  <td className="nowrap num">{p.phone ? formatPhone(p.phone) : '—'}</td>
                  <td className="nowrap">{p.lastVisit ? shortDate(p.lastVisit) : '—'}</td>
                  <td className="nowrap">{p.nextVisit ? shortDate(p.nextVisit, true) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {selected === 'new' && <NewPatientPanel onClose={close} onCreated={setSelected} />}
      {typeof selected === 'number' && <PatientPanel key={selected} patientId={selected} me={me} onClose={close} onBook={onBook}
        onMedical={(p) => { setSelected(null); setMedical(p) }} />}
    </div>
  )
}
