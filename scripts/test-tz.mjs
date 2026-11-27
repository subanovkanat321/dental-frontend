// Тесты времени с чужой зоной компьютера: время клиник — Бишкек, а не зона браузера. Ошибка, которую ловим:
// компьютер в Москве — приём, перетащенный в календаре, сохранился на 3 часа мимо (зона браузера вместо клиники).
// Зону процесса задаёт только переменная TZ при запуске — внутри теста менять её поздно, поэтому тот же набор
// файлов гоняем три раза: Москва (UTC+3), Нью-Йорк (UTC−5, другой UTC-день вечером) и UTC (как CI и сервер).
//   npm run test:tz                     — набор ниже
//   npm run test:tz -- src/cash         — свои файлы
import { spawnSync } from 'node:child_process'

const ZONES = ['Europe/Moscow', 'America/New_York', 'UTC']
const FILES = [
  'src/schedule/timezone.test.tsx',
  'src/schedule/week.test.tsx',
  'src/schedule/midnight.test.tsx',
  'src/schedule/time.test.tsx',
  'src/cash/cashDay.test.tsx',
]

const files = process.argv.slice(2).length ? process.argv.slice(2) : FILES
for (const zone of ZONES) {
  console.log(`\n=== TZ=${zone} ===`)
  const run = spawnSync('npx', ['vitest', 'run', ...files], { stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, TZ: zone } })
  if (run.status !== 0) {
    console.error(`Тесты времени упали при TZ=${zone}`)
    process.exit(run.status ?? 1)
  }
}
