import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import i18next from 'eslint-plugin-i18next';

export default tseslint.config(
  { ignores: ['dist', 'dev-dist', 'node_modules', 'coverage'] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.worker },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },

  // --- La garde i18n ---
  // Toute chaine litterale rendue a l'utilisateur est une erreur de lint.
  // C'est le garde-fou mecanique de la regle "i18n obligatoire" du CLAUDE.md.
  {
    files: ['src/**/*.tsx'],
    plugins: { i18next },
    rules: {
      'i18next/no-literal-string': [
        'error',
        {
          mode: 'jsx-text-only',
          'should-validate-template': true,
          message: 'Toute chaine UI doit passer par i18next (useTranslation).',
          callees: { exclude: ['^t$', 'i18n(ext)?', 'log', 'warn', 'error'] },
          'jsx-attributes': {
            // Attributs purement techniques: jamais affiches a l'utilisateur.
            exclude: [
              'className', 'class', 'style', 'id', 'key', 'type', 'name',
              'href', 'src', 'to', 'role', 'width', 'height', 'viewBox',
              'fill', 'stroke', 'd', 'transform', 'accept', 'autoComplete',
              'inputMode', 'enterKeyHint', 'data-.*', 'aria-hidden',
              'aria-live', 'aria-orientation', 'aria-valuetext',
            ],
          },
          words: {
            // Ponctuation, symboles et unites: pas de traduction necessaire.
            exclude: ['^[^\\p{L}]+$'],
          },
        },
      ],
    },
  },

  // Le domaine et le moteur de rendu sont purs et sans chaine UI par conception.
  // Ils n'importent jamais React ni i18next: inutile d'y appliquer la regle.
  {
    files: ['src/domain/**/*.ts', 'src/engine/**/*.ts', 'src/lib/**/*.ts'],
    rules: { 'i18next/no-literal-string': 'off' },
  },

  {
    // `.mjs` compte aussi: les scripts d'outillage tournent sous Node et
    // utilisent `console` et `process`, absents des globals du navigateur.
    files: [
      'tests/**/*.ts',
      'scripts/**/*.{ts,mjs,js}',
      '*.config.ts',
      '*.config.js',
    ],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      'no-console': 'off',
      'i18next/no-literal-string': 'off',
    },
  },
);
