#!/usr/bin/env python3
"""Schema validator for the vocaStudy word-extraction output.

One file, two schemas — the top-level "contentType" field picks which. The
same copy is uploaded to every extraction-kit project (one prompt per
language, one shared validator), because the schemas are content-neutral
while only the prompts are language-specific.

Schema sources of truth (this repo). Any change lands there first; this file
follows it:

    zh       shared/registration.ts / #172 PRD §3
    generic  docs/plans/registration-generalization.md §3.1

Expected input (JSON, via file argument or stdin):

    {                                     {
      "version": 1,                         "version": 1,
      "words": [                            "contentType": "generic",
        { "hanzi": "经济",                   "words": [
          "pinyin": "jīngjì",                 { "term": "take off",
          "meaning": "경제" }                    "note": "구동사",
      ]                                           "meaning": "이륙하다" }
    }                                         ]
                                          }

"contentType" absent means "zh": the Chinese kit predates the field and its
output retains the same version and field names.

Checks, zh: sentence characters, NFC, code-point limits, tone-mark format,
required fields and normalized duplicates. PASS checks format only; it does
not guarantee correct pronunciation. Up to 100 entries per batch.
Checks, generic: term/meaning non-blank, note optional, no extra fields,
duplicate term within the array. No language-specific checks — a generic
term is free text.

Runs on the Python standard library only, so it works as-is in the
claude.ai code-execution sandbox. Exit code 0 = PASS, 1 = FAIL.
"""

import json
import re
import sys
import unicodedata

# Standalone mirror of shared/registration.ts; shared JSON fixtures prevent drift.
MAX_REGISTER_WORDS = 100
MAX_HANZI_CODE_POINTS = 200
MAX_PINYIN_CODE_POINTS = 1000
REGISTRATION_PUNCTUATION = "，。！？；：、,.!?;:（）()【】[]《》〈〉“”‘’「」『』\"'…—-·／/％%＋+＝=．"
TONED_VOWELS = "āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ"
ALLOWED_PINYIN_CHARS = set("abcdefghijklmnopqrstuvwxyzü" + TONED_VOWELS)
SEPARATORS = set(" \u3000" + REGISTRATION_PUNCTUATION)
# ECMAScript String.trim, not Python's broader str.strip set.
JS_WHITESPACE = "\u0009\u000a\u000b\u000c\u000d \u00a0\u1680" + "".join(chr(i) for i in range(0x2000, 0x200B)) + "\u2028\u2029\u202f\u205f\u3000\ufeff"


def is_hanzi(ch):
    return "一" <= ch <= "鿿"


def is_source_character(ch):
    return (is_hanzi(ch) or ch in SEPARATORS or
            any(lo <= ch <= hi for lo, hi in (("A", "Z"), ("a", "z"), ("0", "9"),
                                             ("Ａ", "Ｚ"), ("ａ", "ｚ"), ("０", "９"))))


def normalize_zh_word(word):
    return {field: (value if field == "meaning" else unicodedata.normalize("NFC", value)).strip(JS_WHITESPACE)
            for field, value in word.items() if field in ("hanzi", "pinyin", "meaning")}


def check_word_zh(i, word, seen_hanzi, errors):
    def err(msg):
        errors.append("words[%d]: %s" % (i, msg))

    if not isinstance(word, dict):
        err("entry must be an object")
        return
    extra = sorted(set(word) - {"hanzi", "pinyin", "meaning"})
    if extra:
        err("unexpected field(s): %s" % ", ".join(extra))
    if any(not isinstance(word.get(field), str) for field in ("hanzi", "pinyin", "meaning")):
        err("hanzi, pinyin and meaning must be strings")
        return

    normalized = normalize_zh_word(word)
    for field, value in normalized.items():
        if not value:
            err("field '%s' is empty" % field)
        if field == "meaning":
            continue
        # Inspect NFC input BEFORE trimming so edge controls cannot disappear.
        raw_nfc = unicodedata.normalize("NFC", word[field])
        allowed = is_source_character if field == "hanzi" else lambda ch: ch in SEPARATORS or ch.lower() in ALLOWED_PINYIN_CHARS
        if any(not allowed(ch) for ch in raw_nfc):
            err("field '%s' contains invalid character(s); tabs, newlines and numeric pinyin are not allowed" % field)
        limit = MAX_HANZI_CODE_POINTS if field == "hanzi" else MAX_PINYIN_CODE_POINTS
        if len(value) > limit:
            err("field '%s' exceeds %d Unicode code points" % (field, limit))
    hanzi, pinyin = normalized["hanzi"], normalized["pinyin"]
    if hanzi and not any(is_hanzi(ch) for ch in hanzi):
        err("hanzi must contain at least one CJK character")
    if pinyin and not any(ch in TONED_VOWELS for ch in pinyin.lower()):
        err("pinyin must contain at least one tone mark")
    if hanzi in seen_hanzi:
        err("duplicate hanzi within this batch (first at words[%d])" % seen_hanzi[hanzi])
    else:
        seen_hanzi[hanzi] = i


def check_word_generic(i, word, seen_terms, errors):
    def err(msg):
        errors.append("words[%d]%s: %s" % (i, label, msg))

    if not isinstance(word, dict):
        label = ""
        err("entry must be an object")
        return

    term = word.get("term")
    label = " (%s)" % term if isinstance(term, str) and term.strip() else ""

    # Report everything wrong with this entry in one pass rather than bailing
    # at the first missing field: pasting a zh payload under
    # contentType "generic" is the mistake this kit exists to catch, and it
    # shows up as a missing 'term' *and* an unexpected 'hanzi'. Seeing both at
    # once names the actual problem — one at a time reads like two unrelated
    # typos and costs an extra validator round-trip.
    missing = []
    for field in ("term", "meaning"):
        value = word.get(field)
        if not isinstance(value, str) or not value.strip():
            err("field '%s' is missing, not a string, or empty" % field)
            missing.append(field)

    # 'note' carries column B, which is optional for generic content
    # (registration-generalization.md §3.1) — an omitted or empty note is a
    # blank B cell, which the study screen hides. Only the type is checked.
    if "note" in word and not isinstance(word["note"], str):
        err("field 'note' must be a string when present (got %r) — omit it "
            "for a blank column B" % word["note"])

    extra = sorted(set(word) - {"term", "note", "meaning"})
    if extra:
        err("unexpected field(s): %s" % ", ".join(extra))

    # The duplicate check below is the only one that needs a usable term.
    if missing:
        return

    # Registration trims before writing and rejects duplicates on the trimmed
    # value (worker/lib/register.ts), so compare trimmed here too.
    # Case is significant, matching the sheet-level
    # duplicate rule (registration-generalization.md §3.2).
    key = term.strip()
    if key in seen_terms:
        err("duplicate term within this batch (first at words[%d])"
            % seen_terms[key])
    else:
        seen_terms[key] = i


def resolve_checker(content_type):
    """Map the top-level contentType to its per-entry checker, None if unknown."""
    if content_type == "zh":
        return check_word_zh
    if content_type == "generic":
        return check_word_generic
    return None


def strip_code_fence(text):
    text = text.strip()
    match = re.match(r"^```[a-zA-Z]*\n(.*)\n```$", text, re.DOTALL)
    return match.group(1) if match else text


def validate(data):
    """Return format errors without changing input or promising pronunciation."""
    errors = []
    if not isinstance(data, dict):
        errors.append("top level must be an object")
    else:
        if data.get("version") != 1:
            errors.append("'version' must be the number 1 (got %r)"
                          % data.get("version"))
        # Absent field = zh (back-compat with the Chinese kit's output).
        content_type = data.get("contentType", "zh")
        check_word = resolve_checker(content_type)
        if check_word is None:
            errors.append("'contentType' must be \"zh\", \"generic\", or "
                          "absent (got %r)" % content_type)
        words = data.get("words")
        if not isinstance(words, list):
            errors.append("'words' must be an array")
        elif not words:
            errors.append("'words' is empty — nothing to register")
        elif len(words) > MAX_REGISTER_WORDS:
            errors.append("batch exceeds 100 entries; split it before registration")
        elif check_word is not None:
            seen = {}
            for i, word in enumerate(words):
                check_word(i, word, seen, errors)

    return errors


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

    errors = validate(data)

    if errors:
        for e in errors:
            print(e)
        print("FAIL: %d error(s)" % len(errors))
        return 1

    print("PASS: %d item(s) validated (format only; pronunciation not verified)." % len(data["words"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
