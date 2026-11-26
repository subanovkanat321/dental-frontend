import { PLATFORM_LONG_PASSWORD } from './platformAccess'

/**
 * «Платформа» для владельца или менеджера платформы, вошедшего по паролю короче 12 символов (или через Google при
 * таком пароле): своя клиника работает, а все клиники — только с длинным паролем (ADR 0009 бэкенда). Сменил пароль в
 * «Мой профиль» — сервер сразу выдаёт новую cookie, после обновления страницы «Платформа» открыта без нового входа.
 */
export function PlatformPasswordHint({ onProfile }: { onProfile: () => void }) {
  return (
    <section className="card-block" aria-label="Платформа">
      <h2>Платформа</h2>
      <p className="notice tone-wait" role="status">{PLATFORM_LONG_PASSWORD}</p>
      <p className="hint">Через Telegram («Войти через Telegram» или приложение в боте) «Платформа» открывается как раньше.
        О каждом входе в «Платформу» по паролю бот пришлёт вам сообщение.</p>
      <div className="actions">
        <button type="button" className="btn primary" onClick={onProfile}>Открыть «Мой профиль»</button>
      </div>
    </section>
  )
}
