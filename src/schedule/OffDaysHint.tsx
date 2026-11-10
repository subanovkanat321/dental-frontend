import type { Schemas } from '../api/client'
import { firstName } from './doctorVisibility'

/**
 * «Выходной: Айгерим, Дастан · показать» — у этих врачей сегодня выходной и нет приёмов, поэтому
 * их колонок в «Все врачи» нет. Нажали «показать» — колонки на месте до смены дня (SchedulePage).
 */
export function OffDaysHint({ doctors, onShow }: { doctors: Schemas['DoctorView'][]; onShow: () => void }) {
  if (!doctors.length) return null
  const names = doctors.map((d) => firstName(d.fullName)).join(', ')
  return (
    <span className="off-days-hint" role="note">
      <span>Выходной: {names}</span>
      <span aria-hidden="true"> · </span>
      <button type="button" className="off-days-show" aria-label={`Показать колонки: ${names}`} onClick={onShow}>показать</button>
    </span>
  )
}
