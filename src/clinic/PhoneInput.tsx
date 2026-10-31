import { isFullPhone } from './phone'

/**
 * Телефон с «+996» перед полем — как в приложении: местный номер «555 123 456» дополняется кодом
 * страны, полный («+7…», «996…», «0555…») отправляется как есть. Проверяет и нормализует сервер.
 */
export function PhoneInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className={isFullPhone(value) ? 'phone full' : 'phone'}>
      {!isFullPhone(value) && <span>+996</span>}
      <input aria-label={label} type="tel" inputMode="tel" autoComplete="off" maxLength={20} placeholder="555 123 456"
        value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}

