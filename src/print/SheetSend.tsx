import { useMutation } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import type { ApiError } from '../api/client'
import { Sheet } from '../layout/Sheet'
import { haptic, openLink, telegram as inTelegram } from '../lib/telegram'
import { whatsappUrl } from '../lib/texts'
import { canPrint } from './paper'

/** «📷 Отправить листом» у документа: имя файла и, если есть, отправка картинки в бот (план — POST …/plan/send-image). */
export type SheetImage = {
  /** имя файла без имени пациента: «plan-lecheniya.png» */
  fileName: string
  /** отправить PNG в бот пациенту; нет — только «Поделиться» и «Скачать» */
  send?: (png: Blob) => Promise<unknown>
}

/** Можно ли поделиться файлом через системное окно «Поделиться» (телефон: WhatsApp, Telegram…). */
function canShareFile(file: File): boolean {
  try {
    return typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })
  } catch {
    return false
  }
}

type Ready = { file: File; url: string }

/** Браузер умеет положить картинку в буфер обмена (Safari, Chrome; в Telegram Mini App — не всегда). */
function canCopyImage(): boolean {
  return typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard?.write === 'function'
}

/**
 * «📷 Отправить листом»: тот же лист, что на печати, — картинкой PNG (рисует браузер, sheetImage.ts, грузится только сейчас).
 * Сначала рисуем, потом показываем картинку и куда её отправить — «Поделиться» браузер разрешает только сразу по нажатию,
 * поэтому картинка должна быть готова до него:
 * <ul>
 * <li>«В Telegram-бот» — пациент пишет боту: сервер отправит фото с подписью «План лечения — клиника» и сразу забудет;</li>
 * <li>«Поделиться» — телефон (и компьютер, где браузер умеет): системное окно, там WhatsApp и чат пациента. Ссылка wa.me
 * файл прикрепить не может — поэтому так;</li>
 * <li>«Скачать картинку» — где поделиться нельзя: файл в «Загрузки», а «Открыть чат WhatsApp» — прикрепить его там.
 * В Telegram (Mini App) скачать нельзя — там бот или «Поделиться», если есть.</li>
 * </ul>
 * PDF — «🖨 Печать» → «Сохранить как PDF», об этом подсказка.
 *
 * @param sheet лист печати на экране (article.print-sheet) — его и рисуем
 * @param telegram пациент пишет боту
 * @param phone телефон для «Открыть чат WhatsApp» (ссылку собирает браузер, на сервер не уходит)
 */
export function SheetSend({ label, image, sheet, telegram, phone, onClose }: {
  label: string
  image: SheetImage
  sheet: () => HTMLElement | null
  telegram: boolean
  phone?: string | null
  onClose: () => void
}) {
  const [ready, setReady] = useState<Ready | null>(null)
  const [failed, setFailed] = useState(false)
  const [done, setDone] = useState('')
  useEffect(() => {
    let alive = true
    let url = ''
    const el = sheet()
    import('./sheetImage')
      .then(({ sheetPng }) => {
        if (!el) throw new Error('Нет листа')
        return sheetPng(el)
      })
      .then((blob) => {
        if (!alive) return
        url = URL.createObjectURL(blob)
        setReady({ file: new File([blob], image.fileName, { type: 'image/png' }), url })
      })
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
      if (url) URL.revokeObjectURL(url)
    }
    // Рисуем один раз — при открытии окна: лист под ним не меняется, пока оно открыто
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const bot = useMutation<unknown, ApiError, File>({
    mutationFn: (file) => image.send!(file),
    onSuccess: () => {
      haptic('success')
      setDone('Отправлено в Telegram — пациенту пришло фото листа')
    },
    onError: () => haptic('error'),
  })
  const tma = Boolean(inTelegram())
  const share = ready != null && canShareFile(ready.file)
  const toBot = telegram && Boolean(image.send)
  const shareNow = async () => {
    if (!ready) return
    try {
      await navigator.share({ files: [ready.file], title: label })
      setDone('Готово — картинка отправлена')
    } catch (e) {
      // Закрыли окно «Поделиться» — не ошибка
      if (!(e instanceof DOMException && e.name === 'AbortError')) setFailed(true)
    }
  }
  // «WhatsApp пациенту» (2026-11-23, владелец: «приходится выбирать пациента — пусть сразу открывается нужный номер»):
  // ссылка wa.me файл не прикрепляет, а «Поделиться» номер не знает. Поэтому картинку — в буфер обмена, чат — сразу по
  // номеру пациента; в чате остаётся «Вставить». Буфер не дали (Telegram, старый браузер) — «Поделиться» как раньше
  const toWhatsapp = async () => {
    if (!ready || !phone) return
    try {
      // Запись в буфер — сразу по нажатию, чат — тоже сразу (после await браузер счёл бы окно всплывающим и не открыл)
      const copied = navigator.clipboard.write([new ClipboardItem({ 'image/png': ready.file })])
      openLink(whatsappUrl(phone, ''))
      await copied
      setDone('Картинка скопирована, чат пациента открыт — нажмите на поле сообщения и «Вставить», затем отправьте')
    } catch {
      if (share) void shareNow()
      else setDone('Не получилось скопировать картинку — «Поделиться» или «Скачать» и прикрепите её в чате')
    }
  }
  const download = () => {
    if (!ready) return
    const a = document.createElement('a')
    a.href = ready.url
    a.download = image.fileName
    document.body.appendChild(a)
    a.click()
    a.remove()
    setDone('Картинка скачана — прикрепите её в WhatsApp пациенту (📎 → файл из «Загрузок»)')
  }
  return (
    <Sheet label={`Отправить листом: ${label}`} title="Отправить листом" onClose={onClose}>
      <div className="sheet-send">
        {failed && !ready && <p className="error small" role="alert">Не получилось нарисовать лист — отправьте текстом или распечатайте.</p>}
        {!failed && !ready && <p className="hint small" role="status"><span className="spinner" aria-hidden="true" /> Готовим картинку листа…</p>}
        {ready && (
          <>
            <img className="sheet-send-preview" src={ready.url} alt={`Лист картинкой: ${label}`} />
            <div className="actions">
              {phone && canCopyImage() && (
                <button type="button" className="btn primary" onClick={() => void toWhatsapp()}>WhatsApp пациенту</button>
              )}
              {toBot && (
                <button type="button" className={phone && canCopyImage() ? 'btn' : 'btn primary'} disabled={bot.isPending} onClick={() => { setDone(''); bot.mutate(ready.file) }}>
                  В Telegram-бот
                </button>
              )}
              {share && (
                <button type="button" className={toBot || (phone && canCopyImage()) ? 'btn' : 'btn primary'} onClick={() => void shareNow()}>Поделиться — WhatsApp и др.</button>
              )}
              {!tma && (
                <button type="button" className={toBot || share ? 'btn' : 'btn primary'} onClick={download}>⬇ Скачать картинку</button>
              )}
              {!tma && phone && !canCopyImage() && (
                <button type="button" className="btn ghost" onClick={() => openLink(whatsappUrl(phone, ''))}>Открыть чат WhatsApp</button>
              )}
            </div>
            {done && <p className="tone-ok small" role="status">{done}</p>}
            {bot.error && <p className="error small" role="alert">{bot.error.message}</p>}
            <p className="hint small">
              {phone && canCopyImage() ? '«WhatsApp пациенту» откроет его чат — там «Вставить» и отправить. ' : share ? '«Поделиться» → WhatsApp → чат пациента. ' : ''}
              {!share && !tma ? 'В WhatsApp ссылкой картинку не прикрепить: скачайте её и прикрепите в чате пациента. ' : ''}
              {tma && !share ? 'В WhatsApp картинкой — из Tish в браузере телефона или на компьютере. ' : ''}
              {canPrint() ? 'Нужен PDF — «🖨 Печать» → «Сохранить как PDF».' : ''}
            </p>
          </>
        )}
      </div>
    </Sheet>
  )
}
