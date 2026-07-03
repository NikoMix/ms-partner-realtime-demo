import pluginVue from 'eslint-plugin-vue'
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript'
import skipFormatting from '@vue/eslint-config-prettier/skip-formatting'
import sonarjs from 'eslint-plugin-sonarjs'

export default defineConfigWithVueTs(
  { name: 'app/files', files: ['**/*.{ts,mts,tsx,vue}'] },
  {
    name: 'app/ignores',
    ignores: ['dist/**', 'dev-dist/**', 'coverage/**', 'node_modules/**', '**/*.d.ts'],
  },

  pluginVue.configs['flat/recommended'],
  vueTsConfigs.recommendedTypeChecked,

  // SonarJS: code-smell / bug / complexity telemetry (source only).
  {
    name: 'app/sonarjs',
    files: ['src/**/*.{ts,mts,tsx}'],
    ...sonarjs.configs.recommended,
  },

  {
    name: 'app/rules',
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      'vue/multi-word-component-names': 'off',
      'vue/block-lang': 'off',
    },
  },

  // AudioWorklet global scope declares its own globals. The recorder worklet ships as
  // plain JS from `public/` (see public/pcm-recorder.worklet.js), so it is not linted here.

  {
    name: 'app/tests',
    files: ['src/**/*.{test,spec}.ts', 'vitest.setup.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      'sonarjs/no-duplicate-string': 'off',
      'sonarjs/no-hardcoded-ip': 'off',
    },
  },

  skipFormatting,
)
