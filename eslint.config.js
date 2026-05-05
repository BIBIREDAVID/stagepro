import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'node_modules']),
  {
    files: ['src/**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { varsIgnorePattern: '^[A-Z_]' }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'react-hooks/purity': 'off',
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  {
    files: ['api/**/*.js', 'server/**/*.js', 'scripts/**/*.js', '*.config.js', '*.mjs'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 'latest',
      globals: globals.node,
      parserOptions: {
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { varsIgnorePattern: '^[A-Z_]' }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },
  {
    files: ['scripts/google-apps-script-live-sheet-template.js'],
    languageOptions: {
      globals: {
        SpreadsheetApp: 'readonly',
        ContentService: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { varsIgnorePattern: '^(doPost|[A-Z_])$', args: 'none' }],
      'no-useless-escape': 'off',
    },
  },
])
