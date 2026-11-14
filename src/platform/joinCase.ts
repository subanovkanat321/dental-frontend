/** Кейс на /join (SettingsTab): что ещё нужно, чтобы блок появился на сайте. */

/** Чего не хватает, чтобы кейс появился на сайте; пусто — всё есть. */
export function caseMissing(c: { title: string; text: string; consent: boolean }): string[] {
  return [!c.title.trim() && 'заголовок', !c.text.trim() && 'история', !c.consent && 'отметка «клиника согласна на публикацию»'].filter(Boolean) as string[]
}
