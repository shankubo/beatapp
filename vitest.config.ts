import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import { fileURLToPath, URL } from 'node:url';

const alias = { '@': fileURLToPath(new URL('./src', import.meta.url)) };

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'unit',
          // Le domaine est pur: pas besoin de DOM, donc les tests sont rapides.
          environment: 'node',
          include: ['tests/unit/**/*.test.ts'],
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'browser',
          // WebCodecs, OfflineAudioContext et OffscreenCanvas ne se mockent pas
          // utilement: ces tests tournent dans un vrai Chromium.
          include: ['tests/browser/**/*.test.ts'],
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
});
