import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default [
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/*.db',
      'apps/server/public/**',
      // Vendored third-party source. Linting a copy we are not allowed to edit only produces
      // findings that cannot be actioned — see apps/web/src/vendor/knock/README.md.
      'apps/web/src/vendor/**',
      '*.ts',
      '*.tsx',
      '*.mts',
      '*.cts',
    ],
  },
  js.configs.recommended,
  {
    files: ['apps/web/**/*.jsx'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.es2022 },
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['scripts/**/*.js'],
    languageOptions: {
      globals: { ...globals.node, ...globals.es2022 },
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    rules: {
      'no-console': 'off',
    },
  },
  prettier,
];
