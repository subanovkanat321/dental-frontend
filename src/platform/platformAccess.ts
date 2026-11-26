import type { Schemas } from '../api/client'

type Me = Schemas['BookingViewsMe']

/** Тот же текст, что отвечает сервер на /api/platform/* (PasswordRules.PLATFORM_TOO_SHORT бэкенда). */
export const PLATFORM_LONG_PASSWORD = 'Для «Платформы» по паролю нужен пароль от 12 символов — смените его в «Мой профиль» → «Логин и пароль»'

/**
 * Показать пункт «Платформа»: она открыта или закрыта только из-за короткого пароля (ADR 0009 бэкенда) — тогда внутри
 * подсказка {@link PLATFORM_LONG_PASSWORD}.
 */
export function showsPlatform(me: Me): boolean {
  return me.platform || me.platformPasswordShort
}
