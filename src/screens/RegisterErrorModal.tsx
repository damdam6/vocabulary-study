// 오류 행 직접 수정 모달 (#127, design-prd §6 "오류 수정 모달") — 검증에서 blocked로
// 분류된 행만 모아 세 값(zh: 한자/병음/뜻, generic: 표제어/보조 표기/뜻)을 모두 고칠
// 수 있게 한다. 열려 있는 동안의 편집은 이 컴포넌트의 draft 상태에만 쌓이고, "저장"을
// 눌러야 부모(RegisterScreen)로 올라가 배치 전체가 재검증된다 — "취소"는 draft를 버린다.
//
// 입력의 React key는 반드시 행 index로 고정한다. RegisterTable의 `${row.hanzi}-${index}`
// 전략(값 포함)을 여기 가져오면 표제어를 한 글자 칠 때마다 key가 바뀌어 input이
// re-mount되고 매 글자 포커스가 날아간다.
//
// 재검증 결과 blocked에서 벗어난 행은 모달을 다시 열 때 목록에서 빠진다 — 저장 시
// 모달을 닫는 이유이기도 하다(편집 중에 행이 사라지는 어긋남 방지).
import { useEffect, useState } from 'react'
import type { ContentType } from '../lib/api.ts'
import { registerTableHeaders } from '../lib/contentLabels.ts'
import type { ParsedWord, ValidatedRow } from '../lib/registerValidation.ts'

/** 편집 대상 행 — index는 배치 전체(파싱 결과) 기준이라 오버레이 키로 그대로 쓰인다. */
export interface BlockedRow {
  index: number
  row: ValidatedRow
}

interface RegisterErrorModalProps {
  rows: BlockedRow[]
  contentType: ContentType
  onCancel: () => void
  onSave: (edits: Record<number, ParsedWord>) => void
}

function RegisterErrorModal({ rows, contentType, onCancel, onSave }: RegisterErrorModalProps) {
  const headers = registerTableHeaders(contentType)
  // 열릴 때의 값으로 draft를 채운다 — 부모가 열 때마다 새로 마운트하므로 초기화 훅은 없다.
  const [draft, setDraft] = useState<Record<number, ParsedWord>>(() =>
    Object.fromEntries(rows.map(({ index, row }) => [index, { hanzi: row.hanzi, pinyin: row.pinyin, meaning: row.meaning }])),
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

  const updateField = (index: number, field: keyof ParsedWord, value: string) => {
    setDraft((prev) => ({ ...prev, [index]: { ...prev[index], [field]: value } }))
  }

  return (
    <div className="register-modal-backdrop">
      <div className="register-modal" role="dialog" aria-modal="true" aria-labelledby="register-error-modal-title">
        <h2 className="register-modal-title" id="register-error-modal-title">
          오류 {rows.length}건 수정
        </h2>
        <p className="register-modal-hint">
          값을 고치고 저장하면 배치 전체를 다시 검증합니다 — 표제어를 바꾸면 중복 판정도 달라집니다.
        </p>

        <div className="register-modal-rows">
          {rows.map(({ index, row }) => (
            <div className="register-modal-row" key={index}>
              <ul className="register-reasons">
                {row.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
              <div className="register-modal-fields">
                <label className="register-modal-field">
                  <span className="register-modal-field-label">{headers.headword}</span>
                  <input
                    className="register-modal-input"
                    type="text"
                    value={draft[index].hanzi}
                    onChange={(event) => updateField(index, 'hanzi', event.target.value)}
                    spellCheck={false}
                    autoCorrect="off"
                    autoCapitalize="off"
                  />
                </label>
                <label className="register-modal-field">
                  <span className="register-modal-field-label">{headers.note}</span>
                  <input
                    className="register-modal-input"
                    type="text"
                    value={draft[index].pinyin}
                    onChange={(event) => updateField(index, 'pinyin', event.target.value)}
                    spellCheck={false}
                    autoCorrect="off"
                    autoCapitalize="off"
                  />
                </label>
                <label className="register-modal-field">
                  <span className="register-modal-field-label">{headers.meaning}</span>
                  <input
                    className="register-modal-input"
                    type="text"
                    value={draft[index].meaning}
                    onChange={(event) => updateField(index, 'meaning', event.target.value)}
                  />
                </label>
              </div>
            </div>
          ))}
        </div>

        <div className="register-modal-actions">
          <button type="button" className="register-modal-cancel" onClick={onCancel}>
            취소
          </button>
          <button type="button" className="register-modal-save" onClick={() => onSave(draft)}>
            저장
          </button>
        </div>
      </div>
    </div>
  )
}

export default RegisterErrorModal
