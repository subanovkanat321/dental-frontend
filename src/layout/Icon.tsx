/** Линейные иконки меню (24×24, stroke = цвет текста) — вместо эмодзи (DESIGN.md → Don'ts). */
const PATHS = {
  schedule: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  patients: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c1.9.8 3.1 2.4 3.5 5.2" /></>,
  cash: <><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M3 10h18M7 15h3" /></>,
  stock: <><path d="M3 8l9-5 9 5v8l-9 5-9-5z" /><path d="M3 8l9 5 9-5M12 13v8" /></>,
  team: <><circle cx="12" cy="7.5" r="3.5" /><path d="M5 20c.9-3.8 3.7-6 7-6s6.1 2.2 7 6" /><path d="M18 9.5h4M20 7.5v4" /></>,
  clinic: <><path d="M4 21V8l8-5 8 5v13" /><path d="M12 9v6M9 12h6M9 21v-3h6v3" /></>,
  external: <><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></>,
} as const

export type IconName = keyof typeof PATHS

export function Icon({ name }: { name: IconName }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round">
      {PATHS[name]}
    </svg>
  )
}
