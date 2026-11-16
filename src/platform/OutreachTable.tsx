import { memo, useCallback, useState } from 'react'

import { SortTh } from '../layout/SortTh'
import { rowOpen } from '../lib/rowClick'
import { useSort } from '../lib/useSort'
import { formatPhone, shortDate } from '../lib/time'
import { groupOf, type Group, type OutreachLead } from './outreach'

const STAGE_TEXT: Record<string, string> = { DEMO: 'Ответили', TRIAL: 'Пробный период', PAYING: 'Платит' }

/** Статус клиники — тот же chip в списке и в таблице: Не писали / Написали дата / этап / Отказ. */
export function LeadStatus({ lead: l }: { lead: OutreachLead }) {
  const g = groupOf(l)
  return g === 'FRESH' ? <span className="chip small s-quiet">Не писали</span>
    : g === 'SENT' ? <span className="chip small s-ok">Написали{l.contactedAt ? ` ${shortDate(l.contactedAt)}` : ''}</span>
      : g === 'DECLINED' ? <span className="chip small s-bad">Отказ</span>
        : <span className="chip small s-request">{STAGE_TEXT[l.stage ?? ''] ?? 'Дальше'}</span>
}

/** Сколько строк таблицы показываем сразу; дальше — «Показать ещё» (сотни клиник из 2ГИС не тормозят). */
const PAGE = 100

type Key = 'n' | 'name' | 'phone' | 'address' | 'city' | 'status' | 'contacted' | 'reminded'

const GROUP_ORDER: Record<Group, number> = { FRESH: 0, SENT: 1, FURTHER: 2, DECLINED: 3 }

/**
 * Клиники «Рассылки» таблицей, как в Excel (несколько сотен строк из 2ГИС): шапка и колонки «№» и «Название»
 * прилипают внутри своего блока прокрутки, сортировка — по заголовку (SortTh, как в «Кассе»), по 100 строк и
 * «Показать ещё». Нажатие на строку открывает ту же карточку клиники справа, что и в списке.
 *
 * @param rows уже отфильтрованные (группа, поиск, город) — в порядке списка
 * @param numbers номер клиники в полном списке (как загружали) — не меняется от фильтра и сортировки
 * @param resetKey фильтр сменился — снова первые 100 строк
 */
export function OutreachTable({ rows, numbers, selected, onOpen, resetKey }: {
  rows: OutreachLead[]
  numbers: Map<number, number>
  selected: number | null
  onOpen: (id: number) => void
  resetKey: string
}) {
  const value = useCallback((l: OutreachLead, key: Key) => {
    switch (key) {
      case 'n': return numbers.get(l.id) ?? 0
      case 'name': return l.clinicName
      case 'phone': return l.phone
      case 'address': return l.address
      case 'city': return l.city
      case 'status': return GROUP_ORDER[groupOf(l)]
      case 'contacted': return l.contactedAt
      case 'reminded': return l.remindedAt
    }
  }, [numbers])
  const { sorted, sort, toggle } = useSort<OutreachLead, Key>(rows, value, { key: 'n', desc: false })
  const [limit, setLimit] = useState(PAGE)
  const [shownFor, setShownFor] = useState(resetKey)
  if (shownFor !== resetKey) {
    setShownFor(resetKey)
    setLimit(PAGE)
  }
  // Открыли клинику дальше первых строк («Следующая клиника») — показываем строки до неё
  const at = selected == null ? -1 : sorted.findIndex((l) => l.id === selected)
  const upTo = Math.max(limit, Math.ceil((at + 1) / PAGE) * PAGE)
  const visible = sorted.slice(0, upTo)
  const left = sorted.length - visible.length

  return (
    <>
      <div className="table-scroll sheet-scroll">
        <table className="table sheet" aria-label="Клиники таблицей">
          <thead>
            <tr>
              <SortTh k="n" title="№" sort={sort} onSort={toggle} right />
              <SortTh k="name" title="Название" sort={sort} onSort={toggle} />
              <SortTh k="phone" title="Телефон" sort={sort} onSort={toggle} />
              <SortTh k="address" title="Адрес" sort={sort} onSort={toggle} />
              <SortTh k="city" title="Город" sort={sort} onSort={toggle} />
              <SortTh k="status" title="Статус" sort={sort} onSort={toggle} />
              <SortTh k="contacted" title="Написали" sort={sort} onSort={toggle} desc />
              <SortTh k="reminded" title="Напомнили" sort={sort} onSort={toggle} desc />
              <th>Ссылка</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((l) => <Row key={l.id} lead={l} n={numbers.get(l.id) ?? 0} active={l.id === selected} onOpen={onOpen} />)}
          </tbody>
        </table>
      </div>
      {left > 0 && (
        <button type="button" className="btn audit-more" onClick={() => setLimit(upTo + PAGE)}>
          Показать ещё {Math.min(PAGE, left)} (осталось {left})</button>
      )}
    </>
  )
}

/** Строка — отдельный memo: отметили одну клинику — перерисовывается она, а не сотня строк. */
const Row = memo(function Row({ lead: l, n, active, onOpen }: { lead: OutreachLead; n: number; active: boolean; onOpen: (id: number) => void }) {
  const open = () => onOpen(l.id)
  return (
    <tr id={`outreach-${l.id}`} {...rowOpen(open, active && 'active')} aria-current={active || undefined}>
      <td className="r num sheet-n">{n}</td>
      <td className="sheet-name"><button type="button" className="row-link" onClick={open}>{l.clinicName}</button></td>
      <td className="num">{l.phone ? formatPhone(l.phone) : ''}</td>
      <td className="sheet-wrap" title={l.address ?? undefined}>{l.address}</td>
      <td>{l.city}</td>
      <td><LeadStatus lead={l} /></td>
      <td className="num">{l.contactedAt ? shortDate(l.contactedAt) : ''}</td>
      <td className="num">{l.remindedAt ? shortDate(l.remindedAt) : ''}</td>
      <td className="sheet-link">
        {l.link && (
          <a href={l.link} target="_blank" rel="noopener noreferrer" aria-label={`${linkName(l.link)}: ${l.clinicName}`} title={l.link}>
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 4h6v6" /><path d="M20 4l-9 9" /><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
            </svg>{' '}{linkName(l.link)}</a>
        )}
      </td>
    </tr>
  )
})

/** Подпись ссылки: 2ГИС, Instagram или просто «Ссылка». */
function linkName(link: string): string {
  return /2gis\./i.test(link) ? '2ГИС' : /instagram\./i.test(link) ? 'Instagram' : 'Ссылка'
}
