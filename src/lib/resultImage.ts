/**
 * 시험 결과를 PNG로 그린다(design-prd §5.1). 화면에 보이는 부분만이 아니라 전체 목록을
 * 담아야 해서 DOM 캡처가 아닌 canvas 2D로 직접 그린다 — 라이브러리 없이 브라우저마다
 * 같은 결과가 나오고, 웹폰트도 document.fonts로 먼저 불러온 뒤 쓴다.
 *
 * 세션은 수백 문제까지 갈 수 있어 화면의 카드 대신 촘촘한 표(문제당 한두 줄)로 그리고,
 * ITEMS_PER_IMAGE개씩 여러 장으로 나눈다 — 브라우저의 canvas 크기 한계(크롬 세로 약
 * 65k px, iOS 면적 약 16.7M px)를 넘지 않게. 요약 카드는 첫 장에만 넣는다.
 * 수치는 CSS px이며 SCALE 배로 그린다.
 */

import { formatHomeDate } from "./date.ts";
import { headwordLang } from "./contentLabels.ts";
import type { ContentType } from "./api.ts";
import {
  formatResultTime,
  paginateResults,
  resultImageFileName,
  visibleAnswer,
  wrapText,
  type NumberedResult,
  type ResultPage,
  type ResultSummary,
} from "./sessionResults.ts";

export interface ResultImageInput {
  summary: ResultSummary;
  contentType: ContentType;
  profileName: string;
  completedAt: Date;
}

const SCALE = 2;
/** 한 장이 아주 길어져도(긴 문장이 몰린 경우) 그릴 수 있게 배율을 낮추는 기준. */
const MAX_SIDE = 32_000;
const MAX_AREA = 16_000_000;
const WIDTH = 390;
const PAD = 20;
const CARD_X = PAD;
const CARD_W = WIDTH - PAD * 2;

const COLOR = {
  bg: "#10131a",
  card: "#171b24",
  border: "rgba(255,255,255,0.07)",
  divider: "rgba(255,255,255,0.08)",
  rowLine: "rgba(255,255,255,0.06)",
  text: "#e8ebf2",
  sub: "#b4bac8",
  muted: "#8b93a5",
  accentLight: "#7ea4f7",
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
    ctx.arc(cx, cy, 9, 0, Math.PI * 2);
    ctx.fillStyle = correct ? COLOR.greenBg : COLOR.redBg;
    ctx.fill();
    ctx.strokeStyle = correct ? COLOR.green : COLOR.red;
    ctx.lineWidth = 1.8;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    if (correct) {
      ctx.moveTo(cx - 3.4, cy + 0.2);
      ctx.lineTo(cx - 1.1, cy + 2.5);
      ctx.lineTo(cx + 3.6, cy - 2.6);
    } else {
      ctx.moveTo(cx - 2.8, cy - 2.8);
      ctx.lineTo(cx + 2.8, cy + 2.8);
      ctx.moveTo(cx + 2.8, cy - 2.8);
      ctx.lineTo(cx - 2.8, cy + 2.8);
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

// 표 한 행: [정오] [표제어 / 보조 표기] [뜻 / 내 답]
const ROW_PAD_X = 12;
const ROW_PAD_Y = 9;
const MARK_X = CARD_X + ROW_PAD_X;
const LEFT_X = MARK_X + 18 + 10;
const LEFT_W = 128;
const RIGHT_X = LEFT_X + LEFT_W + 12;
const RIGHT_W = CARD_X + CARD_W - ROW_PAD_X - RIGHT_X;

function layoutRow(ctx: CanvasRenderingContext2D, item: NumberedResult, top: number, contentType: ContentType): Layout {
  const paints: Paint[] = [];
  const headFamily = headwordLang(contentType) ? SC : KR;

  let left = top + ROW_PAD_Y;
  const headFont = font(500, 16, headFamily);
  for (const line of wrapText(item.word.hanzi, LEFT_W, measureWith(ctx, headFont))) {
    paints.push(text(line, LEFT_X, left, headFont, COLOR.text));
    left += 22;
  }
  if (item.word.pinyin.trim() !== "") {
    const pinyinFont = font(400, 11, KR);
    for (const line of wrapText(item.word.pinyin, LEFT_W, measureWith(ctx, pinyinFont))) {
      paints.push(text(line, LEFT_X, left, pinyinFont, COLOR.accentLight));
      left += 15;
    }
  }

  let right = top + ROW_PAD_Y + 3;
  const meaningFont = font(400, 13, KR);
  for (const line of wrapText(item.word.meaning, RIGHT_W, measureWith(ctx, meaningFont))) {
    paints.push(text(line, RIGHT_X, right, meaningFont, COLOR.sub));
    right += 18;
  }
  const answer = visibleAnswer(item);
  if (answer !== null) {
    right += 2;
    const labelFont = font(400, 11, KR);
    const labelW = measureWith(ctx, labelFont)("내 답");
    paints.push(text("내 답", RIGHT_X, right + 2, labelFont, COLOR.muted));
    const answerFont = font(400, 13, headFamily);
    const answerX = RIGHT_X + labelW + 6;
    const measureAnswer = measureWith(ctx, answerFont);
    for (const line of wrapText(answer, RIGHT_X + RIGHT_W - answerX, measureAnswer)) {
      const lineY = right;
      const lineW = measureAnswer(line);
      paints.push(text(line, answerX, lineY, answerFont, COLOR.red));
      paints.push((c) => {
        c.strokeStyle = COLOR.red;
        c.lineWidth = 1.2;
        c.beginPath();
        c.moveTo(answerX, lineY + 9.5);
        c.lineTo(answerX + lineW, lineY + 9.5);
        c.stroke();
      });
      right += 18;
    }
  }

  const height = Math.max(left, right, top + ROW_PAD_Y + 22) - top + ROW_PAD_Y;
  return { height, paints: [markIcon(MARK_X + 9, top + ROW_PAD_Y + 11, item.correct), ...paints] };
}

function layoutSummary(ctx: CanvasRenderingContext2D, summary: ResultSummary, top: number): Layout {
  const paints: Paint[] = [];
  const allCorrect = summary.total > 0 && summary.wrong === 0;
  const cardH = allCorrect ? 142 : 108;
  paints.push(card(CARD_X, top, CARD_W, cardH, 15));
  const innerX = CARD_X + 18;
  const innerR = CARD_X + CARD_W - 18;
  paints.push(text("정답률", innerX, top + 16, font(400, 12, KR), COLOR.muted));
  const rateFont = font(700, 34, KR);
  const rateText = String(summary.rate);
  const rateW = measureWith(ctx, rateFont)(rateText);
  paints.push(text(rateText, innerX, top + 33, rateFont, allCorrect ? COLOR.green : COLOR.text));
  paints.push(text("%", innerX + rateW + 2, top + 47, font(700, 18, KR), COLOR.muted));

  const statFont = font(700, 24, KR);
  const wrongCenter = innerR - 18;
  const correctCenter = wrongCenter - 58;
  paints.push(text(String(summary.correct), correctCenter, top + 28, statFont, COLOR.green, "center"));
  paints.push(text("정답", correctCenter, top + 62, font(400, 12, KR), COLOR.muted, "center"));
  paints.push(text(String(summary.wrong), wrongCenter, top + 28, statFont, summary.wrong === 0 ? COLOR.muted : COLOR.red, "center"));
  paints.push(text("오답", wrongCenter, top + 62, font(400, 12, KR), COLOR.muted, "center"));
  paints.push((c) => {
    c.fillStyle = COLOR.divider;
    c.fillRect((correctCenter + wrongCenter) / 2, top + 30, 1, 46);
  });

  const barY = top + 86;
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
  return { height: cardH, paints };
}

function layoutPage(ctx: CanvasRenderingContext2D, input: ResultImageInput, page: ResultPage): Layout {
  const { summary, contentType } = input;
  const paints: Paint[] = [];
  let y = 28;

  paints.push(text("세션 결과", PAD, y, font(700, 22, KR), COLOR.text));
  if (page.pageCount > 1) {
    paints.push(text(`${page.page} / ${page.pageCount}`, PAD + CARD_W, y + 6, font(500, 14, KR), COLOR.muted, "right"));
  }
  y += 34;
  paints.push(text(`${formatHomeDate(input.completedAt)} · ${input.profileName}`, PAD, y, font(400, 13, KR), COLOR.muted));
  y += 19 + 16;

  if (page.page === 1) {
    const summaryLayout = layoutSummary(ctx, summary, y);
    paints.push(...summaryLayout.paints);
    y += summaryLayout.height;
  }

  page.blocks.forEach((block, blockIndex) => {
    y += page.page === 1 || blockIndex > 0 ? 22 : 0;
    const wrong = block.kind === "wrong";
    const color = wrong ? COLOR.red : COLOR.green;
    const title = wrong ? "틀린 문제" : "맞힌 문제";
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
    const countText = String(wrong ? summary.wrong : summary.correct);
    const countX = PAD + 16 + measureTitle(title) + 8;
    paints.push(text(countText, countX, y + 1, titleFont, color));
    if (block.continued) {
      paints.push(text("(이어서)", countX + measureTitle(countText) + 6, y + 3, font(400, 13, KR), COLOR.muted));
    }
    y += 32;

    const cardTop = y;
    const rowPaints: Paint[] = [];
    block.items.forEach((item, index) => {
      if (index > 0) {
        const lineY = y;
        rowPaints.push((c) => {
          c.fillStyle = COLOR.rowLine;
          c.fillRect(CARD_X + ROW_PAD_X, lineY, CARD_W - ROW_PAD_X * 2, 1);
        });
      }
      const row = layoutRow(ctx, item, y, contentType);
      rowPaints.push(...row.paints);
      y += row.height;
    });
    paints.push(card(CARD_X, cardTop, CARD_W, y - cardTop, 14), ...rowPaints);
  });

  y += 22;
  const footerY = y;
  paints.push((c) => {
    c.fillStyle = COLOR.rowLine;
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
  const korean = `세션결과정답률오답맞힌틀린문제내답이어서단어암기${input.profileName}${items.map((item) => item.word.meaning).join("")}`;
  try {
    await Promise.all([
      fonts.load(font(700, 22, "'Noto Sans KR'"), korean),
      fonts.load(font(500, 14, "'Noto Sans KR'"), korean),
      fonts.load(font(400, 13, "'Noto Sans KR'"), korean),
      ...(headwordLang(input.contentType)
        ? [fonts.load(font(500, 16, "'Noto Sans SC'"), headwords), fonts.load(font(400, 13, "'Noto Sans SC'"), headwords)]
        : []),
    ]);
  } catch {
    // CDN 실패 — 폴백 폰트로 그린다(design-prd §1.2).
  }
}

function drawPage(input: ResultImageInput, page: ResultPage): Promise<Blob> {
  const canvas = document.createElement("canvas");
  const measureCtx = canvas.getContext("2d");
  if (!measureCtx) throw new Error("canvas를 사용할 수 없습니다");
  const { height, paints } = layoutPage(measureCtx, input, page);

  const scale = Math.min(SCALE, MAX_SIDE / height, Math.sqrt(MAX_AREA / (WIDTH * height)));
  canvas.width = Math.round(WIDTH * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);
  ctx.fillStyle = COLOR.bg;
  ctx.fillRect(0, 0, WIDTH, height);
  for (const paint of paints) paint(ctx);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("이미지를 만들지 못했습니다"))), "image/png");
  });
}

export interface ResultImageFile {
  blob: Blob;
  fileName: string;
}

/** 결과 이미지를 장별 PNG로 만든다. 문제가 ITEMS_PER_IMAGE개 이하면 한 장. */
export async function renderResultImages(input: ResultImageInput): Promise<ResultImageFile[]> {
  await loadFonts(input);
  const files: ResultImageFile[] = [];
  for (const page of paginateResults(input.summary)) {
    files.push({
      blob: await drawPage(input, page),
      fileName: resultImageFileName(input.completedAt, page.page, page.pageCount),
    });
  }
  return files;
}

function download(file: ResultImageFile) {
  const url = URL.createObjectURL(file.blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * PNG 파일로 내려받는다. 여러 장이면 간격을 두고 차례로 받는다 — 크롬은 두 번째 파일부터
 * "여러 파일 다운로드" 허용을 한 번 묻는다.
 */
export async function saveResultImages(files: readonly ResultImageFile[]): Promise<void> {
  for (const [index, file] of files.entries()) {
    if (index > 0) await new Promise((resolve) => setTimeout(resolve, 300));
    download(file);
  }
}
