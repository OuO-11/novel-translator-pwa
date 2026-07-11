import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      // 로컬 개발 시 /api/proxy 호출을 Flask 백엔드로 포워딩
      '/api': {
        target: 'http://127.0.0.1:5000',
        changeOrigin: true,
        secure: false,
      }
    }
  },
  build: {
    // Vercel이 빌드된 정적 리소스를 올바로 찾을 수 있도록 outDir 지정
    outDir: 'dist'
  }
});
