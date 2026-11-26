import type { Schemas } from '../api/client'
import { colorOf, initials } from '../lib/avatars'
import { rowOpen } from '../lib/rowClick'
import { formatPhone, shortDate, todayIn } from '../lib/time'
import { tagsOf, type Tag } from '../tags/tags'
import { nextSort, type Sort, type SortBy } from './patientSort'

type Row = Schemas['PatientListControllerPatientRow']
type Doctor = Schemas['DoctorView']

/**
 * «Пациенты → Все»: строка списка. На телефоне и в узком окне — спокойная строка, как была (имя, под ним телефон, справа
 * дата); на широком экране (≥ 1100 px, calm.css) та же строка встаёт таблицей: ФИО, телефон, врач, «Долг / аванс»,
 * последний визит, следующая запись, метки. Одна разметка на оба вида — переключает CSS, без второго списка в DOM.
 */

const COLUMNS: { by?: SortBy; title: string; className: string; money?: boolean }[] = [
  { by: 'name', title: 'ФИО', className: 'pl-h-name' },
  { title: 'Телефон', className: 'pl-h-phone' },
  { title: 'Врач', className: 'pl-h-doctor' },
  { by: 'balance', title: 'Долг / аванс', className: 'pl-h-money', money: true },
  { by: 'last', title: 'Последний визит', className: 'pl-h-last' },
  { by: 'next', title: 'Следующая запись', className: 'pl-h-next' },
  { title: 'Метки', className: 'pl-h-tags' },
]

/** Шапка таблицы (только компьютер): у сортируемых колонок — кнопка со стрелкой направления. */
export function PatientTableHead({ sort, onSort, money }: { sort: Sort; onSort: (s: Sort) => void; money: boolean }) {
  return (
    <li className="pl-head" role="none">
      {COLUMNS.filter((c) => money || !c.money).map((c) => {
        if (!c.by) return <span key={c.title} className={`pl-h ${c.className}`}>{c.title}</span>
        const on = sort.by === c.by
        return (
          <span key={c.title} className={`pl-h ${c.className}`}>
            <button type="button" className="pl-sort" aria-pressed={on} onClick={() => onSort(nextSort(sort, c.by!))}
              aria-label={`Сортировать: ${c.title}${on ? (sort.desc ? ', по убыванию' : ', по возрастанию') : ''}`}>
              {c.title}<span className="pl-arrow" aria-hidden="true">{on ? (sort.desc ? '↓' : '↑') : '↕'}</span>
            </button>
          </span>
        )
      })}
    </li>
  )
}

/** «Каримова Динара» → «Каримова Д.» — колонка врача узкая. */
function shortDoctor(name = ''): string {
  const [last, first] = name.trim().split(/\s+/)
  return first ? `${last} ${first[0]}.` : last ?? ''
}

/** Был в этом году — «10 окт», раньше — «10 окт 2025». */
function pastDate(instant: string): string {
  const full = shortDate(instant)
  return full.endsWith(` ${todayIn().slice(0, 4)}`) ? full.slice(0, -5) : full
}

const som = (n: number) => new Intl.NumberFormat('ru-RU').format(n)

export function PatientTableRow({ p, open, active, money, doctors, colorDoctors, tags }: {
  p: Row
  open: () => void
  active: boolean
  /** Колонка «Долг / аванс» есть (сотруднику видны деньги пациентов) */
  money: boolean
  /** Все врачи клиники (и бывшие — у старых визитов), чтобы назвать врача */
  doctors: readonly Doctor[]
  /** По какому списку красить — как «Расписание» (colorDoctorsOf) */
  colorDoctors: readonly Doctor[]
  tags: Tag[] | undefined
}) {
  const doctor = p.doctorId != null ? doctors.find((d) => d.id === p.doctorId) : undefined
  const shownTags = tagsOf(p, tags)
  return (
    <li {...rowOpen(open, 'calm-row pl-row', active && 'active')}>
      <span className="calm-main">
        <span className="calm-title"><button type="button" className="row-link calm-name" onClick={open}>{p.fullName}</button></span>
        <span className="calm-sub">{p.phone ? <span className="num">{formatPhone(p.phone)}</span> : 'без телефона'}</span>
      </span>
      {/* Телефон: одна дата справа — следующая запись или когда был */}
      <span className="calm-meta pl-phone-meta">
        {p.nextVisit
          ? <span className="calm-meta-strong">записан {shortDate(p.nextVisit, true)}</span>
          : p.lastVisit ? `был ${shortDate(p.lastVisit)}` : 'ещё не был'}
      </span>
      <span className="pl-cell pl-doctor">
        {doctor && (
          <>
            <span className="avatar pl-avatar" style={{ background: colorOf(colorDoctors, doctor.id) }} aria-hidden="true">{initials(doctor.fullName)}</span>
            <span className="pl-ellipsis" title={doctor.fullName}>{shortDoctor(doctor.fullName)}</span>
          </>
        )}
      </span>
      {money && (
        <span className="pl-cell pl-money num">
          {(p.debtSom ?? 0) > 0 && <span className="pl-debt" title="Долг пациента">−{som(p.debtSom!)} сом</span>}
          {(p.advanceSom ?? 0) > 0 && <span className="pl-advance" title="Аванс пациента (семьи)">+{som(p.advanceSom!)} аванс</span>}
        </span>
      )}
      <span className="pl-cell pl-last">{p.lastVisit ? <>был {pastDate(p.lastVisit)}</> : <span className="pl-none">ещё не был</span>}</span>
      <span className="pl-cell pl-next">{p.nextVisit ? <span className="calm-meta-strong">{shortDate(p.nextVisit, true)}</span> : null}</span>
      <span className="pl-cell pl-tags">
        {shownTags.map((t) => <span key={t.id} className="tag-chip"><span className={`tag-dot tag-${t.color ?? 'gray'}`} aria-hidden="true" />{t.name}</span>)}
      </span>
    </li>
  )
}
