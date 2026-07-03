import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import prettier from 'eslint-config-prettier'

// Flat config. Non-type-aware tseslint (fast, no project service). prettier LAST so it
// disables all stylistic rules — formatting is owned by Prettier, not ESLint.
export default tseslint.config(
  {
    ignores: [
      'out/**',
      'dist/**',
      'node_modules/**',
      'spike/**',
      'scripts/**',
      '*.config.js',
      '*.config.ts',
      '*.config.mjs'
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // Match existing code: underscore-prefixed args/vars are intentional throwaways.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }
      ],
      // The codebase deliberately uses `any`/casts at Electron/OpenAI SDK boundaries.
      '@typescript-eslint/no-explicit-any': 'warn'
    }
  },
  prettier
)
