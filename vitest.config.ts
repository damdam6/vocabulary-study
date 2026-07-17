import { defineConfig } from "vitest/config";

// vite.config.ts에 있는 @cloudflare/vite-plugin이 순수 함수 단위 테스트 실행에
// 끼어들지 않도록, vite.config.ts를 읽지 않는 별도 설정으로 분리한다.
export default defineConfig({
  test: {},
});
