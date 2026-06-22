import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@turntabl-score-room/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
      '@turntabl-score-room/shared/mock-data': fileURLToPath(new URL('../../packages/shared/src/mock-data.ts', import.meta.url)),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
})
