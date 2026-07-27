// 검증 결과 테이블 (#49, design-prd 등록 화면 절) — 정상/오류/중복 구분 표시.
// 분류 로직은 lib/registerValidation.ts 책임 — 여기는 순수 표시만 담당한다.
// 헤더 라벨·A열 lang은 contentType별로 분기(#96) — 분기값은 lib/contentLabels.ts에서
// 가져온다(컴포넌트 테스트 하네스가 없어 분기 로직 자체는 그쪽에서 vitest로 고정).
import type { ContentType } from '../lib/api.ts'
import { headwordLang, registerTableHeaders } from '../lib/contentLabels.ts'
import type { ValidatedRow } from '../lib/registerValidation.ts'

const STATUS_LABEL: Record<ValidatedRow['status'], string> = {
  valid: '정상',
  blocked: '오류',
  duplicate: '중복',
}

interface RegisterTableProps {
  rows: ValidatedRow[]
  contentType: ContentType
}

function RegisterTable({ rows, contentType }: RegisterTableProps) {
  const headers = registerTableHeaders(contentType)
  const headwordLangAttr = headwordLang(contentType)
  return (
    <div className="register-table-wrap">
      <table className="register-table">
        <thead>
          <tr>
            <th>{headers.headword}</th>
            <th>{headers.note}</th>
            <th>{headers.meaning}</th>
            <th>상태</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.hanzi}-${index}`}>
              <td lang={headwordLangAttr}>{row.hanzi || '—'}</td>
              <td>{row.pinyin || '—'}</td>
              <td>{row.meaning || '—'}</td>
              <td>
                <span className={`register-status register-status--${row.status}`}>
                  {STATUS_LABEL[row.status]}
                </span>
                {row.reasons.length > 0 && (
                  <ul className="register-reasons">
                    {row.reasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default RegisterTable
