import { resolve } from 'node:path'
import { defineConfig } from 'vite'

/**
 * Сборка рендерера рилсов «Как лечат» — отдельно от приложения: один файл out/scene.js (IIFE, без модулей),
 * его вставляет в страницу сборщик роликов бэкенда (e2e/promo/reels/treat.mjs). В бандл приложения
 * (корневой vite.config.ts) этот код не попадает.
 *   npx vite build --config tools/treat-reels/vite.config.ts
 */
export default defineConfig({
  root: import.meta.dirname,
  publicDir: false,
  logLevel: 'warn',
  build: {
    outDir: resolve(import.meta.dirname, 'out'),
    emptyOutDir: true,
    minify: true,
    lib: { entry: resolve(import.meta.dirname, 'main.ts'), formats: ['iife'], name: 'TreatReelsBundle', fileName: () => 'scene.js' },
  },
})
