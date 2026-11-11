import { useOnline } from '../lib/online'

/**
 * «Нет интернета — проверьте связь» над рабочей областью, пока браузер без сети (Shell и Mini App
 * пациента). Вид — как у напоминаний (AdminNotices): плашка с «!»; связь вернулась — пропадает сама,
 * а запросы на паузе React Query повторит сам.
 */
export function OfflineNotice({ text = 'Нет интернета — проверьте связь. Данные обновятся, когда связь вернётся.' }: { text?: string }) {
  const online = useOnline()
  if (online) return null
  return (
    <div className="notices offline-notice" role="status">
      <div className="notice tone-bad">
        <span className="notice-ico" aria-hidden="true">!</span>
        <span className="notice-text">{text}</span>
      </div>
    </div>
  )
}
