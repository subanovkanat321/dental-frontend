import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default defineConfig([
  globalIgnores(['dist', 'src/api/schema.d.ts']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    // vi.waitFor по умолчанию ждёт 1 с — под нагрузкой (CI, параллельные прогоны) тесты падали без
    // причины. Ждём через waitForSlow (src/test/wait.ts, 5 с) или waitFor из Testing Library
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/test/wait.ts'],
    rules: {
      'no-restricted-syntax': ['error', {
        selector: "CallExpression[callee.object.name='vi'][callee.property.name='waitFor'][arguments.length<2]",
        message: 'vi.waitFor ждёт только 1 с — используйте waitForSlow из src/test/wait.ts (5 с) или waitFor из Testing Library.',
      }],
    },
  },
])
