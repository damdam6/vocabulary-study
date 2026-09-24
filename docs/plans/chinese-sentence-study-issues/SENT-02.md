# [SENT-02] 문장 등록 미리보기·병음 검토 경고·추출 킷을 지원한다

## 현상 / 배경

중국어 단어뿐 아니라 문장도 같은 시트와 학습 진도로 공부하려는 요구다. 클라이언트는 한자-병음 불일치를 차단하고 Python 킷도 한자 전용 계약을 사용한다.

## 현재 동작

관련 위치: src/lib/registerValidation.ts, src/lib/pinyinValidation.ts, 등록 화면, docs/registration-kit/extraction-prompt.md, schema_check.py.

## 기대 동작

문장 원문을 보존한 채 등록·학습하며 기존 단어와 generic 동작을 유지한다. 상세 계약은 상위 PRD 이슈의 본문 및 `docs/PRD-chinese-sentence-study.md`를 따른다. 새로운 문장 타입이나 시트 열은 추가하지 않는다.

## 완료 조건

- [ ] SENT-01의 형식 계약을 프런트와 Python 킷에 동일하게 적용하고 fixture parity를 검증한다.
- [ ] 병음 형식 오류는 차단하고 의미 불일치/자동 확인 불가는 모든 zh 항목에서 비차단 검토 경고로 표시한다. 기존 단어도 같은 정책을 적용한다.
- [ ] 숫자·영문 혼합/다음자/변조를 검증 완료로 오인시키지 않고 긴 입력의 병음 탐색에 연산 상한을 둔다.
- [ ] 오류/중복/경고를 구분하고 경고 행 제출, 집계, 직접 수정 후 재검증을 테스트한다.
- [ ] 추출 프롬프트에 문장 원문·문장 병음·뜻과 숫자의 병음 풀어쓰기 예제를 제공한다.
- [ ] generic 추출/등록 회귀와 문장 샘플 Python PASS/불허 샘플 FAIL을 확인한다.

## 의존성

#173 (SENT-01) 병합 후 시작한다.

상위 PRD: #172 — https://github.com/damdam6/vocabulary-study/issues/172 (PRD 전문 포함).

이 이슈는 구현 및 관련 테스트까지 포함한다. 상위 추적 이슈는 구현 선행 노드가 아니다.

