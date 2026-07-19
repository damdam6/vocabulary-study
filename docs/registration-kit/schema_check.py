#!/usr/bin/env python3
"""Schema validator for the vocaStudy word-extraction output.

Schema source of truth: docs/plans/word-registration-system.md §3 (this repo).
Any change to the schema must land there first; this file follows it.

Expected input (JSON, via file argument or stdin):

    {
      "version": 1,
      "words": [
        { "hanzi": "经济", "pinyin": "jīngjì", "meaning": "경제" }
      ]
    }

Checks: required fields, hanzi Unicode range, pinyin tone-mark format
(numeric tones rejected), duplicate hanzi within the array.

Runs on the Python standard library only, so it works as-is in the
claude.ai code-execution sandbox. Exit code 0 = PASS, 1 = FAIL.
"""

import json
import re
import sys

# CJK Unified Ideographs, basic block only — matches src/lib/registerValidation.ts
# HANZI_RE and worker/lib/register.ts HANZI_RE (schema source: word-registration-system.md
# §3, no-drift fix #57). Extension A (U+3400-U+4DBF) is deliberately excluded even
# though it used to be allowed here: simplified characters are entirely within the
# basic block, and Extension A covers rare historical/name characters that never
# appear in HSK/textbook vocabulary — a hit there almost always means an OCR
# artifact or a traditional-only variant, not a real word.
HANZI_RANGES = ((0x4E00, 0x9FFF),)

TONED_VOWELS = "āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ"
# Standard pinyin never uses the letter 'v' — it is a keyboard stand-in for
# 'ü', which the schema requires spelled out.
PLAIN_ALLOWED = "abcdefghijklmnopqrstuwxyzü'’ "
ALLOWED_PINYIN_CHARS = set(TONED_VOWELS + PLAIN_ALLOWED)


def is_hanzi(ch):
    return any(lo <= ord(ch) <= hi for lo, hi in HANZI_RANGES)


def check_word(i, word, seen_hanzi, errors):
    def err(msg):
        errors.append("words[%d]%s: %s" % (i, label, msg))

    if not isinstance(word, dict):
        label = ""
        err("entry must be an object")
        return

    hanzi = word.get("hanzi")
    label = " (%s)" % hanzi if isinstance(hanzi, str) and hanzi else ""

    for field in ("hanzi", "pinyin", "meaning"):
        value = word.get(field)
        if not isinstance(value, str) or not value.strip():
            err("field '%s' is missing, not a string, or empty" % field)
            return

    extra = sorted(set(word) - {"hanzi", "pinyin", "meaning"})
    if extra:
        err("unexpected field(s): %s" % ", ".join(extra))

    bad_chars = [ch for ch in hanzi if not is_hanzi(ch)]
    if bad_chars:
        err("hanzi contains non-CJK character(s): %s"
            % ", ".join("%r (U+%04X)" % (ch, ord(ch)) for ch in bad_chars))

    pinyin = word["pinyin"]
    if re.search(r"\d", pinyin):
        err("pinyin uses numeric tone notation (%r) — use tone marks "
            "(e.g. jīngjì, not jing1ji4)" % pinyin)
    else:
        bad = sorted({ch for ch in pinyin.lower() if ch not in ALLOWED_PINYIN_CHARS})
        if bad:
            err("pinyin contains invalid character(s): %s"
                % ", ".join("%r" % ch for ch in bad))
        elif not any(ch in TONED_VOWELS for ch in pinyin.lower()):
            # Per schema §3 tone marks are mandatory. A word whose every
            # syllable is neutral tone (e.g. 的 "de") would trip this; such
            # words are practically absent from vocabulary lists, so this is
            # an error — escalate to the user if it is genuinely intended.
            err("pinyin %r has no tone mark — tone marks are required" % pinyin)

    if hanzi in seen_hanzi:
        err("duplicate hanzi within this batch (first at words[%d])"
            % seen_hanzi[hanzi])
    else:
        seen_hanzi[hanzi] = i


def strip_code_fence(text):
    text = text.strip()
    match = re.match(r"^```[a-zA-Z]*\n(.*)\n```$", text, re.DOTALL)
    return match.group(1) if match else text


def main():
    if len(sys.argv) > 1:
        with open(sys.argv[1], encoding="utf-8") as f:
            raw = f.read()
    else:
        raw = sys.stdin.read()

    try:
        data = json.loads(strip_code_fence(raw))
    except json.JSONDecodeError as e:
        print("FAIL: input is not valid JSON — %s" % e)
        return 1

    errors = []
    if not isinstance(data, dict):
        errors.append("top level must be an object")
    else:
        if data.get("version") != 1:
            errors.append("'version' must be the number 1 (got %r)"
                          % data.get("version"))
        words = data.get("words")
        if not isinstance(words, list):
            errors.append("'words' must be an array")
        elif not words:
            errors.append("'words' is empty — nothing to register")
        else:
            seen_hanzi = {}
            for i, word in enumerate(words):
                check_word(i, word, seen_hanzi, errors)

    if errors:
        for e in errors:
            print(e)
        print("FAIL: %d error(s)" % len(errors))
        return 1

    print("PASS: %d word(s) validated." % len(data["words"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
