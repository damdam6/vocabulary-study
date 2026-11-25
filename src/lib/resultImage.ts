/**
 * 세션 결과를 PNG 한 장으로 그린다(design-prd §5). 화면에 보이는 부분만이 아니라 전체
 * 목록을 담아야 해서 DOM 캡처가 아닌 canvas 2D로 직접 그린다 — 라이브러리 없이
 * iOS Safari에서도 같은 결과가 나오고, 웹폰트도 document.fonts로 먼저 불러온 뒤 쓴다.
 * 레이아웃 수치는 결과 화면 CSS(.result-*)와 맞춘 CSS px이며 SCALE 배로 그린다.
 */

import { formatHomeDate } from "./date.ts";
import { headwordLang, modeChipLabel } from "./contentLabels.ts";
import type { ContentType } from "./api.ts";
import {
  formatResultTime,
  isSelfJudgedWrong,
  visibleAnswer,
  wrapText,
  type NumberedResult,
  type ResultSummary,
} from "./sessionResults.ts";

export interface ResultImageInput {
  summary: ResultSummary;
  contentType: ContentType;
  profileName: string;
  completedAt: Date;
}

const SCALE = 2;
const WIDTH = 390;
const PAD = 20;
const CARD_X = PAD;
const CARD_W = WIDTH - PAD * 2;

const COLOR = {
  bg: "#10131a",
  card: "#171b24",
  panel: "#181c26",
  border: "rgba(255,255,255,0.07)",
  divider: "rgba(255,255,255,0.08)",
  text: "#e8ebf2",
  sub: "#b4bac8",
  muted: "#8b93a5",
  accentLight: "#7ea4f7",
  reviewBg: "rgba(47,99,230,0.16)",
  green: "#3fce8f",
  greenBg: "rgba(63,206,143,0.13)",
  red: "#f0655a",
  redBg: "rgba(240,101,90,0.13)",
};

const KR = "'Noto Sans KR', -apple-system, 'Apple SD Gothic Neo', sans-serif";
const SC = "'Noto Sans SC', 'Noto Sans KR', sans-serif";

type Paint = (ctx: CanvasRenderingContext2D) => void;

function font(weight: number, size: number, family: string): string {
  return `${weight} ${size}px ${family}`;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function card(x: number, y: number, w: number, h: number, r: number): Paint {
  return (ctx) => {
    roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, r);
    ctx.fillStyle = COLOR.card;
    ctx.fill();
    ctx.strokeStyle = COLOR.border;
    ctx.lineWidth = 1;
    ctx.stroke();
  };
}

function text(value: string, x: number, y: number, fontSpec: string, color: string, align: CanvasTextAlign = "left"): Paint {
  return (ctx) => {
    ctx.font = fontSpec;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = "top";
    ctx.fillText(value, x, y);
  };
}

function markIcon(cx: number, cy: number, correct: boolean): Paint {
  return (ctx) => {
    ctx.beginPath();
    ctx.arc(cx, cy, 15, 0, Math.PI * 2);
    ctx.fillStyle = correct ? COLOR.greenBg : COLOR.redBg;
    ctx.fill();
    ctx.strokeStyle = correct ? COLOR.green : COLOR.red;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    if (correct) {
      ctx.lineWidth = 2.4;
      ctx.moveTo(cx - 5.5, cy + 0.3);
      ctx.lineTo(cx - 1.8, cy + 4);
      ctx.lineTo(cx + 5.8, cy - 4.2);
    } else {
      ctx.lineWidth = 2.4;
      ctx.moveTo(cx - 4.5, cy - 4.5);
      ctx.lineTo(cx + 4.5, cy + 4.5);
      ctx.moveTo(cx + 4.5, cy - 4.5);
      ctx.lineTo(cx - 4.5, cy + 4.5);
    }
    ctx.stroke();
  };
}

interface Layout {
  height: number;
  paints: Paint[];
}

function measureWith(ctx: CanvasRenderingContext2D, fontSpec: string) {
  return (value: string) => {
    ctx.font = fontSpec;
    return ctx.measureText(value).width;
  };
}

function layoutRow(
  ctx: CanvasRenderingContext2D,
  item: NumberedResult,
  top: number,
  contentType: ContentType,
): Layout {
  const paints: Paint[] = [];
  const headFamily = headwordLang(contentType) ? SC : KR;
  const bodyX = CARD_X + 14 + 30 + 12;
  const numText = String(item.num);
  const numFont = font(400, 12, KR);
  const numWidth = measureWith(ctx, numFont)(numText);
  const bodyW = CARD_X + CARD_W - 14 - numWidth - 10 - bodyX;

  let y = top + 14;
  const headFont = font(500, 20, headFamily);
  for (const line of wrapText(item.word.hanzi, bodyW, measureWith(ctx, headFont))) {
    paints.push(text(line, bodyX, y + 1, headFont, COLOR.text));
    y += 27;
  }
  if (item.word.pinyin.trim() !== "") {
    const pinyinFont = font(400, 13, KR);
    for (const line of wrapText(item.word.pinyin, bodyW, measureWith(ctx, pinyinFont))) {
      paints.push(text(line, bodyX, y, pinyinFont, COLOR.accentLight));
      y += 19;
    }
  }
  y += 2;
  const meaningFont = font(400, 14, KR);
  for (const line of wrapText(item.word.meaning, bodyW, measureWith(ctx, meaningFont))) {
    paints.push(text(line, bodyX, y, meaningFont, COLOR.sub));
    y += 20;
  }

  const answer = visibleAnswer(item);
  if (answer !== null) {
    y += 4;
    const labelFont = font(400, 12, KR);
    const labelW = measureWith(ctx, labelFont)("내 답");
    paints.push(text("내 답", bodyX, y + 4, labelFont, COLOR.muted));
    const answerFont = font(400, 15, headFamily);
    const answerX = bodyX + labelW + 8;
    const measureAnswer = measureWith(ctx, answerFont);
    for (const line of wrapText(answer, bodyX + bodyW - answerX, measureAnswer)) {
      const lineY = y;
      const lineW = measureAnswer(line);
      paints.push(text(line, answerX, lineY, answerFont, COLOR.red));
      paints.push((c) => {
        c.strokeStyle = COLOR.red;
        c.lineWidth = 1.5;
        c.beginPath();
        c.moveTo(answerX, lineY + 11);
        c.lineTo(answerX + lineW, lineY + 11);
        c.stroke();
      });
      y += 22;
    }
  }

  const chips: Array<{ label: string; review: boolean }> = [];
  if (item.isReview) chips.push({ label: "복습", review: true });
  chips.push({ label: modeChipLabel(contentType, item.mode), review: false });
  if (isSelfJudgedWrong(item)) chips.push({ label: "‘몰랐음’ 선택", review: false });
  y += 6;
  let chipX = bodyX;
  const chipFont = font(500, 11, KR);
  const measureChip = measureWith(ctx, chipFont);
  for (const chip of chips) {
    const w = measureChip(chip.label) + 16;
    if (chipX + w > bodyX + bodyW && chipX !== bodyX) {
      chipX = bodyX;
      y += 26;
    }
    const x = chipX;
    const chipY = y;
    paints.push((c) => {
      roundRect(c, x, chipY, w, 20, 10);
      c.fillStyle = chip.review ? COLOR.reviewBg : COLOR.panel;
      c.fill();
      if (!chip.review) {
        c.strokeStyle = COLOR.border;
        c.lineWidth = 1;
        c.stroke();
      }
    });
    paints.push(text(chip.label, x + 8, chipY + 3.5, chipFont, chip.review ? COLOR.accentLight : COLOR.muted));
    chipX += w + 6;
  }
  y += 20;

  const height = Math.max(y - top + 13, 14 + 30 + 13);
  return {
    height,
    paints: [
      card(CARD_X, top, CARD_W, height, 14),
      markIcon(CARD_X + 14 + 15, top + 14 + 16, item.correct),
      text(numText, CARD_X + CARD_W - 14, top + 18, numFont, COLOR.muted, "right"),
      ...paints,
    ],
  };
}

function layout(ctx: CanvasRenderingContext2D, input: ResultImageInput): Layout {
  const { summary, contentType } = input;
  const paints: Paint[] = [];
  let y = 28;

  paints.push(text("세션 결과", PAD, y, font(700, 22, KR), COLOR.text));
  y += 34;
  paints.push(text(`${formatHomeDate(input.completedAt)} · ${input.profileName}`, PAD, y, font(400, 13, KR), COLOR.muted));
  y += 19 + 16;

  // 요약 카드 — 정답률 · 정답/오답 수 · 비율 막대
  const allCorrect = summary.total > 0 && summary.wrong === 0;
  const cardTop = y;
  const cardH = allCorrect ? 142 : 108;
  paints.push(card(CARD_X, cardTop, CARD_W, cardH, 15));
  const innerX = CARD_X + 18;
  const innerR = CARD_X + CARD_W - 18;
  paints.push(text("정답률", innerX, cardTop + 16, font(400, 12, KR), COLOR.muted));
  const rateFont = font(700, 34, KR);
  const rateText = String(summary.rate);
  const rateW = measureWith(ctx, rateFont)(rateText);
  paints.push(text(rateText, innerX, cardTop + 33, rateFont, allCorrect ? COLOR.green : COLOR.text));
  paints.push(text("%", innerX + rateW + 2, cardTop + 47, font(700, 18, KR), COLOR.muted));

  const statFont = font(700, 24, KR);
  const wrongCenter = innerR - 18;
  const correctCenter = wrongCenter - 58;
  paints.push(text(String(summary.correct), correctCenter, cardTop + 28, statFont, COLOR.green, "center"));
  paints.push(text("정답", correctCenter, cardTop + 62, font(400, 12, KR), COLOR.muted, "center"));
  paints.push(text(String(summary.wrong), wrongCenter, cardTop + 28, statFont, summary.wrong === 0 ? COLOR.muted : COLOR.red, "center"));
  paints.push(text("오답", wrongCenter, cardTop + 62, font(400, 12, KR), COLOR.muted, "center"));
  paints.push((c) => {
    c.fillStyle = COLOR.divider;
    c.fillRect((correctCenter + wrongCenter) / 2, cardTop + 30, 1, 46);
  });

  const barY = cardTop + 86;
  const barW = innerR - innerX;
  paints.push((c) => {
    if (summary.total === 0) return;
    const gap = summary.correct > 0 && summary.wrong > 0 ? 3 : 0;
    const greenW = ((barW - gap) * summary.correct) / summary.total;
    if (greenW > 0) {
      roundRect(c, innerX, barY, greenW, 6, 3);
      c.fillStyle = COLOR.green;
      c.fill();
    }
    const redW = barW - gap - greenW;
    if (redW > 0) {
      roundRect(c, innerX + greenW + gap, barY, redW, 6, 3);
      c.fillStyle = COLOR.red;
      c.fill();
    }
  });
  if (allCorrect) paints.push(text("이번 세션은 모두 맞혔어요.", innerX, barY + 20, font(400, 14, KR), COLOR.sub));
  y = cardTop + cardH;

  const section = (title: string, color: string, items: NumberedResult[]) => {
    if (items.length === 0) return;
    y += 22;
    const titleFont = font(700, 15, KR);
    const measureTitle = measureWith(ctx, titleFont);
    const dotY = y + 11;
    paints.push((c) => {
      c.beginPath();
      c.arc(PAD + 4, dotY, 4, 0, Math.PI * 2);
      c.fillStyle = color;
      c.fill();
    });
    paints.push(text(title, PAD + 16, y + 1, titleFont, COLOR.text));
    paints.push(text(String(items.length), PAD + 16 + measureTitle(title) + 8, y + 1, titleFont, color));
    y += 32;
    items.forEach((item, index) => {
      if (index > 0) y += 8;
      const row = layoutRow(ctx, item, y, contentType);
      paints.push(...row.paints);
      y += row.height;
    });
  };
  section("틀린 문제", COLOR.red, summary.wrongItems);
  section("맞힌 문제", COLOR.green, summary.correctItems);

  y += 22;
  const footerY = y;
  paints.push((c) => {
    c.fillStyle = "rgba(255,255,255,0.06)";
    c.fillRect(PAD, footerY, CARD_W, 1);
  });
  paints.push(text("단어 암기", PAD, footerY + 12, font(400, 12, KR), COLOR.muted));
  paints.push(text(`${summary.total}문제 · ${formatResultTime(input.completedAt)}`, PAD + CARD_W, footerY + 12, font(400, 12, KR), COLOR.muted, "right"));
  y = footerY + 12 + 18 + 24;

  return { height: Math.ceil(y), paints };
}

/** 그리기 전에 쓸 글리프의 웹폰트를 받아 둔다. 실패해도 시스템 폰트로 그린다. */
async function loadFonts(input: ResultImageInput): Promise<void> {
  const fonts = typeof document === "undefined" ? undefined : document.fonts;
  if (!fonts) return;
  const items = [...input.summary.wrongItems, ...input.summary.correctItems];
  const headwords = items.map((item) => `${item.word.hanzi}${item.answer ?? ""}`).join("");
  const korean = `세션결과정답률오답맞힌틀린문제내답복습몰랐음선택단어암기${input.profileName}${items.map((item) => item.word.meaning).join("")}`;
  try {
    await Promise.all([
      fonts.load(font(700, 22, "'Noto Sans KR'"), korean),
      fonts.load(font(500, 11, "'Noto Sans KR'"), korean),
      fonts.load(font(400, 14, "'Noto Sans KR'"), korean),
      ...(headwordLang(input.contentType) ? [fonts.load(font(500, 20, "'Noto Sans SC'"), headwords), fonts.load(font(400, 15, "'Noto Sans SC'"), headwords)] : []),
    ]);
  } catch {
    // CDN 실패 — 폴백 폰트로 그린다(design-prd §1.2).
  }
}

/** 결과 이미지를 PNG Blob으로 만든다. */
export async function renderResultImage(input: ResultImageInput): Promise<Blob> {
  await loadFonts(input);
  const canvas = document.createElement("canvas");
  const measureCtx = canvas.getContext("2d");
  if (!measureCtx) throw new Error("canvas를 사용할 수 없습니다");
  const { height, paints } = layout(measureCtx, input);

  canvas.width = WIDTH * SCALE;
  canvas.height = height * SCALE;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(SCALE, SCALE);
  ctx.fillStyle = COLOR.bg;
  ctx.fillRect(0, 0, WIDTH, height);
  for (const paint of paints) paint(ctx);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("이미지를 만들지 못했습니다"))), "image/png");
  });
}

export type SaveOutcome = "shared" | "downloaded" | "cancelled";

/**
 * 휴대폰(굵은 포인터)에서는 공유 시트로 넘겨 사진첩에 저장할 수 있게 하고, 공유를 못 쓰면
 * 파일로 내려받는다. 사용자가 공유 시트를 닫으면 cancelled — 오류가 아니다.
 */
export async function saveResultImage(blob: Blob, fileName: string): Promise<SaveOutcome> {
  const file = new File([blob], fileName, { type: "image/png" });
  const prefersShare = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
  if (prefersShare && typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return "shared";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
      // NotAllowedError 등 — 아래 내려받기로 대신한다.
    }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return "downloaded";
}
