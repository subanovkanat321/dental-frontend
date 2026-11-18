import { useOnline } from '../lib/online'
import { Loading } from './Loading'
import { useUpdatingRecovery } from './useUpdatingRecovery'

/**
 * Плашка над рабочей областью (Shell и Mini App пациента), вид — как у напоминаний (AdminNotices):
 * - браузер без сети — «Нет интернета — проверьте связь» (красная, «!»); связь вернулась — пропадает,
 *   а запросы на паузе React Query повторит сам;
 * - сеть есть, а Tish не отвечает (обновляется) — спокойная «🔄 Tish обновляется — минутку…»; сервер
 *   ответил — пропадает, упавшие запросы перечитываются (useUpdatingRecovery).
 */
export function OfflineNotice({ text = 'Нет интернета — проверьте связь. Данные обновятся, когда связь вернётся.', updatingText = 'Tish обновляется — минутку…' }: {
  text?: string
  /** «Обновляется» на языке Mini App пациента. */
  updatingText?: string
}) {
  const online = useOnline()
  const updating = useUpdatingRecovery()
  if (!online) {
    return (
      <div className="notices offline-notice" role="status">
        <div className="notice tone-bad">
          <span className="notice-ico" aria-hidden="true">!</span>
          <span className="notice-text">{text}</span>
        </div>
      </div>
    )
  }
  if (!updating) return null
  return (
    <div className="notices offline-notice" role="status">
      <div className="notice tone-info">
        <span className="notice-ico" aria-hidden="true">🔄</span>
        <span className="notice-text">{updatingText}</span>
      </div>
    </div>
  )
}

/**
 * Экран на запуске, когда «кто вошёл» не дошёл, потому что Tish обновляется: не тупик «Нет связи с
 * сервером», а «подождите — продолжится само»; запрос повторяется сам, ответил — открывается приложение.
 */
export function UpdatingScreen() {
  useUpdatingRecovery()
  return (
    <div className="center updating-screen">
      <h1>Tish обновляется</h1>
      <p className="hint">Подождите минуту — всё продолжится само. Данные на месте.</p>
      <Loading delay={0} text="Ждём Tish…" />
    </div>
  )
}
