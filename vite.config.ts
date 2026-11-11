import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { runnerApi } from './server/plugin';

// base를 상대 경로로 두어 어떤 하위 경로에 올려도 정적 호스팅으로 동작합니다.
// runnerApi는 개발 서버에서만 켜지는 실행 API입니다(server/plugin.ts).
export default defineConfig({
  base: './',
  plugins: [react(), runnerApi()],
  server: {
    // 실행 결과를 public/data에 쓸 때 화면이 통째로 새로고침되지 않게 합니다.
    // 데이터는 실행이 끝나면 화면이 직접 다시 읽습니다.
    watch: { ignored: ['**/public/data/**', '**/archive/**', '**/runner.config.json'] },
  },
});
