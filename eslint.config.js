import globals from 'globals';

// Catch runtime mistakes and abandoned code without imposing a formatting rewrite.
export default [
  { ignores: ['node_modules/**', 'public/**', 'output/**'] },
  {
    files: ['server/**/*.js', 'api/**/*.js', 'scripts/**/*.js', 'web/scripts/**/*.js', 'tests/**/*.js', 'eslint.config.js'],
    languageOptions: { ecmaVersion: 'latest' },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }],
      'no-unreachable': 'error',
      'no-dupe-args': 'error',
      'no-dupe-keys': 'error',
      'no-dupe-else-if': 'error',
      'no-constant-binary-expression': 'error',
      'no-unsafe-optional-chaining': 'error',
      'valid-typeof': 'error',
    },
  },
  {
    files: ['server/**/*.js', 'api/**/*.js', 'scripts/**/*.js', 'tests/**/*.js', 'eslint.config.js'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['web/scripts/**/*.js'],
    languageOptions: { sourceType: 'script', globals: globals.browser },
  },
];
