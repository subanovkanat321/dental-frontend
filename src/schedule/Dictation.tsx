import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { Select } from '../layout/Select'
import { haptic } from '../lib/telegram'
import { TOOTH_STATES, hasSurfaces, surfacesText, type Surface, type ToothState } from '../medical/toothStates'
import { Spinner } from '../layout/Loading'
import { CHEAT_STEPS } from './dictationCheat'

type Appointment = Schemas['AppointmentView']
type Proposal = Schemas['VisitDictationProposal']

/** Только то, что нужно нам от Web Speech API (в lib.dom его нет целиком, в Safari — с приставкой webkit). */
type Recognition = {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
}
type RecognitionClass = new () => Recognition

/** Распознавание речи браузера; нет (Firefox, часть Android WebView) — null: текст с клавиатуры. */
function speechRecognition(): RecognitionClass | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionClass; webkitSpeechRecognition?: RecognitionClass }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

/** Тишина: столько перезапусков подряд без единого слова или столько времени без речи — пауза. */
const MAX_QUIET_RESTARTS = 5
const MAX_QUIET_MS = 2 * 60_000

/** Часы для счётчика тишины (вне компонента: в обработчиках, не при отрисовке). */
function clock(): number {
  return Date.now()
}

type ToothRow = { on: boolean; tooth: string; state: ToothState; surfaces: Surface[]; note: string; was?: ToothState }
type StepRow = { on: boolean; tooth: string; title: string }
type Review = { teeth: ToothRow[]; plan: StepRow[]; note: string; next: string | null; ai: boolean; problem?: string }

function errorText(e: ApiError | null): string | null {
  return e ? Object.values(e.fieldErrors)[0] ?? e.message : null
}

function joinNote(before: string, added: string): string {
  const a = before.trim()
  const b = added.trim()
  if (!a) return b
  if (!b || a.includes(b)) return a
  return `${a}\n${b}`
}

function nextText(next: Proposal['next']): string | null {
  if (!next) return null
  if (next.text) return next.text
  return next.inDays ? `через ${next.inDays} дн.` : null
}

/**
 * «🎤 Надиктовать» у заметки о приёме: врач говорит — браузер переводит речь в текст (звук никуда
 * не уходит), ИИ на сервере раскладывает текст по карте зубов, плану и заметке, врач проверяет и
 * нажимает «Сохранить». Без нажатия ничего не пишется. Нет распознавания — поле для текста
 * (на телефоне есть микрофон на клавиатуре); нет ИИ — текст идёт в заметку как есть.
 * Права — как у заметки (врач приёма и админ): блок показывают, только когда заметка открылась.
 */
export function Dictation({ appointment: a, note, onActive }: {
  appointment: Appointment
  /** Заметка сейчас: к ней добавится надиктованное. */
  note: string
  onActive: (active: boolean) => void
}) {
  const client = useQueryClient()
  const [step, setStep] = useState<'idle' | 'speak' | 'review'>('idle')
  const [text, setText] = useState('')
  const [interim, setInterim] = useState('')
  const [listening, setListening] = useState(false)
  const [micProblem, setMicProblem] = useState('')
  const [review, setReview] = useState<Review | null>(null)
  const [saved, setSaved] = useState('')
  const recognition = useRef<Recognition | null>(null)
  const Speech = speechRecognition()
  const canSpeak = Speech != null && !micProblem

  // Врач хочет, чтобы запись шла (нажал «Надиктовать»/«Продолжить» и ещё не «Пауза»/«Готово»).
  // Браузер сам заканчивает распознавание после тишины (Safari, Chrome) — тогда тихо начинаем заново.
  const wanted = useRef(false)
  const textNow = useRef('')
  // Текст и в состоянии (экран), и в ref (обработчики распознавания читают самое свежее)
  const putText = (t: string) => {
    textNow.current = t
    setText(t)
  }
  const quiet = useRef({ restarts: 0, since: 0 })
  const [pauseNote, setPauseNote] = useState('')
  // «Готово» во время записи: ждём, пока браузер допишет последние слова (onend), и только тогда разбор
  const finishing = useRef(false)
  const finishTimer = useRef<number | undefined>(undefined)
  const [waitingEnd, setWaitingEnd] = useState(false)

  // Закрыли карточку во время записи — микрофон выключаем
  useEffect(() => () => {
    wanted.current = false
    finishing.current = false
    window.clearTimeout(finishTimer.current)
    recognition.current?.stop()
  }, [])

  const go = (next: 'idle' | 'speak' | 'review') => {
    setStep(next)
    onActive(next !== 'idle')
  }

  const begin = () => {
    if (!Speech) return false
    const r = new Speech()
    r.lang = 'ru-RU'
    r.continuous = true
    r.interimResults = true
    // Сказанное до этой записи (дописал руками, говорил в несколько заходов, браузер перезапускался)
    const before = textNow.current.trim()
    let draft = ''
    r.onresult = (e) => {
      if (recognition.current !== r) return
      let final = ''
      draft = ''
      for (let i = 0; i < e.results.length; i++) {
        const res = e.results[i]!
        if (res.isFinal) final += res[0].transcript
        else draft += res[0].transcript
      }
      if (final.trim() || draft.trim()) quiet.current = { restarts: 0, since: clock() }
      const next = [before, final.replace(/\s+/g, ' ').trim()].filter(Boolean).join(' ')
      putText(next)
      setInterim(draft)
    }
    r.onerror = (e) => {
      if (recognition.current !== r) return
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'audio-capture') {
        wanted.current = false
        setMicProblem('Нет доступа к микрофону — разрешите его в браузере или напишите текстом')
      } else if (e.error === 'network') {
        wanted.current = false
        setPauseNote('Нет связи с распознаванием речи — запись на паузе. Нажмите «🎤 Продолжить».')
      }
    }
    r.onend = () => {
      if (recognition.current !== r) return
      // Недоговорённое слово, которое браузер не успел дописать, не теряем
      if (draft.trim()) {
        const next = [textNow.current.trim(), draft.replace(/\s+/g, ' ').trim()].filter(Boolean).join(' ')
        putText(next)
      }
      draft = ''
      setInterim('')
      if (finishing.current) {
        finish()
        return
      }
      if (wanted.current) {
        const q = quiet.current
        if (q.restarts < MAX_QUIET_RESTARTS && clock() - q.since < MAX_QUIET_MS) {
          q.restarts++
          if (begin()) return
        } else {
          setPauseNote('Долго тихо — запись на паузе. Нажмите «🎤 Продолжить», когда будете готовы.')
        }
      }
      wanted.current = false
      setListening(false)
    }
    recognition.current = r
    try {
      r.start()
      return true
    } catch {
      recognition.current = null
      return false
    }
  }
  const listen = () => {
    setPauseNote('')
    quiet.current = { restarts: 0, since: clock() }
    wanted.current = true
    if (begin()) setListening(true)
    else wanted.current = false
  }
  const stop = () => {
    wanted.current = false
    recognition.current?.stop()
    setListening(false)
  }

  const start = () => {
    setSaved('')
    putText('')
    setReview(null)
    go('speak')
    if (canSpeak) listen()
  }

  const parse = useMutation<Proposal, ApiError>({
    mutationFn: () => unwrap(api.POST('/api/appointments/{id}/dictation/parse', { params: { path: { id: a.id } }, body: { text: textNow.current.trim() } })),
    onSuccess: (p) => {
      setReview({
        teeth: (p.teeth ?? []).map((t) => ({ on: true, tooth: String(t.tooth), state: t.state ?? 'HEALTHY', surfaces: t.surfaces ?? [], note: t.note ?? '', was: t.was })),
        plan: (p.plan ?? []).map((s) => ({ on: true, tooth: s.tooth != null ? String(s.tooth) : '', title: s.title ?? '' })),
        note: joinNote(note, p.note ?? ''),
        next: nextText(p.next),
        ai: true,
      })
      go('review')
    },
    onError: (e) => {
      // Нет ИИ (не подключён, выключен клиникой, не ответил) — текст как заметка, врач поправит
      if (e.status === 409) {
        setReview({ teeth: [], plan: [], note: joinNote(note, text), next: null, ai: false, problem: e.message })
        go('review')
      }
    },
  })
  // Разбор — только по «Готово»/«Разобрать» и ровно один раз
  const finish = () => {
    if (!finishing.current) return
    finishing.current = false
    window.clearTimeout(finishTimer.current)
    setWaitingEnd(false)
    setListening(false)
    if (textNow.current.trim()) parse.mutate()
  }
  const toParse = () => {
    if (finishing.current || parse.isPending) return
    finishing.current = true
    wanted.current = false
    const r = recognition.current
    if (listening && r) {
      setWaitingEnd(true)
      r.stop()
      // Браузер не прислал onend — не ждём вечно
      if (finishing.current) finishTimer.current = window.setTimeout(finish, 1500)
    } else {
      finish()
    }
  }

  const apply = useMutation<Schemas['VisitDictationApplied'], ApiError>({
    mutationFn: () => {
      const r = review!
      return unwrap(api.POST('/api/appointments/{id}/dictation/apply', {
        params: { path: { id: a.id } },
        body: {
          teeth: r.teeth.filter((t) => t.on).map((t) => ({
            tooth: Number(t.tooth), state: t.state, surfaces: hasSurfaces(t.state) ? t.surfaces : [], note: t.note.trim() || undefined,
          })),
          plan: r.plan.filter((s) => s.on).map((s) => ({ tooth: s.tooth.trim() ? Number(s.tooth) : undefined, title: s.title.trim() })),
          note: r.note.trim(),
        },
      }))
    },
    onSuccess: (done) => {
      haptic('success')
      const patientId = a.patient.id
      client.setQueryData(['note', a.id], { note: done.note })
      if (patientId != null) {
        client.setQueryData(['teeth', patientId], done.teeth)
        void client.invalidateQueries({ queryKey: ['plan', patientId] })
      }
      void client.invalidateQueries({ queryKey: ['notes'] })
      // Зубы из диктовки ложатся и за этим приёмом — «Зубы этого приёма» и история по визитам
      void client.invalidateQueries({ queryKey: ['visit-teeth', a.id] })
      void client.invalidateQueries({ queryKey: ['teeth-history'] })
      const r = review!
      const teeth = r.teeth.filter((t) => t.on).length
      const steps = r.plan.filter((s) => s.on).length
      setSaved(['Сохранено в медкарту', teeth ? `зубов: ${teeth}` : '', steps ? `шагов плана: ${steps}` : ''].filter(Boolean).join(' · '))
      setReview(null)
      putText('')
      go('idle')
    },
    onError: () => haptic('error'),
  })

  const setTooth = (i: number, change: Partial<ToothRow>) =>
    setReview((r) => r && { ...r, teeth: r.teeth.map((t, j) => (j === i ? { ...t, ...change } : t)) })
  const setStepRow = (i: number, change: Partial<StepRow>) =>
    setReview((r) => r && { ...r, plan: r.plan.map((s, j) => (j === i ? { ...s, ...change } : s)) })
  const cancel = () => {
    finishing.current = false
    window.clearTimeout(finishTimer.current)
    setWaitingEnd(false)
    stop()
    setReview(null)
    go('idle')
  }

  if (step === 'idle') {
    return (
      <div className="dictation">
        <button type="button" className="btn dictation-start" onClick={start}>🎤 Надиктовать приём</button>
        <p className="hint small">Скажите по шагам: зуб → что сделали → следующий визит. Шпаргалка будет на экране.</p>
        {saved && <p className="tone-ok small" role="status">{saved}</p>}
      </div>
    )
  }

  if (step === 'speak') {
    const busy = parse.isPending || waitingEnd
    const shown = listening && interim ? `${text} ${interim.trim()}`.trim() : text
    return (
      <section className="dictation" aria-label="Диктовка">
        <h3>Диктовка</h3>
        <CheatSheet text={shown} />
        {canSpeak ? (
          listening
            ? <p className="dictation-live" role="status">🔴 Слушаю… можно думать, запись не прервётся</p>
            : <p className="hint small">{pauseNote || 'Запись на паузе — можно поправить текст.'}</p>
        ) : (
          <p className="hint small">{micProblem || 'Браузер не распознаёт речь.'} Нажмите микрофон на клавиатуре и говорите по шпаргалке — текст появится в поле.</p>
        )}
        <textarea aria-label="Текст диктовки" rows={4} maxLength={5000} value={shown}
          readOnly={listening} placeholder={canSpeak ? 'Здесь появится сказанное' : 'Вставьте или напишите текст'} onChange={(e) => putText(e.target.value)} />
        <div className="actions">
          <button type="button" className="btn primary" disabled={(!text.trim() && !interim.trim()) || busy} onClick={toParse}>
            {busy ? <><Spinner />Разбираем…</> : listening ? 'Готово' : 'Разобрать'}</button>
          {canSpeak && (listening
            ? <button type="button" className="btn" disabled={busy} onClick={stop}>Пауза</button>
            : <button type="button" className="btn" disabled={busy} onClick={listen}>🎤 Продолжить</button>)}
          <button type="button" className="btn ghost" onClick={cancel}>Отмена</button>
        </div>
        <p className="hint small">Звук не сохраняется. Разбор — только по «{listening ? 'Готово' : 'Разобрать'}».</p>
        {parse.error && parse.error.status !== 409 && <p className="error" role="alert">{errorText(parse.error)}</p>}
      </section>
    )
  }

  const r = review!
  return (
    <section className="dictation" aria-label="Проверьте диктовку">
      <h3>Проверьте</h3>
      {r.ai ? <p className="hint small">Разобрал ИИ — снимите лишнее и поправьте. Ничего не сохранится без «Сохранить».</p>
        : <p className="tone-wait small" role="status">{r.problem} Текст добавлен в заметку.</p>}
      {r.teeth.length > 0 && (
        <fieldset className="dictation-group">
          <legend>Карта зубов</legend>
          {r.teeth.map((t, i) => (
            <div key={i} className="dictation-row">
              <label className="check"><input type="checkbox" checked={t.on} aria-label={`Зуб ${t.tooth}: применить`}
                onChange={(e) => setTooth(i, { on: e.target.checked })} /></label>
              <input className="num dictation-tooth" aria-label="Номер зуба" inputMode="numeric" maxLength={2} value={t.tooth}
                disabled={!t.on} onChange={(e) => setTooth(i, { tooth: e.target.value.replace(/\D/g, '') })} />
              <Select aria-label={`Состояние зуба ${t.tooth}`} value={t.state} disabled={!t.on}
                onChange={(e) => setTooth(i, { state: e.target.value as ToothState })}>
                {Object.entries(TOOTH_STATES).map(([k, [label, icon]]) => <option key={k} value={k}>{`${icon} ${label}`}</option>)}
              </Select>
              {/* Поверхности, которые назвал врач («36 МО пломба»): видно и можно убрать, если ИИ ошибся */}
              {hasSurfaces(t.state) && t.surfaces.length > 0 && (
                <button type="button" className="chip" disabled={!t.on} aria-label={`Убрать поверхности зуба ${t.tooth}: ${surfacesText(Number(t.tooth), t.surfaces)}`}
                  onClick={() => setTooth(i, { surfaces: [] })}>{surfacesText(Number(t.tooth), t.surfaces)} ✕</button>
              )}
              <input aria-label={`Пометка к зубу ${t.tooth}`} maxLength={500} value={t.note} placeholder="пометка" disabled={!t.on}
                onChange={(e) => setTooth(i, { note: e.target.value })} />
              {t.was && t.was !== 'HEALTHY' && t.was !== t.state && <span className="hint small">было: {TOOTH_STATES[t.was][0].toLowerCase()}</span>}
            </div>
          ))}
        </fieldset>
      )}
      {r.plan.length > 0 && (
        <fieldset className="dictation-group">
          <legend>План лечения</legend>
          {r.plan.map((s, i) => (
            <div key={i} className="dictation-row">
              <label className="check"><input type="checkbox" checked={s.on} aria-label={`В план: ${s.title}`}
                onChange={(e) => setStepRow(i, { on: e.target.checked })} /></label>
              <input className="num dictation-tooth" aria-label="Зуб в плане" inputMode="numeric" maxLength={2} value={s.tooth}
                placeholder="—" disabled={!s.on} onChange={(e) => setStepRow(i, { tooth: e.target.value.replace(/\D/g, '') })} />
              <input aria-label="Шаг плана" maxLength={200} value={s.title} disabled={!s.on}
                onChange={(e) => setStepRow(i, { title: e.target.value })} />
            </div>
          ))}
        </fieldset>
      )}
      <label className="field"><span>Заметка о приёме</span>
        <textarea aria-label="Заметка из диктовки" rows={4} maxLength={2000} value={r.note}
          onChange={(e) => setReview({ ...r, note: e.target.value })} />
      </label>
      {r.next && <p className="hint small">Следующий визит: {r.next} — запишите пациента, если нужно (сам не записывается).</p>}
      <div className="actions">
        <button type="button" className="btn primary" disabled={apply.isPending} onClick={() => apply.mutate()}>
          {apply.isPending ? <><Spinner />Сохраняем…</> : 'Сохранить'}</button>
        <button type="button" className="btn ghost" onClick={cancel}>Отмена</button>
      </div>
      {apply.error && <p className="error" role="alert">{errorText(apply.error)}</p>}
    </section>
  )
}

function CheatSheet({ text }: { text: string }) {
  return (
    <ol className="dictation-cheat" aria-label="Что сказать по порядку">
      {CHEAT_STEPS.map((s, i) => {
        const done = s.done?.(text) ?? false
        return (
          <li key={s.title} className={done ? 'done' : undefined}>
            <span className="dictation-cheat-n" aria-hidden="true">{done ? '✓' : i + 1}</span>
            <span><b>{s.title}{done && <span className="sr-only"> — сказано</span>}</b> {s.say}</span>
          </li>
        )
      })}
    </ol>
  )
}
