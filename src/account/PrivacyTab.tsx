import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { usePlatformInfo } from '../api/platform'
import { shortDate } from '../lib/time'
import { DeveloperContacts } from './Contacts'

type Me = Schemas['BookingViewsMe']

/**
 * «Конфиденциальность» для сотрудников: где и как хранятся данные, кто что видит, за что отвечает
 * клиника. Только правда о том, как устроено сейчас; сервер и контакты — из «Сведений о платформе».
 * Админу — доступ поддержки и журнал входов платформы в клинику.
 */
export function PrivacyTab({ me }: { me: Me }) {
  const info = usePlatformInfo().data ?? {}
  const access = useQuery({
    queryKey: ['platform-access'],
    queryFn: () => unwrap(api.GET('/api/clinic/platform-access')),
    enabled: Boolean(me.admin && info.accessLog),
  })
  const support = useQuery({
    queryKey: ['support-access'],
    queryFn: () => unwrap(api.GET('/api/clinic/support-access')),
    enabled: Boolean(me.admin),
  })
  const owner = 'Заходит в клинику только по её просьбе или чтобы устранить сбой'
    + (info.accessLog ? '. Каждый вход записывается' : '') + (info.accessNotify ? ', руководителям клиники сразу приходит сообщение' : '')
    + (info.accessRequiresGrant ? '. Входит, только когда вы открыли «Доступ поддержки», — иначе только аварийно, и вы об этом узнаете' : '')

  return (
    <>
      <section className="card-block privacy">
        <h2>Хранение данных</h2>
        <dl className="facts">
          <dt>Где хранятся</dt><dd>На сервере платформы, не в телефоне: у всех сотрудников одно и то же, потеряли телефон — данные на месте</dd>
          <dt>Сервер</dt><dd>{info.hosting || 'уточняется'}</dd>
          <dt>Шифрование</dt><dd>HTTPS (TLS) между устройством и сервером; вход — по подписи Telegram, без паролей</dd>
          <dt>Резервные копии</dt><dd>Каждую ночь; копия вне сервера зашифрована (AES-256)</dd>
        </dl>
      </section>
      <section className="card-block privacy">
        <h2>Кто что видит</h2>
        <dl className="facts">
          <dt>Только ваша клиника</dt><dd>Данные клиники видят её сотрудники — другие клиники их не видят</dd>
          <dt>Медицинские записи</dt><dd>Анкету, заметки, карту зубов и снимки видят врач, который лечил пациента, и руководитель. Регистратура — нет</dd>
          <dt>Менеджеры платформы</dt><dd>Только цифры клиники — сколько врачей и приёмов, без пациентов</dd>
          <dt>Владелец платформы</dt><dd>{owner}</dd>
          <dt>Уведомления и реклама</dt><dd>В уведомлениях сотрудникам нет имён и телефонов пациентов. Данные не продаются и не идут на рекламу</dd>
        </dl>
      </section>
      {support.data?.required && <SupportAccess until={support.data.grantedUntil} />}
      {access.data && (
        <section className="card-block">
          <h2>Входы и выгрузки платформы</h2>
          {access.data.length ? (
            <table className="table" aria-label="Входы платформы">
              <tbody>{access.data.map((x, i) => (
                <tr key={i}><td>{x.role === 'ADMIN' ? 'вошёл как руководитель' : x.role === 'EXPORT' ? 'выгрузил данные' : 'вошёл как регистратор'}</td><td className="hint">{x.enteredAt ? shortDate(x.enteredAt, true) : ''}</td></tr>
              ))}</tbody>
            </table>
          ) : <p className="hint">Владелец платформы в вашу клинику не входил.</p>}
        </section>
      )}
      <section className="card-block privacy">
        <h2>Правовая информация</h2>
        <dl className="facts">
          <dt>Не медицинская рекомендация</dt><dd>Приложение — инструмент записи, расписания и учёта. Оно не ставит диагнозов и не назначает лечение: решения принимает врач.</dd>
          <dt>Ответственность клиники</dt><dd>Клиника — держатель данных своих пациентов: получает их согласие (при самозаписи приложение сохраняет время согласия) и отвечает за правильность внесённого. Уволенного сотрудника руководитель убирает сразу в «Настройки → Персонал».</dd>
          <dt>Выгрузка и удаление</dt><dd>Выгрузку — «Настройки → Данные». Удаление клиники руководитель заказывает у разработчиков. После удаления данные остаются только в резервных копиях, пока те не сменятся (локальные — 14 дней).</dd>
        </dl>
      </section>
      <section className="card-block">
        <h2>Разработчики</h2>
        {info.legalName && <p className="strong">{info.legalName}</p>}
        <DeveloperContacts />
      </section>
    </>
  )
}

/** «Доступ поддержки»: открыть на 24 часа (написали «не работает») или закрыть раньше. */
function SupportAccess({ until }: { until?: string }) {
  const client = useQueryClient()
  const onSaved = () => client.invalidateQueries({ queryKey: ['support-access'] })
  const open = useMutation<Schemas['PlatformControllerSupportAccess'], ApiError>({
    mutationFn: () => unwrap(api.POST('/api/clinic/support-access', { body: { hours: 24 } })),
    onSuccess: () => void onSaved(),
  })
  const shut = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.DELETE('/api/clinic/support-access')),
    onSuccess: () => void onSaved(),
  })
  const error = open.error ?? shut.error
  return (
    <section className="card-block">
      <h2>Доступ поддержки</h2>
      <p>{until ? `Доступ открыт до ${shortDate(until, true)} — поддержка может войти в клинику.`
        : 'Доступ закрыт: поддержка входит в клинику только аварийно, и вы об этом узнаете.'}</p>
      {error && <p className="error" role="alert">{error.message}</p>}
      {until
        ? <button type="button" className="btn" disabled={shut.isPending} onClick={() => shut.mutate()}>Закрыть доступ</button>
        : <button type="button" className="btn primary" disabled={open.isPending} onClick={() => open.mutate()}>Открыть доступ поддержке на 24 часа</button>}
    </section>
  )
}
