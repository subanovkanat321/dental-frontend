import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, unwrap } from '../api/client'
import { useClose } from '../lib/useClose'
import { monthsText, priceText } from './services'
import { Loading, Spinner } from '../layout/Loading'

/**
 * Что предложит «Стартовая настройка»: памятки и материалы услугам, а админу — ещё недостающее из
 * стандартного набора Tish (услуги, памятки, анкета, «откуда узнали»). Кэш общий на плашку и панель.
 */
function useStarter(admin: boolean, stock = true) {
  const memos = useQuery({ queryKey: ['starter', 'memos'], queryFn: () => unwrap(api.GET('/api/care-memos/starter')) })
  const supplies = useQuery({
    queryKey: ['starter', 'supplies', stock],
    queryFn: () => unwrap(api.GET('/api/supplies/starter', { params: { query: { stock } } })),
  })
  // Стандартный набор видит и добавляет только админ: в нём «откуда узнали» и услуги для пациентов
  const kit = useQuery({
    queryKey: ['starter', 'kit'], enabled: admin,
    queryFn: () => unwrap(api.GET('/api/clinic/starter')),
  })
  return { memos, supplies, kit }
}

/**
 * Плашка над списком услуг: есть что заполнить по умолчанию — памятки услугам, стандартные
 * материалы на склад и «что обычно уходит». Нечего — плашки нет.
 */
export function StarterCard({ admin, onOpen }: { admin: boolean; onOpen: () => void }) {
  const { memos, supplies, kit } = useStarter(admin)
  const memoCount = memos.data?.length ?? 0
  const serviceCount = supplies.data?.services?.length ?? 0
  const missing = supplies.data?.missing?.length ?? 0
  const kitServices = kit.data?.services?.length ?? 0
  const kitOther = (kit.data?.memos?.length ?? 0) + (kit.data?.questions?.length ?? 0) + (kit.data?.sources?.length ?? 0)
  if (!memoCount && !serviceCount && !kitServices && !kitOther) return null
  const parts = [
    kitServices ? `типовые услуги (${kitServices})` : '',
    kitOther ? `памятки, вопросы анкеты и «откуда узнали» (${kitOther})` : '',
    memoCount ? `памятки (услуг: ${memoCount})` : '',
    serviceCount ? `что обычно уходит (услуг: ${serviceCount})` : '',
    missing ? `стандартные материалы на склад (${missing})` : '',
  ].filter(Boolean)
  return (
    <section className="card-block starter-card" aria-label="Стартовая настройка">
      <div>
        <h2>Заполнить по умолчанию</h2>
        <p className="hint">Можно сразу добавить: {parts.join(', ')}. Только недостающее — что вы уже настроили, не меняется.</p>
      </div>
      <button type="button" className="btn primary" onClick={onOpen}>Посмотреть и заполнить</button>
    </section>
  )
}

/** Панель «Стартовая настройка»: что именно поставим, галочки, «Заполнить». */
export function StarterPanel({ admin, onClose }: { admin: boolean; onClose: () => void }) {
  useClose(onClose)
  const client = useQueryClient()
  const [withMemos, setWithMemos] = useState(true)
  const [withSupplies, setWithSupplies] = useState(true)
  const [withStock, setWithStock] = useState(true)
  // Услуги набора, которые админ снял; остальные добавим
  const [skipped, setSkipped] = useState<string[]>([])
  const [withKitMemos, setWithKitMemos] = useState(true)
  const [withQuestions, setWithQuestions] = useState(true)
  const [withSources, setWithSources] = useState(true)
  const { memos, supplies, kit } = useStarter(admin, withStock)
  const [done, setDone] = useState('')
  const kitServices = kit.data?.services ?? []
  const kitMemos = kit.data?.memos ?? []
  const questions = kit.data?.questions ?? []
  const sources = kit.data?.sources ?? []
  const pickedServices = kitServices.filter((s) => !skipped.includes(s.name!)).map((s) => s.name!)
  const kitChosen = pickedServices.length > 0 || (withKitMemos && kitMemos.length > 0)
    || (withQuestions && questions.length > 0) || (withSources && sources.length > 0)
  const apply = useMutation<string, ApiError>({
    mutationFn: async () => {
      const parts: string[] = []
      // Сначала услуги: новым сервер сам поставит памятку и материалы, а потом — пустым остальным
      if (kitChosen) {
        const r = await unwrap(api.POST('/api/clinic/starter', {
          body: { services: pickedServices, memos: withKitMemos, questions: withQuestions, sources: withSources },
        }))
        if (r.services) parts.push(`услуг добавлено: ${r.services}`)
        if (r.memos) parts.push(`памяток: ${r.memos}`)
        if (r.questions) parts.push(`вопросов анкеты: ${r.questions}`)
        if (r.sources) parts.push(`вариантов «откуда узнали»: ${r.sources}`)
      }
      if (withMemos && memos.data?.length) {
        const r = await unwrap(api.POST('/api/care-memos/starter'))
        parts.push(`памятки поставлены (услуг: ${r.services ?? 0})`)
      }
      if (withSupplies && (supplies.data?.services?.length || supplies.data?.missing?.length)) {
        const r = await unwrap(api.POST('/api/supplies/starter', { body: { stock: withStock } }))
        if (r.created) parts.push(`новых материалов на складе: ${r.created}`)
        parts.push(`«что обычно уходит» задано (услуг: ${r.services ?? 0})`)
      }
      return parts.join(', ')
    },
    onSuccess: (text) => {
      setDone(text ? `Готово: ${text}.` : 'Готово.')
      for (const key of ['starter', 'care-memos', 'care-memo-links', 'supplies', 'service-supplies', 'appointment-supplies-suggested',
        'service-types', 'service-catalog', 'me', 'anamnesis-questions', 'patient-sources', 'recall']) {
        void client.invalidateQueries({ queryKey: [key] })
      }
    },
  })
  const memoList = memos.data ?? []
  const missing = supplies.data?.missing ?? []
  const services = supplies.data?.services ?? []
  const kitEmpty = !kitServices.length && !kitMemos.length && !questions.length && !sources.length
  const nothing = !memoList.length && !services.length && !missing.length && kitEmpty
  const loaded = memos.isSuccess && supplies.isSuccess && (!admin || kit.isSuccess)

  return (
    <aside className="panel" aria-label="Заполнить по умолчанию">
      <header className="panel-head">
        <div>
          <h2>Заполнить по умолчанию</h2>
          <span className="hint">Добавляем только недостающее и ставим туда, где пусто: ваши цены, тексты и порядок не меняются,
            ничего не удаляется. Всё можно поправить потом.</span>
        </div>
        <button type="button" className="btn ghost" aria-label="Закрыть" onClick={onClose}>✕</button>
      </header>
      {(memos.isPending || supplies.isPending || (admin && kit.isPending)) && <Loading />}
      {(memos.error || supplies.error || kit.error) && <p className="error">{(memos.error ?? supplies.error ?? kit.error)!.message}</p>}
      {done && <p className="tone-ok" role="status">{done}</p>}
      {done && nothing && <div className="actions"><button type="button" className="btn" onClick={onClose}>Закрыть</button></div>}
      {!done && nothing && loaded && <p className="hint">Всё уже настроено — заполнять нечего.</p>}

      {kitServices.length > 0 && (
        <section className="starter-block" aria-label="Типовые услуги">
          <strong>Типовые услуги · {pickedServices.length} из {kitServices.length}</strong>
          <p className="hint">Стандартный набор Tish: длительность, цена «от» по Бишкеку и «Профосмотр через». Пациенты увидят
            их в записи — снимите лишние, цены проверьте потом.</p>
          <ul className="starter-list starter-checks">
            {kitServices.map((s) => (
              <li key={s.name}>
                <label className="check">
                  <input type="checkbox" checked={!skipped.includes(s.name!)}
                    onChange={(e) => setSkipped((x) => (e.target.checked ? x.filter((n) => n !== s.name) : [...x, s.name!]))} />
                  <span>{s.name} <span className="hint">· {s.category} · {s.durationMinutes} мин
                    {priceText(s.priceSom) ? ` · ${priceText(s.priceSom)}` : ' · без цены'}
                    {s.recallMonths ? ` · профосмотр через ${monthsText(s.recallMonths)}` : ''}</span></span>
                </label>
              </li>
            ))}
          </ul>
        </section>
      )}

      {kitMemos.length > 0 && (
        <section className="starter-block" aria-label="Стандартные памятки">
          <label className="check"><input type="checkbox" checked={withKitMemos} onChange={(e) => setWithKitMemos(e.target.checked)} />
            <strong>Новые памятки после процедур</strong> · {kitMemos.length}</label>
          <p className="hint">Общие рекомендации; станут у услуг без памятки. Ваши памятки не меняются.</p>
          <ul className="starter-list">{kitMemos.map((t) => <li key={t}>{t}</li>)}</ul>
        </section>
      )}

      {questions.length > 0 && (
        <section className="starter-block" aria-label="Вопросы анкеты">
          <label className="check"><input type="checkbox" checked={withQuestions} onChange={(e) => setWithQuestions(e.target.checked)} />
            <strong>Вопросы анкеты пациента</strong> · {questions.length}</label>
          <p className="hint">В конец своего раздела анкеты.</p>
          <ul className="starter-list">{questions.map((t) => <li key={t}>{t}</li>)}</ul>
        </section>
      )}

      {sources.length > 0 && (
        <section className="starter-block" aria-label="Откуда узнали">
          <label className="check"><input type="checkbox" checked={withSources} onChange={(e) => setWithSources(e.target.checked)} />
            <strong>Варианты «Откуда узнали о клинике»</strong> · {sources.length}</label>
          <ul className="starter-list">{sources.map((t) => <li key={t}>{t}</li>)}</ul>
        </section>
      )}

      {memoList.length > 0 && (
        <section className="starter-block" aria-label="Памятки">
          <label className="check"><input type="checkbox" checked={withMemos} onChange={(e) => setWithMemos(e.target.checked)} />
            <strong>📋 Памятки после процедуры</strong> · услуг: {memoList.length}</label>
          <p className="hint">После приёма их можно распечатать или отправить пациенту в бот.</p>
          <ul className="starter-list">
            {memoList.map((m) => <li key={m.serviceId}>{m.service} <span className="hint">→ {m.memo}</span></li>)}
          </ul>
        </section>
      )}

      {(services.length > 0 || missing.length > 0) && (
        <section className="starter-block" aria-label="Материалы">
          <label className="check"><input type="checkbox" checked={withSupplies} onChange={(e) => setWithSupplies(e.target.checked)} />
            <strong>🦷 Что обычно уходит</strong> · услуг: {services.length}</label>
          <p className="hint">В карточке приёма врач увидит готовый список и спишет его со склада одной кнопкой — сам, после проверки.
            Само ничего не списывается.</p>
          {withSupplies && (
            <label className="check"><input type="checkbox" checked={withStock} onChange={(e) => setWithStock(e.target.checked)} />
              Завести недостающие стандартные материалы на склад{missing.length ? ` (${missing.length})` : ''} — с остатком 0,
              впишете, когда придут</label>
          )}
          {withSupplies && withStock && missing.length > 0 && (
            <p className="hint">Новые: {missing.map((m) => `${m.name} (${m.unit})`).join(', ')}.</p>
          )}
          {withSupplies && (
            <ul className="starter-list">
              {services.map((s) => (
                <li key={s.id}>{s.name}
                  <span className="hint"> → {(s.items ?? []).map((i) => `${i.name} ${i.quantity} ${i.unit}`).join(', ')}</span></li>
              ))}
            </ul>
          )}
        </section>
      )}

      {apply.error && <p className="error" role="alert">{apply.error.message}</p>}
      {!nothing && (
        <div className="actions">
          <button type="button" className="btn primary" disabled={apply.isPending || (!withMemos && !withSupplies && !kitChosen)}
            onClick={() => apply.mutate()}>{apply.isPending ? <><Spinner />Заполняем…</> : 'Заполнить'}</button>
          <button type="button" className="btn ghost" onClick={onClose}>Закрыть</button>
        </div>
      )}
    </aside>
  )
}
