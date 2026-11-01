import { render } from '@testing-library/react'
import { useState } from 'react'

import { backDepth, useBack } from './back'

type Back = { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void }

function fakeTelegram() {
  let click: (() => void) | null = null
  let visible = false
  const back: Back = {
    show: () => { visible = true },
    hide: () => { visible = false },
    onClick: (cb) => { click = cb },
    offClick: () => { click = null },
  }
  window.Telegram = { WebApp: { initData: 'test', ready() {}, expand() {}, BackButton: back } } as unknown as typeof window.Telegram
  return { press: () => click?.(), visible: () => visible }
}

function Screen({ name, onBack }: { name: string; onBack: () => void }) {
  useBack(onBack)
  return <p>{name}</p>
}

function Nested({ log }: { log: string[] }) {
  const [item, setItem] = useState(true)
  const [card, setCard] = useState(true)
  return (
    <>
      {item && <Screen name="пункт настроек" onBack={() => { log.push('к настройкам'); setItem(false) }} />}
      {item && card && <Screen name="карточка" onBack={() => { log.push('закрыть карточку'); setCard(false) }} />}
    </>
  )
}

afterEach(() => {
  delete window.Telegram
})

test('стрелка «назад» Telegram: шаг за шагом — карточка, потом пункт настроек, потом прячется', async () => {
  const tg = fakeTelegram()
  const log: string[] = []
  const { rerender } = render(<Nested log={log} />)
  expect(tg.visible()).toBe(true)
  expect(backDepth()).toBe(2)

  tg.press()
  rerender(<Nested log={log} />)
  expect(log).toEqual(['закрыть карточку'])
  expect(tg.visible()).toBe(true) // карточку закрыли — стрелка ведёт на шаг ниже, а не пропадает

  tg.press()
  rerender(<Nested log={log} />)
  expect(log).toEqual(['закрыть карточку', 'к настройкам'])
  expect(tg.visible()).toBe(false)
  expect(backDepth()).toBe(0)
})
