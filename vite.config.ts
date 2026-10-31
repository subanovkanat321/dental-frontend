/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

// Бэкенд (subanovkanat321/dental) на ноутбуке: ./mvnw spring-boot:run
const backend = process.env.DENTAL_BACKEND ?? 'http://localhost:8080'

export default defineConfig({
  // На проде CRM живёт по адресу /crm/ того же домена, что и Mini App (ADR 0001 бэкенда)
  base: '/crm/',
  plugins: [react()],
  build: {
    rollupOptions: {
      // CRM и Mini App — index.html; страницы сайта — свои HTML с og:-тегами и лёгкими скриптами
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        ...Object.fromEntries(['clinic', 'clinics', 'join', 'go', 'call'].map((name) => [name, resolve(import.meta.dirname, `site/${name}.html`)])),
      },
    },
  },
  server: {
    // Тот же origin, что на проде: браузер ходит на localhost:5173, Vite передаёт /api, /web и
    // /login в Spring Boot — без CORS, cookie-сессия сайта (dental_session) работает как за nginx
    proxy: {
      '/api': backend,
      '/web': backend,
      '/login': backend,
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    unstubGlobals: true,
  },
})
