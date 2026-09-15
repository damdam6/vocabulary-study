// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fire, renderComponent } from '../test-utils.tsx'
import type { StudyQuestion } from '../lib/studySession.ts'
import Mode1Card from './Mode1Card.tsx'

const question: StudyQuestion = {
  mode: 'm1',
  isReview: false,
  word: {
    tab: 'HSK', hanzi: '经济', pinyin: 'jīngjì', meaning: '경제',
    m1: 0, m2: 0, nextReview: null, interval: null,
  },
}

function transitionEnd(element: Element, propertyName: string, target: Element = element) {
  const event = new Event('transitionend', { bubbles: true })
  Object.defineProperty(event, 'propertyName', { value: propertyName })
  target.dispatchEvent(event)
}

function renderCard(overrides: Partial<StudyQuestion['word']> = {}, contentType: 'zh' | 'generic' = 'zh') {
  const onJudged = vi.fn()
  const result = renderComponent(
    <Mode1Card
      question={{ ...question, word: { ...question.word, ...overrides } }}
      contentType={contentType}
      onJudged={onJudged}
    />,
  )
  return { ...result, onJudged }
}

describe('Mode1Card 접근성 플립', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      transitionProperty: 'opacity, transform',
      transitionDuration: '0.2s, 550ms',
      transitionDelay: '10ms, 0.05s',
    } as CSSStyleDeclaration)
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })))
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    document.body.replaceChildren()
  })

  it('비대화형 래퍼와 형제인 앞면 버튼·숨겨진 뒷면을 렌더한다', () => {
    const { container, unmount } = renderCard()
    const card = container.querySelector('.flip-card')!
    const front = container.querySelector('.flip-face--front') as HTMLButtonElement
    const back = container.querySelector('.flip-face--back') as HTMLDivElement

    expect(card.tagName).toBe('DIV')
    expect(front.parentElement).toBe(card)
    expect(back.parentElement).toBe(card)
    expect(container.querySelector('button button')).toBeNull()
    expect(front.disabled).toBe(false)
    expect(front.getAttribute('aria-hidden')).toBe('false')
    expect(front.hasAttribute('inert')).toBe(false)
    expect(back.getAttribute('aria-hidden')).toBe('true')
    expect(back.hasAttribute('inert')).toBe(true)
    unmount()
  })

  it('래퍼 자신의 transform 완료만 받아 답을 공개하고 키보드 초점을 판정으로 옮긴다', () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')
    const { container, unmount } = renderCard()
    const card = container.querySelector('.flip-card')!
    const front = container.querySelector('.flip-face--front') as HTMLButtonElement
    const back = container.querySelector('.flip-face--back')!
    front.focus()
    fire(() => front.click())

    expect(container.querySelector('.judge--x')).not.toBeNull()
    expect(back.getAttribute('aria-hidden')).toBe('true')
    fire(() => transitionEnd(card, 'opacity'))
    fire(() => transitionEnd(card, 'transform', back))
    expect(back.getAttribute('aria-hidden')).toBe('true')

    fire(() => transitionEnd(card, 'transform'))
    expect(back.getAttribute('aria-hidden')).toBe('false')
    expect(back.hasAttribute('inert')).toBe(false)
    expect(front.getAttribute('aria-hidden')).toBe('true')
    expect(document.activeElement).toBe(container.querySelector('.judge--x'))
    expect(clearTimeoutSpy).toHaveBeenCalled()
    unmount()
  })

  it('계산한 최대 transform 시간과 buffer 뒤 fallback으로 한 번 완료한다', () => {
    const { container, unmount } = renderCard()
    const front = container.querySelector('.flip-face--front') as HTMLButtonElement
    const back = container.querySelector('.flip-face--back')!
    fire(() => front.click())

    fire(() => vi.advanceTimersByTime(699))
    expect(back.getAttribute('aria-hidden')).toBe('true')
    fire(() => vi.advanceTimersByTime(1))
    expect(back.getAttribute('aria-hidden')).toBe('false')
    expect(vi.getTimerCount()).toBe(0)
    unmount()
  })

  it.each([
    ['0초', false, '0s'],
    ['reduced motion', true, '550ms'],
  ])('%s에서는 timer 없이 즉시 답을 공개한다', (_label, reduced, duration) => {
    vi.mocked(window.getComputedStyle).mockReturnValue({
      transitionProperty: 'transform', transitionDuration: duration, transitionDelay: '0s',
    } as CSSStyleDeclaration)
    vi.mocked(matchMedia).mockReturnValue({ matches: reduced } as MediaQueryList)
    const { container, unmount } = renderCard()
    fire(() => (container.querySelector('.flip-face--front') as HTMLButtonElement).click())
    expect(container.querySelector('.flip-face--back')?.getAttribute('aria-hidden')).toBe('false')
    expect(vi.getTimerCount()).toBe(0)
    unmount()
  })

  it('전환 중 옮긴 초점을 빼앗지 않고 빠른 O/X 판정과 timer 정리를 보존한다', () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')
    const { container, onJudged, unmount } = renderCard()
    const front = container.querySelector('.flip-face--front') as HTMLButtonElement
    front.focus()
    fire(() => front.click())
    const correct = container.querySelector('.judge--o') as HTMLButtonElement
    correct.focus()
    fire(() => correct.click())
    fire(() => correct.click())

    expect(onJudged).toHaveBeenCalledTimes(1)
    expect(onJudged).toHaveBeenCalledWith(true)
    expect(document.activeElement).toBe(correct)
    expect(clearTimeoutSpy).toHaveBeenCalled()
    fire(() => vi.runAllTimers())
    expect(container.querySelector('.flip-face--back')?.getAttribute('aria-hidden')).toBe('true')
    unmount()
  })

  it('generic과 200자 콘텐츠를 손실 없이 렌더하고 언마운트 timer를 정리한다', () => {
    const hanzi = '长'.repeat(200)
    const pinyin = 'cháng '.repeat(200).trim()
    const meaning = '아주 긴 뜻 '.repeat(100).trim()
    const { container, unmount } = renderCard({ hanzi, pinyin, meaning }, 'generic')
    expect(container.querySelector('.flip-hanzi--generic')?.textContent).toBe(hanzi)
    fire(() => (container.querySelector('.flip-face--front') as HTMLButtonElement).click())
    expect(container.querySelector('.flip-face--back .mode-card-hanzi')?.textContent).toBe(hanzi)
    expect(container.querySelector('.flip-face--back .mode-card-pinyin')?.textContent).toBe(pinyin)
    expect(container.querySelector('.flip-face--back .mode-card-meaning')?.textContent).toBe(meaning)
    expect(container.querySelector('.judge-zone')?.parentElement).toBe(container.querySelector('.mode-area'))
    expect(vi.getTimerCount()).toBe(1)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
