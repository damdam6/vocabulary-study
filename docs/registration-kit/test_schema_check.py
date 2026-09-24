"""Run with python3 -m unittest discover -s docs/registration-kit -p 'test_*.py'."""
import copy
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest

import schema_check as checker

KIT = Path(__file__).resolve().parent
FIXTURES = json.loads((KIT.parents[1] / "tests/fixtures/chinese-sentence-registration.json").read_text())
WORD = {"hanzi": "今天", "pinyin": "jīntiān", "meaning": "오늘"}


def payload(words, content_type="zh"):
    return {"version": 1, "contentType": content_type, "words": words}


class SchemaCheckTests(unittest.TestCase):
    def test_shared_fixtures(self):
        for case in FIXTURES["cases"]:
            with self.subTest(case=case["id"]):
                words = copy.deepcopy(case["words"])
                if case["contentType"] == "generic":
                    words = [{({"hanzi": "term", "pinyin": "note"}.get(k, k)): v for k, v in w.items()} for w in words]
                data = payload(words, case["contentType"])
                original = copy.deepcopy(data)
                self.assertEqual(not checker.validate(data), case["accepted"])
                self.assertEqual(data, original)
                if case["accepted"] and case["contentType"] == "zh":
                    self.assertEqual([checker.normalize_zh_word(w) for w in words], case["expectedWords"])

    def test_punctuation_and_ascii_alphabet(self):
        # Independent PRD literal catches a missing/extra mirrored character.
        punctuation = "，。！？；：、,.!?;:（）()【】[]《》〈〉“”‘’「」『』\"'…—-·／/％%＋+＝=．"
        self.assertEqual(checker.REGISTRATION_PUNCTUATION, punctuation)
        for ch in punctuation:
            self.assertFalse(checker.validate(payload([{**WORD, "hanzi": "今" + ch + "天", "pinyin": "jīn" + ch + "tiān"}])))
        self.assertFalse(checker.validate(payload([{**WORD, "pinyin": "NǏ abcdefghijklmnopqrstuvwxyz ABCDEFGHIJKLMNOPQRSTUVWXYZ Ü"}])))

    def test_controls_at_edges_and_inside(self):
        controls = [chr(n) for n in range(160) if n < 32 or n >= 127]
        for ch in controls + ["\u00a0", "\u200b", "\u2028", "\ufeff", "\ud800", "\udfff"]:
            for field in ("hanzi", "pinyin"):
                for value in (ch + WORD[field], WORD[field] + ch, WORD[field][0] + ch + WORD[field][1:]):
                    with self.subTest(field=field, char=repr(ch)):
                        self.assertTrue(checker.validate(payload([{**WORD, field: value}])))

    def test_meaning_uses_js_trim_without_nfc(self):
        word = {**WORD, "meaning": "\ufeffcafe\u0301\ufeff"}
        self.assertEqual(checker.normalize_zh_word(word)["meaning"], "cafe\u0301")
        self.assertTrue(checker.validate(payload([{**WORD, "meaning": "\ufeff"}])))
        self.assertFalse(checker.validate(payload([{**WORD, "meaning": "\x1c"}])))

    def test_batch_limit_both_schemas(self):
        for content_type in ("zh", "generic"):
            words = [{**WORD, "hanzi": "今天%d" % i} if content_type == "zh" else {"term": "item%d" % i, "meaning": "항목"} for i in range(101)]
            self.assertFalse(checker.validate(payload(words[:100], content_type)))
            self.assertTrue(checker.validate(payload(words, content_type)))

    def test_generic_policy(self):
        for note in (None, "", "구동사"):
            word = {"term": " take off ", "meaning": " 이륙하다 "}
            if note is not None:
                word["note"] = note
            self.assertFalse(checker.validate(payload([word], "generic")))
        for word in ({"term": "x", "meaning": "뜻", "note": 1}, {"term": "x", "meaning": "뜻", "extra": "x"}):
            self.assertTrue(checker.validate(payload([word], "generic")))
        self.assertTrue(checker.validate(payload([{"term": " x ", "meaning": "뜻"}, {"term": "x", "meaning": "뜻"}], "generic")))
        self.assertFalse(checker.validate(payload([{"term": t, "meaning": "뜻"} for t in ("café", "cafe\u0301", "CAFÉ")], "generic")))

    def test_prompt_samples_and_cli(self):
        for prompt in ("extraction-prompt.md", "en-extraction-prompt.md"):
            examples = re.findall(r"```json\n(.*?)\n```", (KIT / prompt).read_text(), re.S)
            self.assertTrue(examples)
            for example in examples:
                self.assertFalse(checker.validate(json.loads(example)))
                result = subprocess.run([sys.executable, str(KIT / "schema_check.py")], input=example, text=True, capture_output=True)
                self.assertEqual(result.returncode, 0, result.stdout)
                self.assertIn("PASS:", result.stdout)
        # File input and fenced stdin remain supported, invalid input exits 1.
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "invalid.json"
            path.write_text(json.dumps(payload([{**WORD, "pinyin": "jin1tian1"}])))
            result = subprocess.run([sys.executable, str(KIT / "schema_check.py"), str(path)], text=True, capture_output=True)
            self.assertEqual(result.returncode, 1)
            self.assertIn("FAIL:", result.stdout)
        result = subprocess.run([sys.executable, str(KIT / "schema_check.py")], input="```json\n" + json.dumps(payload([WORD])) + "\n```", text=True, capture_output=True)
        self.assertEqual(result.returncode, 0)


if __name__ == "__main__":
    unittest.main()
