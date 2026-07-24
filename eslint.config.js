import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const LIVEKIT_CLIENT_RESTRICTION = {
  name: 'livekit-client',
  message:
    'Import livekit-client only from src/transport/livekit/. ScenaroSession and the public ' +
    'React API must go through the internal Transport interface (src/core/transport.ts) so ' +
    'another engine can be plugged in later without rewriting business logic.',
};

export default tseslint.config(
  { ignores: ['dist', 'node_modules'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: { ecmaVersion: 2022 },
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
  {
    // Transport boundary: everything except src/transport/livekit/ must go through the
    // internal Transport interface.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/transport/livekit/**', 'src/react/feature-runtime/useFeatureToolRpc.ts'],
    rules: {
      'no-restricted-imports': ['error', { paths: [LIVEKIT_CLIENT_RESTRICTION] }],
    },
  },
);
