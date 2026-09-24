import js from '@eslint/js'
import ts from 'typescript-eslint'
import prettier from 'eslint-config-prettier'

export default ts.config(
  js.configs.recommended,
  ...ts.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        // projectService lets typescript-eslint resolve the right tsconfig per
        // file. Files no tsconfig includes, like this config itself, are not
        // found on their own: they must be listed in allowDefaultProject.
        projectService: {
          allowDefaultProject: [
            'eslint.config.js',
            'prisma.config.ts',
            'vitest.config.ts',
          ],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // A promise without await is the number one cause of errors that never
      // reach the error handler, and of requests that hang until they time out.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',

      // A module's contract should not depend on inference.
      '@typescript-eslint/explicit-module-boundary-types': 'warn',

      // No explicit any. Use unknown and narrow it.
      '@typescript-eslint/no-explicit-any': 'error',

      // A forgotten console.log. Logging goes through pino.
      'no-console': ['error', { allow: ['warn', 'error'] }],

      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_' },
      ],
    },
  },
  {
    ignores: ['dist/', 'node_modules/', 'prisma/migrations/', 'src/generated/'],
  },

  // Must come last: it turns off every rule that would fight Prettier.
  prettier,
)
