/**
 * design-prd §1.2: 모드1 카드 앞면 한자 글자 수 적응 크기 — 2자 이하 84px /
 * 3자 64px / 4자 이상 52px. 화면이 아닌 lib에 두는 이유: 컴포넌트 테스트 환경
 * 없이 vitest(node)로 스케일 규칙을 고정하기 위함 — wordState·sessionQueue와
 * 같은 배치. 반환값은 px 수치 — 클래스 매핑(flip-hanzi--{px})은 화면 몫.
 */
export function hanziFontSize(hanzi: string): 84 | 64 | 52 {
  // String.length는 서로게이트 쌍(확장 한자)을 2로 세므로 코드포인트 기준으로 센다.
  const count = Array.from(hanzi).length;
  if (count <= 2) return 84;
  if (count === 3) return 64;
  return 52;
}
