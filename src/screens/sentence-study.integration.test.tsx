// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../worker/lib/google-auth.ts", () => ({ getAccessToken: async () => "test-token" }));
vi.mock("../hooks/usePronunciation.ts", () => ({
  usePronunciation: () => ({ pronunciation: undefined, stop: vi.fn() }),
}));

import fixturesSource from "../../tests/fixtures/chinese-sentence-registration.json?raw";
import worker from "../../worker/index.ts";
import { makeEnv, type WorkerRequest } from "../../worker/test-utils.ts";
import { fire, flush, renderComponent } from "../test-utils.tsx";
import { gradeMode2 } from "../lib/studySession.ts";
import { fetchWords } from "../lib/wordsApi.ts";
import { registerWords } from "../lib/registerApi.ts";
import {
  classifyRegistrationRows,
  parseRegistrationInput,
  validateRegistrationInput,
  type ParsedWord,
} from "../lib/registerValidation.ts";
import {
  RETRY_QUEUE_STORAGE_KEY,
  type RetryQueueEntry,
} from "../lib/retryQueue.ts";
import { savePassword, saveProfile, type WordEntry } from "../lib/api.ts";
import StudyScreen from "./StudyScreen.tsx";

const PROFILES = [
  { id: "zh", name: "중국어", password: "pw-zh", sheetId: "sheet-zh", modes: ["m1", "m2"], contentType: "zh" },
  { id: "en", name: "영어", password: "pw-en", sheetId: "sheet-en", modes: ["m1"], contentType: "generic" },
];
const env = makeEnv({ PROFILES: JSON.stringify(PROFILES) });
const ZH_HEADER = ["한자", "병음", "뜻", "모드1", "모드2", "복습"];
const GENERIC_HEADER = ["표제어", "보조 표기", "뜻", "모드1", "모드2", "복습"];

interface SheetState { titles: string[]; rows: Record<string, string[][]> }
interface AppCall { path: string; body: unknown; status: number }
interface FixtureCase {
  id: string;
  contentType: "zh" | "generic";
  words: ParsedWord[];
  accepted: boolean;
  expectedWords?: ParsedWord[];
}

const fixtures = JSON.parse(fixturesSource) as { cases: FixtureCase[] };
let sheets: Record<string, SheetState>;
let appCalls: AppCall[];
let failNext: Record<string, number>;
let unmounts: (() => void)[];

beforeEach(() => {
  localStorage.clear();
  sheets = {
    "sheet-zh": { titles: ["문장", "_정보"], rows: { 문장: [ZH_HEADER], _정보: [["문제수", "60"]] } },
    "sheet-en": { titles: ["표현", "_정보"], rows: { 표현: [GENERIC_HEADER], _정보: [["문제수", "60"]] } },
  };
  appCalls = [];
  failNext = {};
  unmounts = [];
  vi.stubGlobal("fetch", vi.fn(routeFetch));
});

afterEach(() => {
  unmounts.splice(0).forEach((unmount) => unmount());
  vi.unstubAllGlobals();
});

describe("문장 등록 → 조회 → 학습 기록 통합", () => {
  it("같은 공유 fixture 원문을 실제 Worker 등록/조회와 mode1·mode2·복습 기록까지 보존한다", async () => {
    const numberSentence = fixture("number-mixed");
    const semanticMismatch = fixture("semantic-mismatch");
    const rejected = fixture("emoji");
    const existingLong = fixture("long-no-punctuation").expectedWords![0];
    const existingRow = [existingLong.hanzi, existingLong.pinyin, existingLong.meaning, "3", "2", "2026-10-01|7", "기존 기록"];
    sheets["sheet-zh"].rows.문장.push(existingRow);
    const input = JSON.stringify({ version: 1, words: [
      ...numberSentence.words,
      ...semanticMismatch.words,
      ...rejected.words,
    ] });
    const parsed = parseRegistrationInput(input, "zh");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.error);
    const rows = classifyRegistrationRows(parsed.words, new Set(), "zh");
    expect(rows.map(({ status }) => status)).toEqual(["warning", "warning", "blocked"]);
    expect(rows[1].warnings?.[0]).toContain("병음");

    login("zh", "pw-zh");
    const eligible = rows.filter(({ status }) => status !== "blocked").map(toWord);
    const registered = await registerWords({ tab: "문장", words: eligible });
    expect(registered.added).toEqual(eligible);
    expect(sheets["sheet-zh"].rows.문장.slice(1)).toEqual([
      existingRow,
      ...eligible.map(({ hanzi, pinyin, meaning }) => [hanzi, pinyin, meaning]),
    ]);
    expect(rowFor("sheet-zh", "문장", existingLong.hanzi)).toEqual(existingRow);

    const loaded = await fetchWords();
    const word = loaded.words.find(({ hanzi }) => hanzi === "我有2本书。")!;
    expect(word).toMatchObject({ tab: "문장", hanzi: "我有2本书。", pinyin: "wǒ yǒu liǎng běn shū.", meaning: "안녕" });

    await answerMode2(word, "我有2本书", false);
    await vi.waitFor(() => expect(calls("/api/answer")).toHaveLength(1));
    const stored = rowFor("sheet-zh", "문장", word.hanzi);
    expect(stored[4]).toBe("1");
    expect(stored[6]).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}\|m2$/);
    expect(calls("/api/answer")).toHaveLength(1);
    expect(calls("/api/answer")[0].body).toMatchObject({ tab: "문장", hanzi: "我有2本书。", mode: "m2", isReview: false });

    await answerMode1(word);
    await vi.waitFor(() => expect(calls("/api/answer")).toHaveLength(2));
    expect(stored[3]).toBe("1");
    expect(stored[7]).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}\|m1$/);
    expect(calls("/api/answer")).toHaveLength(2);

    const writesBeforeWrong = appCalls.length;
    await answerMode2(word, "我有本书", false);
    expect(appCalls.slice(writesBeforeWrong).filter(({ path }) => path === "/api/answer" || path === "/api/review-fail")).toEqual([]);
    expect(stored[4]).toBe("1");

    stored[3] = "3";
    stored[4] = "3";
    stored[5] = "2026-10-01|7";
    await answerMode2({ ...word, m1: 3, m2: 3, nextReview: "2026-10-01", interval: 7 }, "我没有2本书", true);
    await vi.waitFor(() => expect(calls("/api/review-fail")).toHaveLength(1));
    expect(calls("/api/review-fail")).toHaveLength(1);
    expect(calls("/api/review-fail")[0].body).toEqual({ tab: "문장", hanzi: "我有2本书。" });
    expect(stored[5]).toMatch(/^\d{4}-\d{2}-\d{2}\|3$/);
  });

  it("answer/review-fail 5xx가 학습을 막지 않고 원문 payload를 retry queue에 보존한다", async () => {
    login("zh", "pw-zh");
    const word = await registerAndLoad(fixture("sentence").expectedWords![0]);
    failNext["/api/answer"] = 1;
    await answerMode2(word, "我今天很忙", false);
    await vi.waitFor(() => {
      const queue = JSON.parse(localStorage.getItem(RETRY_QUEUE_STORAGE_KEY) ?? "[]") as RetryQueueEntry[];
      expect(queue).toHaveLength(1);
    });
    failNext["/api/review-fail"] = 1;
    await answerMode2({ ...word, m1: 3, m2: 3, nextReview: "2026-10-01", interval: 7 }, "我今天不忙", true);

    let queue: RetryQueueEntry[] = [];
    await vi.waitFor(() => {
      queue = JSON.parse(localStorage.getItem(RETRY_QUEUE_STORAGE_KEY) ?? "[]") as RetryQueueEntry[];
      expect(queue).toHaveLength(2);
    });
    expect(queue).toHaveLength(2);
    expect(queue[0]).toMatchObject({ kind: "answer", profileId: "zh", record: { tab: "문장", hanzi: "我今天很忙。", mode: "m2" } });
    expect(queue[1]).toEqual({ kind: "review-fail", profileId: "zh", record: { tab: "문장", hanzi: "我今天很忙。" } });
  });

  it("generic은 실제 별도 sheetId에 등록·조회되고 zh 문장부호 완화를 받지 않는다", async () => {
    const generic = fixture("generic-free-text");
    const kitJson = JSON.stringify({
      version: 1,
      contentType: "generic",
      words: generic.words.map(({ hanzi, pinyin, meaning }) => ({ term: hanzi, note: pinyin, meaning })),
    });
    const validation = validateRegistrationInput(kitJson, new Set(), "generic");
    expect(validation.ok).toBe(true);
    if (!validation.ok) throw new Error(validation.error);

    login("en", "pw-en");
    await registerWords({ tab: "표현", words: validation.rows.map(toWord) });
    const loaded = await fetchWords();
    expect(loaded.profile).toMatchObject({ id: "en", contentType: "generic", modes: ["m1"] });
    expect(loaded.words).toContainEqual(expect.objectContaining({ tab: "표현", hanzi: "take off!" }));
    expect(sheets["sheet-zh"].rows.문장).toEqual([ZH_HEADER]);
    expect(gradeMode2("take off", "take off!", "generic").correct).toBe(false);
    expect(gradeMode2("我今天很忙", "我今天很忙。", "zh").correct).toBe(true);
  });
});

function fixture(id: string): FixtureCase {
  const found = fixtures.cases.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`fixture not found: ${id}`);
  return found;
}

function login(id: "zh" | "en", password: string) {
  const profile = PROFILES.find((candidate) => candidate.id === id)!;
  savePassword(password);
  saveProfile({ id: profile.id, name: profile.name, modes: profile.modes as ("m1" | "m2")[], contentType: profile.contentType as "zh" | "generic" });
}

function toWord({ hanzi, pinyin, meaning }: Pick<ParsedWord, "hanzi" | "pinyin" | "meaning">): ParsedWord {
  return { hanzi, pinyin, meaning };
}

async function registerAndLoad(word: ParsedWord): Promise<WordEntry> {
  await registerWords({ tab: "문장", words: [word] });
  const loaded = await fetchWords();
  return loaded.words.find(({ hanzi }) => hanzi === word.hanzi)!;
}

async function answerMode2(word: WordEntry, inputValue: string, isReview: boolean) {
  const rendered = renderComponent(
    <StudyScreen queue={[{ word, mode: "m2", isReview }]} profile={{ id: "zh", name: "중국어", modes: ["m1", "m2"], contentType: "zh" }} tts={{ enabled: false }} onExit={vi.fn()} onComplete={vi.fn()} />,
  );
  unmounts.push(rendered.unmount);
  const input = rendered.container.querySelector<HTMLTextAreaElement>(".mode-input")!;
  fire(() => setInput(input, inputValue));
  fire(() => rendered.container.querySelector<HTMLButtonElement>("button[type=submit]")!.click());
  await flush();
}

async function answerMode1(word: WordEntry) {
  const rendered = renderComponent(
    <StudyScreen queue={[{ word, mode: "m1", isReview: false }]} profile={{ id: "zh", name: "중국어", modes: ["m1", "m2"], contentType: "zh" }} tts={{ enabled: false }} onExit={vi.fn()} onComplete={vi.fn()} />,
  );
  unmounts.push(rendered.unmount);
  fire(() => rendered.container.querySelector<HTMLButtonElement>(".flip-reveal-button")!.click());
  fire(() => rendered.container.querySelector<HTMLButtonElement>(".judge--o")!.click());
  await flush();
}

function setInput(input: HTMLTextAreaElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function calls(path: string): AppCall[] {
  return appCalls.filter((call) => call.path === path);
}

function rowFor(sheetId: string, tab: string, hanzi: string): string[] {
  const row = sheets[sheetId].rows[tab].find((candidate) => candidate[0] === hanzi);
  if (!row) throw new Error(`row not found: ${sheetId}/${tab}/${hanzi}`);
  return row;
}

async function routeFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (raw.startsWith("/api/")) {
    const request = new Request(`https://app.test${raw}`, init) as WorkerRequest;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const path = new URL(request.url).pathname;
    if ((failNext[path] ?? 0) > 0) {
      failNext[path] -= 1;
      const response = Response.json({ error: "injected failure" }, { status: 503 });
      appCalls.push({ path, body, status: response.status });
      return response;
    }
    const response = await worker.fetch(request, env);
    appCalls.push({ path, body, status: response.status });
    return response;
  }
  return sheetsFetch(raw, init);
}

async function sheetsFetch(url: string, init?: RequestInit): Promise<Response> {
  const method = init?.method ?? "GET";
  const sheetId = url.match(/\/spreadsheets\/([^/:?]+)/)?.[1] ?? "";
  const state = sheets[sheetId];
  if (!state) return new Response("sheet not found", { status: 404 });
  if (method === "GET" && url.includes("?fields=")) {
    return Response.json({ sheets: state.titles.map((title) => ({ properties: { title } })) });
  }
  if (method === "POST" && url.includes("/values:batchUpdate")) {
    const body = JSON.parse(String(init?.body)) as { data: { range: string; values: (string | number)[][] }[] };
    for (const update of body.data) {
      const { tab, range } = parseFullRange(update.range);
      writeRange(state.rows, tab, range, update.values.map((row) => row.map(String)));
    }
    return Response.json({ totalUpdatedCells: body.data.length });
  }
  const { tab, range } = parseValuesUrl(url);
  if (!state.titles.includes(tab)) return new Response("Unable to parse range", { status: 400 });
  if (method === "GET") return Response.json({ values: sliceRange(state.rows[tab] ?? [], range) });
  if (method === "PUT") {
    const values = (JSON.parse(String(init?.body)) as { values: (string | number)[][] }).values;
    writeRange(state.rows, tab, range, values.map((row) => row.map(String)));
    return Response.json({ updatedRange: range });
  }
  throw new Error(`unhandled Sheets request: ${method} ${url}`);
}

function parseValuesUrl(url: string): { tab: string; range: string } {
  const encoded = url.split("/values/")[1]?.split("?")[0];
  if (!encoded) throw new Error(`missing values range: ${url}`);
  return parseFullRange(decodeURIComponent(encoded));
}

function parseFullRange(value: string): { tab: string; range: string } {
  const match = value.match(/^'((?:''|[^'])*)'!(.+)$/);
  if (!match) throw new Error(`invalid range: ${value}`);
  return { tab: match[1].replaceAll("''", "'"), range: match[2] };
}

function sliceRange(rows: string[][], range: string): string[][] {
  if (range === "1:1") return rows[0] ? [rows[0]] : [];
  if (range === "A:B") return rows.map((row) => row.slice(0, 2));
  if (range === "A2:A") return rows.slice(1).filter((row) => row[0]).map((row) => [row[0]]);
  if (range === "A2:F") return rows.slice(1).map((row) => row.slice(0, 6));
  const wholeRow = range.match(/^(\d+):(\d+)$/);
  if (wholeRow) return rows.slice(Number(wholeRow[1]) - 1, Number(wholeRow[2]));
  throw new Error(`unsupported read range: ${range}`);
}

function writeRange(rowsByTab: Record<string, string[][]>, tab: string, range: string, values: string[][]) {
  const rows = (rowsByTab[tab] ??= []);
  const match = range.match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/);
  if (!match) throw new Error(`unsupported write range: ${range}`);
  const startColumn = columnIndex(match[1]);
  const startRow = Number(match[2]) - 1;
  values.forEach((valuesRow, rowOffset) => {
    const row = (rows[startRow + rowOffset] ??= []);
    valuesRow.forEach((value, columnOffset) => { row[startColumn + columnOffset] = value; });
  });
}

function columnIndex(letters: string): number {
  return Array.from(letters).reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}
