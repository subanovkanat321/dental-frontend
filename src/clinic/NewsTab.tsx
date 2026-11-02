import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { shortDate } from '../lib/time'
import { EmptyState } from '../layout/EmptyState'

/**
 * «Новости для пациентов»: видны всем пациентам в приложении; в бот приходят тем, кто подписался.
 * Рассылку не отменить — перед отправкой спрашиваем. Только админ.
 */
export function NewsTab() {
  const client = useQueryClient()
  const data = useQuery({ queryKey: ['news'], queryFn: () => unwrap(api.GET('/api/news')) })
  const [text, setText] = useState('')
  const publish = useMutation<Schemas['NewsServiceNews'], ApiError>({
    mutationFn: () => unwrap(api.POST('/api/news', { body: { text } })),
    onSuccess: () => {
      setText('')
      void client.invalidateQueries({ queryKey: ['news'] })
    },
  })
  const remove = useMutation<unknown, ApiError, number>({
    mutationFn: (id) => unwrap(api.DELETE('/api/news/{id}', { params: { path: { id } } })),
    onSuccess: () => client.invalidateQueries({ queryKey: ['news'] }),
  })
  const subscribers = data.data?.subscribers ?? 0
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (window.confirm(`Опубликовать и разослать ${subscribers} подписчикам? Отменить рассылку нельзя.`)) publish.mutate()
  }

  return (
    <>
      <section className="card-block">
        <h2>Новая новость</h2>
        <form className="form narrow" aria-label="Новая новость" onSubmit={submit}>
          <p className="hint">Видна всем пациентам в приложении. В бот придёт тем, кто сам подписался: сейчас {subscribers}.
            Не чаще раза в день — иначе пациенты отпишутся. Имён и личных данных пациентов в новости не пишите.</p>
          <label className="field"><span>Текст новости</span>
            <textarea rows={5} maxLength={1000} required value={text} placeholder="Например: в субботу принимаем с 10:00 до 15:00. Скидка 10% на чистку до конца месяца."
              onChange={(e) => { publish.reset(); setText(e.target.value) }} /></label>
          {publish.error && <p className="error" role="alert">{publish.error.fieldErrors.text ?? publish.error.message}</p>}
          {publish.isSuccess && <p className="tone-ok" role="status">Опубликовано · в бот — {publish.data.recipients ?? 0} подписчикам</p>}
          <button type="submit" className="btn primary" disabled={publish.isPending || !text.trim()}>Опубликовать и разослать</button>
        </form>
      </section>
      <section className="card-block">
        <h2>Опубликованные</h2>
        {data.error && <p className="error">{data.error.message}</p>}
        {data.isPending ? <p className="hint">Загрузка…</p> : data.data?.news?.length ? (
          <ul className="news-list">
            {data.data.news.map((n) => (
              <li key={n.id} className="news-item">
                <p className="hint">{n.createdAt ? shortDate(n.createdAt, true) : ''} · в бот: {n.delivered ?? 0} из {n.recipients ?? 0}</p>
                <p>{n.text}</p>
                <button type="button" className="btn small ghost" disabled={remove.isPending}
                  onClick={() => window.confirm('Убрать новость из приложения?') && remove.mutate(n.id!)}>Убрать из приложения</button>
              </li>
            ))}
          </ul>
        ) : <EmptyState compact icon="📰" title="Новостей пока нет." />}
        {remove.error && <p className="error" role="alert">{remove.error.message}</p>}
      </section>
    </>
  )
}
