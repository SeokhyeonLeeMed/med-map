/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages 의 프로젝트 사이트는 /<repo>/ 아래에 놓이므로 base 를 환경변수로 받는다.
export default defineConfig({
  base: process.env.MEDMAP_BASE ?? '/',
  plugins: [react()],
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 1200 },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
})
