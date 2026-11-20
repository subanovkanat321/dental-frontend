import { useMutation } from '@tanstack/react-query'
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { Spinner } from '../layout/Loading'
import { CHEAT_STEPS } from './dictationCheat'
import { ProposalReview } from './ProposalReview'
import { reviewOf, type CurrentNote, type Review } from './review'

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


function errorText(e: ApiError | null): string | null {
  return e ? Object.values(e.fieldErrors)[0] ?? e.message : null
}


/**
 * «🎤 Надиктовать» у заметки о приёме: врач говорит — браузер переводит речь в текст (звук никуда
 * не уходит), ИИ на сервере раскладывает текст по карте зубов, плану и заметке, врач проверяет и
 * нажимает «Сохранить». Без нажатия ничего не пишется. Нет распознавания — поле для текста
 * (на телефоне есть микрофон на клавиатуре); нет ИИ — текст идёт в заметку как есть.
 * Права — как у заметки (врач приёма и админ): блок показывают, только когда заметка открылась.
 */
/** Кнопка «🎤 Надиктовать» — в строке подписи заметки (VisitNote): она зовёт start(). */
export type DictationHandle = { start: () => void }

export function Dictation({ appointment: a, current, onActive, ref }: {
  ref?: Ref<DictationHandle>
  appointment: Appointment
  /** Заметка сейчас: к ней (к её разделам) добавится надиктованное. */
  current: CurrentNote
  onActive: (active: boolean) => void
}) {
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
  useImperativeHandle(ref, () => ({ start }))

  const parse = useMutation<Proposal, ApiError>({
    mutationFn: () => unwrap(api.POST('/api/appointments/{id}/dictation/parse', { params: { path: { id: a.id } }, body: { text: textNow.current.trim() } })),
    onSuccess: (p) => {
      setReview(reviewOf(p, current, true))
      go('review')
    },
    onError: (e) => {
      // Нет ИИ (не подключён, выключен клиникой, не ответил) — текст как заметка, врач поправит
      if (e.status === 409) {
        setReview({ ...reviewOf({ note: text }, current, false), problem: e.message })
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

  const cancel = () => {
    finishing.current = false
    window.clearTimeout(finishTimer.current)
    setWaitingEnd(false)
    stop()
    setReview(null)
    go('idle')
  }

  if (step === 'idle') {
    // Кнопка «🎤 Надиктовать» — в строке подписи заметки; здесь только «Сохранено» после разбора
    return saved ? <p className="tone-ok small" role="status">{saved}</p> : null
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

  return (
    <ProposalReview appointment={a} initial={review!}
      onSaved={(done) => { setSaved(done); setReview(null); putText(''); go('idle') }} onCancel={cancel} />
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
