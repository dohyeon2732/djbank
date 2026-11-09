import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// base를 상대 경로로 두어 어떤 하위 경로에 올려도 정적 호스팅으로 동작합니다.
export default defineConfig({
  base: './',
  plugins: [react()],
});
