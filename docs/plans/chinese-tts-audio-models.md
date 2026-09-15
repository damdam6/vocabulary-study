# 중국어 TTS 자동 실행 모델 배정

> 2026-09-15 · 사용자 지정 Codex 정책 · 대상 GitHub #135~#151 · 베이스 `feat/ch-sound`

복잡도는 이슈의 상태 관리·수명·보안 경계·연결 범위를 보고 오케스트레이터가 판단한다. 모델 조합은 사용자가 지정한 순서를 그대로 적용한다. `astro`는 `gpt-6-astra`로 해석했다.

| 복잡도 | 계획 | 구현·리뷰 수정 | 독립 리뷰·PR 검증 |
|---|---|---|---|
| 상 | Astra · high | Terra · high | Sol · low |
| 중 | Sol · high | Sol · low | Terra · medium |
| 하 | Terra · xhigh | Luna · medium | Luna · medium |

정확한 모델 ID는 Astra=`gpt-6-astra`, Sol=`gpt-5.6-sol`, Terra=`gpt-5.6-terra`, Luna=`gpt-5.6-luna`다. 모든 조합은 설치된 Codex 모델 목록의 지원 강도와 대조했다.

## 이슈별 배정

| 이슈 | 작업 | 복잡도 | 판단 근거 |
|---|---|---|---|
| [#135](https://github.com/damdam6/vocabulary-study/issues/135) | 공통 계약·입력·설정·병음 | 상 | 입력 검증과 양쪽 런타임의 후속 계약을 결정 |
| [#136](https://github.com/damdam6/vocabulary-study/issues/136) | 비공개 R2 저장 | 상 | 조건부 저장·경합·손상·실패의 일관성 |
| [#137](https://github.com/damdam6/vocabulary-study/issues/137) | Qwen 이벤트·MP3 | 중 | 소켓 없는 순수 처리기로 입출력과 검증 범위가 명확 |
| [#138](https://github.com/damdam6/vocabulary-study/issues/138) | Qwen WebSocket 수명 | 상 | 이벤트 순서·중단·타임아웃·자원 해제 |
| [#139](https://github.com/damdam6/vocabulary-study/issues/139) | 조회·합성·저장 서비스 | 상 | 예산·경합·백그라운드 저장의 조정 |
| [#140](https://github.com/damdam6/vocabulary-study/issues/140) | 인증 API·capability | 상 | 인증·본문 제한·격리·HTTP 결과 계약 |
| [#141](https://github.com/damdam6/vocabulary-study/issues/141) | 클라이언트 전송 | 중 | 명확한 API 계약에 취소·용량·오류 처리 연결 |
| [#142](https://github.com/damdam6/vocabulary-study/issues/142) | Audio·Blob 자원 관리 | 상 | 오디오·Object URL·LRU의 독립 수명과 해제 |
| [#143](https://github.com/damdam6/vocabulary-study/issues/143) | 질문별 재생 제어 | 상 | 늦은 응답·세대 구분·중복 재생 상태 관리 |
| [#144](https://github.com/damdam6/vocabulary-study/issues/144) | 공통 발음 버튼 | 하 | 확정 prop과 상태에 따른 표시 전용 UI |
| [#145](https://github.com/damdam6/vocabulary-study/issues/145) | 학습 세션 연결 | 상 | 여러 화면·수명·StrictMode·정지 경계를 연결 |
| [#146](https://github.com/damdam6/vocabulary-study/issues/146) | 모드1 구조·접근성 | 중 | 플립과 공개 완료·키보드의 한 컴포넌트 경계 |
| [#147](https://github.com/damdam6/vocabulary-study/issues/147) | 모드1 음성 연결 | 하 | 선행 계약과 공개 완료 신호를 제한된 범위에서 연결 |
| [#148](https://github.com/damdam6/vocabulary-study/issues/148) | 모드2 정답 음성 | 중 | 오답·빈답·정답 분기와 정답 항목 연결 |
| [#149](https://github.com/damdam6/vocabulary-study/issues/149) | Worker·R2 바인딩 | 중 | 범위는 작지만 실제 환경 정보와 생성 타입 확인 필요 |
| [#150](https://github.com/damdam6/vocabulary-study/issues/150) | 통합 회귀 검증 | 상 | 서버·플레이어·두 모드의 연결 및 전체 수용 기준 증거 |
| [#151](https://github.com/damdam6/vocabulary-study/issues/151) | 운영·제품 문서 | 하 | 선행 환경·검증 기록을 정해진 출시 문서로 통합 |

상 9개, 중 5개, 하 3개다. 등록된 의존성 23개와 최대 5개 이슈 병렬 설정을 유지한다. 한 이슈 안의 세 단계는 순차 실행한다.

## 실행과 인계

- 저장소 로컬 설정은 git-common-dir 아래 `issue-codex-run/config.json`, 단계 실행기는 `issue-codex-run/run.py`다. Codex 전역 기본값이나 다른 저장소 스킬을 변경하지 않는다.
- `issue-continue`가 선행 이슈의 실제 머지를 확인하고 실행 가능한 이슈의 worktree와 `issue-#번호` cmux workspace를 준비한다. 출발점은 최신 `origin/feat/ch-sound`이며 PR base도 명시한다.
- 실행기는 해당 이슈의 복잡도 설정을 읽어 계획·구현·리뷰를 각각 별도 `codex exec --model … -c model_reasoning_effort=…` 세션으로 실행한다. 모델 이름을 문서에만 적고 동일 세션을 계속 사용하는 방식은 아니다.
- 계획 단계는 `issue-plan`의 조사와 계획 HTML 작성을 수행하고 runner에 반환한다. 자동 승인된 다음 단계는 지정 구현 모델이 `issue-work`로 수행한다. 계획 단계는 코드를 구현하지 않는다.
- 독립 리뷰 모델이 실제 변경과 수용 기준을 검토하고 `issue-review`의 CI·GitHub 리뷰·squash merge 절차를 진행한다. 수정이 필요하면 지정 구현 모델을 다시 실행하고, 변경된 HEAD를 다시 리뷰한다. 검토한 HEAD와 실제 PR HEAD를 일치시킨 뒤 머지한다.
- 기존 GitHub AI 리뷰 workflow는 별도로 유지한다. 이번 표는 이 그래프가 직접 실행하는 Codex 단계의 배정이다.
- 각 worktree의 `.issue-codex/`에 실제 모델 인자·단계 결과·리뷰·실행 상태를 남긴다. 해당 디렉터리는 공통 git exclude로 제외하며 커밋하지 않는다.
- runner는 graph JSON을 수정하지 않고 완료/실패를 등록된 오케스트레이터 terminal surface로 알린다. 그래프 갱신과 후속 실행은 `issue-continue`가 담당한다. 원래 이슈 번호와 PR 번호를 구분한다.
- 실제 Qwen 유료 호출·리소스 생성·운영 배포는 이번 실행에 포함하지 않는다. #149에 필요한 실제 버킷 정보가 없으면 그 이슈를 완료로 표시하지 않는다. 다른 독립 경로는 진행할 수 있다.

재진입 시 `.git/issue-graph.json`과 `issue-codex-run/config.json`, 해당 worktree의 `.issue-codex/run-state.json`을 함께 읽는다. 이 문서는 배정 정책이며 현재 실행 상태는 런타임 기록이 기준이다.
