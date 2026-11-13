import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'

import { FilePicker } from './FilePicker'

function Host({ onPick }: { onPick: (f: File | undefined) => void }) {
  const [file, setFile] = useState<File | null>(null)
  return <FilePicker label="Список" button="Выбрать файл (.xlsx)" accept=".xlsx" file={file}
    onChange={(f) => { setFile(f ?? null); onPick(f) }} onClear={() => setFile(null)} />
}

test('FilePicker: кнопка вместо «Choose File», имя выбранного файла и «Убрать»', async () => {
  const picked: (File | undefined)[] = []
  const user = userEvent.setup()
  render(<Host onPick={(f) => picked.push(f)} />)
  const input = screen.getByLabelText<HTMLInputElement>('Список')
  expect(input).toHaveAttribute('type', 'file')
  expect(input).not.toBeVisible()
  expect(input).toHaveAttribute('accept', '.xlsx')
  expect(screen.getByRole('button', { name: '📎 Выбрать файл (.xlsx)' })).toBeVisible()
  expect(screen.getByText('файл не выбран')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Убрать' })).not.toBeInTheDocument()

  await user.upload(input, new File(['x'], 'клиники.xlsx'))
  expect(picked.map((f) => f?.name)).toEqual(['клиники.xlsx'])
  expect(screen.getByText('клиники.xlsx')).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'Убрать' }))
  expect(screen.getByText('файл не выбран')).toBeInTheDocument()
  expect(input.value).toBe('')
})
