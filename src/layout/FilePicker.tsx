import { useEffect, useRef } from 'react'

/**
 * Выбор файла своей кнопкой «📎 …» и именем рядом: нативный <input type="file"> в английском браузере
 * пишет «Choose File / No file chosen», и выглядит в каждом браузере по-своему. Сам input скрыт, но
 * доступен по подписи (`label`) — для экранного диктора и тестов (`getByLabelText`, `user.upload`).
 * Управляемый: имя берётся из `file`; стал `file` null — значение input сбрасывается, и тот же файл
 * можно выбрать снова.
 */
export function FilePicker({ label, button, accept, file, onChange, onClear, disabled }: {
  label: string
  button: string
  accept?: string
  file: File | null
  onChange: (f: File | undefined) => void
  /** Есть — рядом с именем кнопка «Убрать». */
  onClear?: () => void
  disabled?: boolean
}) {
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!file && input.current) input.current.value = ''
  }, [file])
  return (
    <div className="field file-picker">
      <span>{label}</span>
      <div className="file-picker-row">
        <button type="button" className="btn" disabled={disabled} onClick={() => input.current?.click()}>📎 {button}</button>
        <span className={file ? 'file-picker-name' : 'file-picker-name hint'} title={file?.name}>{file ? file.name : 'файл не выбран'}</span>
        {file && onClear && <button type="button" className="btn ghost small" disabled={disabled} onClick={onClear}>Убрать</button>}
      </div>
      <input ref={input} type="file" accept={accept} hidden aria-label={label} disabled={disabled}
        onChange={(e) => onChange(e.target.files?.[0])} />
    </div>
  )
}
