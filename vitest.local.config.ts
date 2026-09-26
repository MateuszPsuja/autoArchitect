import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: [
      'src/app/core/export.service.spec.ts',
      'src/app/features/export/zip/export-zip.component.spec.ts',
    ],
    setupFiles: ['./vitest.node.setup.ts'],
    reporters: ['default'],
    globals: true,
  },
});
