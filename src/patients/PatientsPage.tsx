import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { rowClick } from '../lib/rowClick'
import { api, unwrap, type Schemas } from '../api/client'
import { useWaitlist } from '../api/settings'
import { formatPhone, shortDate } from '../lib/time'
import { MedicalRecord } from '../medical/MedicalRecord'
import { NewPatientPanel } from './PatientForm'
import { PatientPanel } from './PatientPanel'
import { BookedTab, type BookedFilter } from './BookedTab'
import { RecallTab, WaitlistTab } from './WaitlistTab'
import { ComebackTab } from './ComebackTab'
import { QuestionPanel, QuestionsTab } from './QuestionsTab'
import { useNewQuestions } from '../api/questions'
import { canEditServices, isAssistant } from '../lib/roles'
import { stickyHead } from '../layout/stickyHead'
import { EmptyState } from '../layout/EmptyState'
import { Select } from '../layout/Select'
import { Spinner } from '../layout/Loading'

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
  return text.replace(/\D/g, '').replace(/^(00|996|0)/, '')
}

/**
 * «Пациенты»: таблица с поиском и сортировкой, карточка — справа. Список — последние 300 по
 * дате визита (/api/patients/recent, как в приложении); не нашли среди них — ищем на сервере
 * по всей клинике (/api/patients/search).
 */
export function PatientsPage({ me, onBook, initialPatient, initialQuestion, initialBooked, onOpenAppointment }: {
  me: Me
  onBook: (p: Patient) => void
  initialPatient?: number
  /** Кнопка уведомления «Открыть вопрос» — вкладка «Вопросы» с этим вопросом */
  initialQuestion?: number
  /** Кнопка сводки «📲 Напомнить (N)» — вкладка «Записаны» на этот день, только кто не подтвердил */
  initialBooked?: BookedFilter
  onOpenAppointment?: (appointmentId: number) => void
}) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'last', desc: true })
  const [selected, setSelected] = useState<number | 'new' | null>(initialPatient ?? null)
  // Медкарта — на месте таблицы, во всю ширину: карте зубов нужно место
  const [medical, setMedical] = useState<Patient | null>(null)
  // Вкладки: все пациенты, лист ожидания, «позвать на профосмотр» — как в «Пациентах» приложения
  const [tab, setTab] = useState<'all' | 'booked' | 'waitlist' | 'recall' | 'comeback' | 'questions'>(initialQuestion ? 'questions' : initialBooked ? 'booked' : 'all')
  const waitlist = useWaitlist()
  const close = useCallback(() => setSelected(null), [])
  // Вопрос пациента справа (вкладка «Вопросы»); открыли карточку пациента — вопрос закрываем, и наоборот
  const [question, setQuestion] = useState<number | null>(initialQuestion ?? null)
  const closeQuestion = useCallback(() => setQuestion(null), [])
  const newQuestions = useNewQuestions().data?.count ?? 0

  // Чьи пациенты: все или одного врача (у кого был или будет приём у него)
  // Ассистенту — только его врачи
  const doctors = (me.doctors ?? []).filter((d) => d.active !== false && (!isAssistant(me) || me.assistantOf!.includes(d.id!)))
  // Ассистент сразу видит пациентов своего врача
  const [doctorId, setDoctorId] = useState<number | null>(() => (me.assistantOf?.length === 1 ? me.assistantOf[0]! : null))
  const recent = useQuery({
    queryKey: ['patients', 'recent', doctorId],
    queryFn: () => unwrap(api.GET('/api/patients/recent', { params: { query: { doctorId: doctorId ?? undefined } } })),
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
    // Среди списка (или пациентов врача — их там до 300) не нашли — ищем по всей клинике: иначе
    // старого пациента врача не найти ни по имени, ни по телефону
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
        <MedicalRecord patient={medical} readOnly={isAssistant(me)} onBack={() => { setSelected(medical.id!); setMedical(null) }} />
      </div>
    )
  }

  return (
    <div className={selected || (tab === 'questions' && question) ? 'schedule with-panel' : 'schedule'}>
      <section className="schedule-main">
        <header ref={stickyHead} className="toolbar sticky-head patients-head">
          <h1>Пациенты</h1>
          <div className="segments tabs" role="tablist" aria-label="Списки пациентов">
            {/* «Позвать снова» (бывшее «Вернуть») — деньги на столе и приглашения; ассистенту (денег не видит) — прежний «Профосмотр» */}
            {([['all', 'Все'], ['booked', 'Записаны'], ['waitlist', `Лист ожидания${waitlist.data?.length ? ` · ${waitlist.data.length}` : ''}`],
              isAssistant(me) ? ['recall', 'Профосмотр'] : ['comeback', 'Позвать снова'],
              ['questions', `Вопросы${newQuestions ? ` · ${newQuestions}` : ''}`]] satisfies [typeof tab, string][])
              .map(([key, title]) => (
                <button key={key} type="button" role="tab" aria-selected={tab === key} aria-pressed={tab === key} onClick={() => setTab(key)}>{title}</button>
              ))}
          </div>
          {tab === 'all' && (
            <>
              {/* На компьютере: строка поиска и фильтров под заголовком, «Новый пациент» — справа от вкладок */}
              <div className="head-filters">
                <input type="search" className="search" aria-label="Поиск пациента" placeholder="Имя или номер телефона"
                  value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
                {doctors.length > 1 && (
                  <Select aria-label="Чьи пациенты" value={doctorId ?? ''} onChange={(e) => setDoctorId(e.target.value ? Number(e.target.value) : null)}>
                    <option value="">Все врачи</option>
                    {doctors.map((d) => <option key={d.id} value={d.id}>{d.fullName}{d.id === me.doctorId ? ' (я)' : ''}</option>)}
                  </Select>
                )}
                <span className="hint">
                  {recent.isPending ? <><Spinner />Загрузка…</> : text ? `Найдено: ${sorted.length}${doctorId != null && !local.length && sorted.length ? ' — по всей клинике' : ''}` : doctorId != null ? `Пациентов врача: ${sorted.length}` : `Последние по визитам: ${sorted.length}`}
                </span>
              </div>
              <button type="button" className="btn primary head-action" onClick={() => setSelected('new')}>＋ Новый пациент</button>
            </>
          )}
        </header>
        {tab === 'booked' && <BookedTab me={me} initial={initialBooked} onOpenAppointment={onOpenAppointment} />}
        {tab === 'waitlist' && <WaitlistTab me={me} onOpen={setSelected} />}
        {tab === 'recall' && <RecallTab onOpen={setSelected} onBook={onBook} />}
        {tab === 'questions' && <QuestionsTab selected={question} onOpen={(id) => { setSelected(null); setQuestion(id) }} />}
        {tab === 'comeback' && <ComebackTab onOpen={setSelected} onBook={onBook} canEditServices={canEditServices(me)} />}
        {tab === 'all' && recent.error && <p className="error">{recent.error.message}</p>}
        {tab === 'all' && recent.isSuccess && sorted.length === 0 && (
          <EmptyState title={text ? (remote.isFetching ? 'Ищем по всей клинике…' : `Никого не нашли по «${query.trim()}»`) : doctorId != null ? 'У этого врача пока не было пациентов' : 'Пациентов пока нет'}>
            {text ? (remote.isFetching ? undefined : 'Проверьте написание или ищите по последним цифрам телефона.') : doctorId == null ? 'Они появятся с первой записью — или добавьте кнопкой «＋ Новый пациент».' : undefined}
          </EmptyState>
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
                <tr key={p.id} className={['clickable', p.id === selected ? 'active' : ''].join(' ').trim()} onClick={rowClick(() => setSelected(p.id!))}>
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
      {tab === 'questions' && question != null && selected == null && (
        <QuestionPanel key={question} questionId={question} onClose={closeQuestion} onOpenPatient={(id) => { setQuestion(null); setSelected(id) }} />
      )}
      {selected === 'new' && <NewPatientPanel onClose={close} onCreated={setSelected} />}
      {typeof selected === 'number' && <PatientPanel key={selected} patientId={selected} me={me} onClose={close} onBook={onBook} onOpenAppointment={onOpenAppointment}
        onOpenPatient={setSelected} onMedical={(p) => { setSelected(null); setMedical(p) }} />}
    </div>
  )
}
