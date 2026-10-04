#!/usr/bin/env python3
"""Generate the compact pinyin-initial table used by the web frontend.

The generated table maps a Unicode code point to the first letter of its most
common Mandarin reading ("重" -> "C" for chóng, "庆" -> "Q"), so the entry list
can be grouped by initial letter without shipping a full pinyin dictionary to
the browser.

Usage (regenerating is rarely needed; the generated file is committed):

    python3 -m venv .tools/venv
    ./.tools/venv/bin/pip install pypinyin==0.55.0
    ./.tools/venv/bin/python tools/gen_pinyin_table.py

Output: web/js/core/pinyin-table.js  (ES module, no dependencies)

Encoding: one character per code point inside a single dense string, indexed by
``codePoint - BASE``. A "." marks a code point with no known reading. This keeps
the whole table around 28 KB (about 6 KB gzipped) and makes lookup a single
array index instead of a binary search.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

try:
    from pypinyin import Style, pinyin
except ImportError:  # pragma: no cover - developer tooling only
    sys.exit("pypinyin is required: ./.tools/venv/bin/pip install pypinyin==0.55.0")

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUT = REPO_ROOT / "web" / "js" / "core" / "pinyin-table.js"

# Code points outside this window (CJK Extension A + CJK Unified Ideographs)
# fall back to the "#" bucket in the frontend.
BASE_CODE_POINT = 0x3400
LAST_CODE_POINT = 0x9FFF
UNKNOWN = "."

# Google-style chunking keeps the generated file readable in review diffs.
CHUNK = 120


def collect_chars(charset: str) -> list[str]:
    """Return every CJK character that is representable in ``charset``."""
    seen: set[str] = set()
    for high in range(0x81, 0xFF):
        for low in range(0x40, 0xFF):
            try:
                char = bytes((high, low)).decode(charset)
            except UnicodeDecodeError:
                continue
            if len(char) == 1 and BASE_CODE_POINT <= ord(char) <= LAST_CODE_POINT:
                seen.add(char)
    return sorted(seen)


def initial_of(char: str) -> str:
    """First letter of the most common reading, or '' when unknown."""
    try:
        result = pinyin(char, style=Style.NORMAL, heteronym=False, errors=lambda _: [[""]])
        reading = (result[0][0] or "").strip()
    except (IndexError, KeyError):  # pypinyin has no reading for this character
        return ""
    letter = reading[:1].upper()
    return letter if letter.isalpha() and letter.isascii() else ""


def build_table(charset: str) -> tuple[str, int]:
    """Return the dense letter table and the number of characters covered."""
    width = LAST_CODE_POINT - BASE_CODE_POINT + 1
    table = [UNKNOWN] * width
    covered = 0
    for char in collect_chars(charset):
        letter = initial_of(char)
        if not letter:
            continue
        table[ord(char) - BASE_CODE_POINT] = letter
        covered += 1
    return "".join(table), covered


def chunked_literal(text: str) -> str:
    lines = [text[i : i + CHUNK] for i in range(0, len(text), CHUNK)]
    return " +\n".join(f"  '{line}'" for line in lines)


def render_module(table: str, charset: str, covered: int) -> str:
    return f"""/**
 * Generated file - do not edit by hand.
 *
 * Regenerate with: ./.tools/venv/bin/python tools/gen_pinyin_table.py
 * Source data: pypinyin (MIT), coverage: {charset.upper()} ({covered} CJK characters).
 *
 * PINYIN_INITIALS[i] is the initial letter of the character at code point
 * BASE_CODE_POINT + i, or '{UNKNOWN}' when no reading is known.
 */

/** Lowest code point covered by the table. */
export const BASE_CODE_POINT = {BASE_CODE_POINT};

/** Highest code point covered by the table. */
export const LAST_CODE_POINT = {LAST_CODE_POINT};

/** Marker stored for code points without a known reading. */
export const UNKNOWN_INITIAL = '{UNKNOWN}';

/** Dense lookup string: index = code point - BASE_CODE_POINT. */
const PINYIN_INITIALS = (
{chunked_literal(table)}
);

/**
 * Look up the initial letter of a single code point.
 *
 * @param {{number}} codePoint Unicode code point (not a UTF-16 code unit).
 * @returns {{string}} Uppercase A-Z, or '' when the code point is not covered.
 */
export function pinyinInitialOfCodePoint(codePoint) {{
  if (!Number.isInteger(codePoint) || codePoint < BASE_CODE_POINT || codePoint > LAST_CODE_POINT) {{
    return '';
  }}
  const letter = PINYIN_INITIALS[codePoint - BASE_CODE_POINT];
  return letter === UNKNOWN_INITIAL ? '' : letter;
}}
"""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--charset", default="gbk", help="source charset (gb2312 or gbk)")
    parser.add_argument("--out", default=str(DEFAULT_OUT), help="output module path")
    args = parser.parse_args()

    table, covered = build_table(args.charset)
    if not covered:
        return 1
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(render_module(table, args.charset, covered), encoding="utf-8")
    print(f"{out}: {covered} characters covered, {out.stat().st_size} bytes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())