import { useQr } from '../lib/qr'
import { QrSvg } from '../lib/QrSvg'
import { Spinner } from './Loading'

/**
 * QR-код ссылки в бота (та же t.me/…?start=…, что у кнопки) — для компьютера без Telegram: телефоном навели камеру,
 * в боте «Подтвердить вход», а компьютер, который опрашивает статус по своей cookie, входит сам.
 * <p>
 * Сам код — {@link QrSvg} (uqr грузится лениво), рамка вокруг — по теме.
 *
 * @param link ссылка в бота; null — ещё берём (busy) или кода нет (истёк, отменён) — тогда «Обновить код»
 * @param caption подпись под кодом — что делать телефоном
 */
export function LoginQr({ link, busy = false, onRefresh, caption }: {
  link: string | null; busy?: boolean; onRefresh: () => void; caption: React.ReactNode
}) {
  const code = useQr(link)
  const failed = code === 'error'
  const ready = link && code !== 'error' ? code : null
  return (
    <div className="login-qr">
      <div className="login-qr-plate">
        {ready ? (
          <QrSvg qr={ready} label="QR-код входа: откройте камерой телефона" />
        ) : (
          <div className="login-qr-empty">
            {link || busy ? (failed ? <span>Код не открылся</span> : <Spinner />) : <span>Код устарел</span>}
          </div>
        )}
      </div>
      <p className="hint small">{caption}</p>
      <button type="button" className="link" disabled={busy} onClick={onRefresh}>
        {busy ? 'Обновляем…' : 'Обновить код'}</button>
    </div>
  )
}
