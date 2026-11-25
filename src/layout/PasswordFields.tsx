import { useState } from 'react'

import { checkPassword, PASSWORD_MIN } from '../lib/password'

/** Поле пароля; показать/скрыть — у формы одна кнопка на все поля. */
export function PasswordInput({ label, value, onChange, shown, autoComplete, autoFocus }: {
  label: string; value: string; onChange: (v: string) => void; shown: boolean
  autoComplete: 'current-password' | 'new-password'; autoFocus?: boolean
}) {
  return (
    <label className="field"><span>{label}</span>
      <input type={shown ? 'text' : 'password'} value={value} autoComplete={autoComplete} autoFocus={autoFocus}
        autoCapitalize="off" spellCheck={false} maxLength={128} onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}

/** «Показать пароль» / «Скрыть пароль». */
export function ShowPassword({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
  return (
    <button type="button" className="link" aria-pressed={shown} onClick={onToggle}>
      {shown ? 'Скрыть пароль' : 'Показать пароль'}</button>
  )
}

/**
 * «Придумайте пароль»: два поля, показать/скрыть и требования, которые отмечаются по мере ввода.
 * Пароль живёт только в состоянии формы — не в адресе, не в localStorage и не в консоли.
 */
export function NewPasswordFields({ password, repeat, onPassword, onRepeat, phone, login = '', label = 'Новый пароль' }: {
  password: string; repeat: string; onPassword: (v: string) => void; onRepeat: (v: string) => void; phone: string
  /** Логин (если есть) — пароль не должен его повторять */
  login?: string
  label?: string
}) {
  const [shown, setShown] = useState(false)
  const c = checkPassword(password, phone, login)
  // Цифры и заглавные не обязательны (2026-11-25): только длина и «не номер / не логин / не 1234567»
  const rules: [boolean, string][] = [
    [c.long, `Не короче ${PASSWORD_MIN} символов`],
    [(c.notPhone && c.notLogin && c.notSimple) || !password, login.trim() ? 'Не номер, не логин и не «1234567»' : 'Не номер телефона и не «1234567»'],
    [password !== '' && password === repeat, 'Пароли совпадают'],
  ]
  return (
    <>
      <PasswordInput label={label} value={password} onChange={onPassword} shown={shown} autoComplete="new-password" autoFocus />
      <PasswordInput label="Повторите пароль" value={repeat} onChange={onRepeat} shown={shown} autoComplete="new-password" />
      <ShowPassword shown={shown} onToggle={() => setShown(!shown)} />
      <ul className="password-rules" aria-label="Требования к паролю">
        {rules.map(([ok, text]) => (
          <li key={text} className={ok ? 'tone-ok' : 'hint'}><span aria-hidden="true">{ok ? '✓' : '·'}</span> {text}</li>
        ))}
      </ul>
    </>
  )
}
