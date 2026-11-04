/**
 * Подтверждение в стиле приложения вместо системного `window.confirm` (в Telegram и на телефонах
 * системное окно выглядит чужим и пугает). Окно рисует `ConfirmHost` (layout/Confirm), один на App.
 *
 *   onClick={() => void ask('Удалить запись?').then((ok) => ok && remove.mutate())}
 *
 * Кнопка подтверждения — по первому слову вопроса («Удалить …?» → «Удалить»), опасные действия
 * (удалить, убрать, отменить, снять…) — красной.
 */
export type AskOptions = { ok?: string; danger?: boolean }

export type Pending = { text: string; ok: string; danger: boolean; resolve: (ok: boolean) => void }

let current: Pending | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

const DANGER = /^(удалить|убрать|отменить|снять|отклонить|остановить|закрыть|выйти|аварийн)/i

/** Кнопка по вопросу: «Удалить расход?» → «Удалить»; не глагол («Аварийный вход…») — «Да». */
function okLabel(text: string): string {
  const first = /^[«"]?([А-ЯЁа-яё]+)/.exec(text.trim())?.[1] ?? ''
  return /(ть|ти)$/i.test(first) ? first[0]!.toUpperCase() + first.slice(1).toLowerCase() : 'Да'
}

export function ask(text: string, options: AskOptions = {}): Promise<boolean> {
  // Окна нет (отдельная страница, тест одного компонента) — по-старому, системным
  if (!listeners.size) return Promise.resolve(window.confirm(text))
  current?.resolve(false)
  return new Promise((resolve) => {
    current = {
      text,
      ok: options.ok ?? okLabel(text),
      danger: options.danger ?? DANGER.test(text.trim()),
      resolve: (ok) => {
        current = null
        emit()
        resolve(ok)
      },
    }
    emit()
  })
}

export const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** Что спрашиваем сейчас (для ConfirmHost). */
export const pending = () => current
