// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fire, renderComponent } from '../test-utils.tsx'
import type { StudyQuestion } from '../lib/studySession.ts'
import type { PronunciationBinding } from '../lib/ttsTypes.ts'
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

function createPronunciation(enabled = true) {
  return {
    snapshot: { status: 'idle' as const, questionId: 'q-1', enabled, inputReason: null, message: null },
    prepare: vi.fn(),
    reveal: vi.fn(),
    replay: vi.fn(),
  }
}

function renderCard(
  overrides: Partial<StudyQuestion['word']> = {},
  contentType: 'zh' | 'generic' = 'zh',
  pronunciation?: PronunciationBinding,
) {
  const onJudged = vi.fn()
  const result = renderComponent(
    <Mode1Card
      question={{ ...question, word: { ...question.word, ...overrides } }}
      contentType={contentType}
      onJudged={onJudged}
      pronunciation={pronunciation}
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

  it('앞면 scroll 영역과 공개 버튼을 분리하고 숨겨진 뒷면을 렌더한다', () => {
    const { container, unmount } = renderCard()
    const card = container.querySelector('.flip-card')!
    const front = container.querySelector('.flip-face--front') as HTMLDivElement
    const scroll = front.querySelector('.flip-hanzi') as HTMLElement
    const revealButton = front.querySelector('.flip-reveal-button') as HTMLButtonElement
    const back = container.querySelector('.flip-face--back') as HTMLDivElement

    expect(card.tagName).toBe('DIV')
    expect(front.tagName).toBe('DIV')
    expect(front.parentElement).toBe(card)
    expect(back.parentElement).toBe(card)
    expect(container.querySelector('button button')).toBeNull()
    expect(scroll.tabIndex).toBe(0)
    expect(scroll.getAttribute('role')).toBe('region')
    expect(scroll.getAttribute('aria-label')).toBe('문제 중국어')
    expect(revealButton.disabled).toBe(false)
    expect(front.getAttribute('aria-hidden')).toBe('false')
    expect(front.hasAttribute('inert')).toBe(false)
    expect(back.getAttribute('aria-hidden')).toBe('true')
    expect(back.hasAttribute('inert')).toBe(true)
    expect(container.querySelector('.mode-footnote')?.textContent).toBe('“탭해서 뜻 보기” 버튼을 누르면 뜻이 보입니다')
    unmount()
  })

  it('래퍼 자신의 transform 완료만 받아 답을 공개하고 키보드 초점을 판정으로 옮긴다', () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')
    const { container, unmount } = renderCard()
    const card = container.querySelector('.flip-card')!
    const front = container.querySelector('.flip-face--front') as HTMLDivElement
    const revealButton = container.querySelector('.flip-reveal-button') as HTMLButtonElement
    const back = container.querySelector('.flip-face--back')!
    revealButton.focus()
    fire(() => revealButton.click())

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
    const front = container.querySelector('.flip-reveal-button') as HTMLButtonElement
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
    fire(() => (container.querySelector('.flip-reveal-button') as HTMLButtonElement).click())
    expect(container.querySelector('.flip-face--back')?.getAttribute('aria-hidden')).toBe('false')
    expect(vi.getTimerCount()).toBe(0)
    unmount()
  })

  it('전환 중 옮긴 초점을 빼앗지 않고 빠른 O/X 판정과 timer 정리를 보존한다', () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')
    const { container, onJudged, unmount } = renderCard()
    const front = container.querySelector('.flip-reveal-button') as HTMLButtonElement
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
    const scroll = container.querySelector<HTMLElement>('.flip-hanzi--generic')!
    expect(scroll.textContent).toBe(hanzi)
    expect(scroll.tabIndex).toBe(0)
    expect(scroll.getAttribute('aria-label')).toBe('문제 단어')
    fire(() => (container.querySelector('.flip-reveal-button') as HTMLButtonElement).click())
    const back = container.querySelector('.flip-face--back')!
    const content = back.querySelector('.flip-face-back-content')!
    expect(content.parentElement).toBe(back)
    expect(content.children).toHaveLength(3)
    expect(content.querySelector('.mode-card-hanzi')?.textContent).toBe(hanzi)
    expect(content.querySelector('.mode-card-pinyin')?.textContent).toBe(pinyin)
    expect(content.querySelector('.mode-card-meaning')?.textContent).toBe(meaning)
    expect(container.querySelector('.judge-zone')?.parentElement).toBe(container.querySelector('.mode-area'))
    expect(vi.getTimerCount()).toBe(1)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('zh 200자 원문은 긴 문장 크기 class를 앞·뒷면에 적용하고 1,000자 병음을 보존한다', () => {
    const hanzi = '长'.repeat(200)
    const pinyin = 'cháng '.repeat(200).trim()
    const meaning = '아주 긴 뜻 '.repeat(120).trim()
    const { container, unmount } = renderCard({ hanzi, pinyin, meaning })
    expect(container.querySelector('.flip-hanzi--24')?.textContent).toBe(hanzi)
    expect(container.querySelector('.mode-card-hanzi--24')?.textContent).toBe(hanzi)
    expect(container.querySelector('.mode-card-pinyin')?.textContent).toBe(pinyin)
    expect(container.querySelector('.mode-card-meaning')?.textContent).toBe(meaning)
    expect(container.querySelector('.pinyin-speaker')?.querySelector('.mode-card-pinyin')).not.toBeNull()
    unmount()
  })

  it('앞면 scroll 영역의 Enter는 공개하지 않고 별도 버튼만 공개한다', () => {
    const { container, unmount } = renderCard({ hanzi: '长'.repeat(200) })
    const scroll = container.querySelector('.flip-hanzi') as HTMLElement
    scroll.focus()
    fire(() => scroll.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    expect(container.querySelector('.judge--x')).toBeNull()
    expect(document.activeElement).toBe(scroll)

    const revealButton = container.querySelector('.flip-reveal-button') as HTMLButtonElement
    revealButton.focus()
    fire(() => revealButton.click())
    expect(container.querySelector('.judge--x')).not.toBeNull()
    unmount()
  })

  it('짧은 답도 긴 답과 같은 내부 정렬 래퍼에 배치한다', () => {
    const { container, unmount } = renderCard()
    const back = container.querySelector('.flip-face--back')!
    const content = back.querySelector('.flip-face-back-content')!
    expect(content.parentElement).toBe(back)
    expect(Array.from(content.children).map((element) => element.textContent)).toEqual(['经济', 'jīngjì', '경제'])
    expect(back.children).toHaveLength(1)
    unmount()
  })

  it('binding은 첫 플립에서 prepare하고 카드 공개 완료 뒤 reveal을 한 번만 전달한다', () => {
    const pronunciation = createPronunciation()
    const { container, unmount } = renderCard({}, 'zh', pronunciation)
    const front = container.querySelector('.flip-reveal-button') as HTMLButtonElement
    const card = container.querySelector('.flip-card')!

    fire(() => front.click())
    expect(pronunciation.prepare).toHaveBeenCalledTimes(1)
    expect(pronunciation.reveal).not.toHaveBeenCalled()
    fire(() => transitionEnd(card, 'transform'))
    expect(pronunciation.reveal).toHaveBeenCalledTimes(1)
    fire(() => transitionEnd(card, 'transform'))
    fire(() => vi.runAllTimers())
    expect(pronunciation.reveal).toHaveBeenCalledTimes(1)
    unmount()
  })

  it('공개 후 발음 버튼은 replay만 호출하고 판정을 발생시키지 않는다', () => {
    const pronunciation = createPronunciation()
    const { container, onJudged, unmount } = renderCard({}, 'zh', pronunciation)
    const front = container.querySelector('.flip-reveal-button') as HTMLButtonElement
    fire(() => front.click())
    fire(() => transitionEnd(container.querySelector('.flip-card')!, 'transform'))

    const button = container.querySelector('.pronunciation-button__control') as HTMLButtonElement
    expect(button).not.toBeNull()
    const row = container.querySelector('.pinyin-speaker')!
    expect(row.contains(button)).toBe(true)
    expect(row.querySelector('.mode-card-pinyin')).not.toBeNull()
    expect(row.querySelector('.pronunciation-button--compact')).not.toBeNull()
    expect(button.type).toBe('button')
    expect(button.getAttribute('aria-label')).toBe('발음 듣기')
    fire(() => button.click())
    expect(pronunciation.replay).toHaveBeenCalledTimes(1)
    expect(onJudged).not.toHaveBeenCalled()
    unmount()
  })

  it('병음이 없어도 발음 버튼 영역을 유지한다', () => {
    const pronunciation = createPronunciation()
    const { container, unmount } = renderCard({ pinyin: '' }, 'zh', pronunciation)
    fire(() => (container.querySelector('.flip-reveal-button') as HTMLButtonElement).click())
    fire(() => transitionEnd(container.querySelector('.flip-card')!, 'transform'))
    expect(container.querySelector('.mode-card-pinyin')).toBeNull()
    expect(container.querySelector('.mode-card-pinyin-area')).not.toBeNull()
    expect(container.querySelector('.pinyin-speaker--no-pinyin')).not.toBeNull()
    expect(container.querySelector('.pronunciation-button__control')).not.toBeNull()
    unmount()
  })

  it('generic/off에서는 버튼과 발음 호출이 없고 기존 판정 focus fallback을 유지한다', () => {
    const pronunciation = createPronunciation()
    const { container, unmount } = renderCard({}, 'generic', pronunciation)
    const front = container.querySelector('.flip-reveal-button') as HTMLButtonElement
    front.focus()
    fire(() => front.click())
    fire(() => transitionEnd(container.querySelector('.flip-card')!, 'transform'))
    expect(container.querySelector('.pronunciation-button__control')).toBeNull()
    expect(pronunciation.prepare).not.toHaveBeenCalled()
    expect(pronunciation.reveal).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(container.querySelector('.judge--x'))
    unmount()
  })

  it('빠른 판정 뒤 늦은 완료가 reveal을 호출하지 않는다', () => {
    const pronunciation = createPronunciation()
    const { container, onJudged, unmount } = renderCard({}, 'zh', pronunciation)
    const front = container.querySelector('.flip-reveal-button') as HTMLButtonElement
    fire(() => front.click())
    fire(() => (container.querySelector('.judge--o') as HTMLButtonElement).click())
    fire(() => transitionEnd(container.querySelector('.flip-card')!, 'transform'))
    fire(() => vi.runAllTimers())
    expect(onJudged).toHaveBeenCalledTimes(1)
    expect(pronunciation.reveal).not.toHaveBeenCalled()
    unmount()
  })
})
