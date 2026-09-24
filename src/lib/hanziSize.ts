/**
 * design-prd §1.2 + #176: 모드1 카드 앞면 중국어 글자 수 적응 크기 — 짧은
 * 단어의 84/64/52px 계약을 보존하고 긴 구·문장에만 작은 구간을 추가한다.
 * 화면이 아닌 lib에 두는 이유: 컴포넌트 테스트 환경
 * 없이 vitest(node)로 스케일 규칙을 고정하기 위함 — wordState·sessionQueue와
 * 같은 배치. 반환값은 px 수치 — 클래스 매핑(flip-hanzi--{px})은 화면 몫.
 */
export function hanziFontSize(hanzi: string): 84 | 64 | 52 | 40 | 32 | 24 {
  // String.length는 서로게이트 쌍(확장 한자)을 2로 세므로 코드포인트 기준으로 센다.
  // 문자열 이터레이터로 직접 세어 Array.from의 중간 배열 할당을 피한다.
  let count = 0;
  for (const _ of hanzi) count += 1;
  if (count <= 2) return 84;
  if (count === 3) return 64;
  if (count <= 8) return 52;
  if (count <= 20) return 40;
  if (count <= 50) return 32;
  return 24;
}
