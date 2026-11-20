import { PAINTS, usePaint } from './paint'

/**
 * «Красить запись: Статус | Врач | Услуга» — выбор на этом устройстве (schedule/paint.ts). compact — строкой под
 * сеткой «Дня» рядом с расшифровкой значков (компьютер); без compact — в «Настройки → Оформление» (и телефон).
 */
export function PaintSwitch({ compact = false }: { compact?: boolean }) {
  const [paint, setPaint] = usePaint()
  return (
    <div className={compact ? 'paint-switch compact' : 'paint-switch'}>
      {compact && <span className="paint-switch-label hint">Красить запись:</span>}
      <div className="segments" role="group" aria-label="Чем красить запись">
        {PAINTS.map(([code, label]) => (
          <button key={code} type="button" aria-pressed={paint === code} onClick={() => setPaint(code)}>{label}</button>
        ))}
      </div>
    </div>
  )
}
