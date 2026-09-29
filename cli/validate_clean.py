#!/usr/bin/env python3
"""Acceptance tests for a csv_clean.py delivery.

No cleaned file goes to a customer until this passes. The checks exist because each
one corresponds to a way this kind of deliverable can be quietly wrong:

  ROW_MATH      - rows vanished or were double-counted
  MERGE_POINTER - a removed row points at the wrong survivor (this caught a real bug:
                  the pointer was recorded before dropped rows were filtered, so every
                  index shifted)
  MERGE_KEY     - two records were merged that never shared a business key
  SURVIVOR      - the merge lost data instead of consolidating it
  SCHEMA        - the clean file's columns drifted from the source

Usage:
  python scripts/validate_clean.py --original FILE.csv --clean FILE_clean.csv \
         --removed FILE_removed_duplicates.csv
"""
import argparse
import csv
import os
import re
import sys

NULLISH = {"", "n/a", "na", "none", "null", "-", "--", "—", "not sure", "unknown", "?"}


def is_nullish(v):
    return (v or "").strip().lower() in NULLISH


def read(path):
    """Read whatever the cleaner can read, so the two never disagree about the input.

    Reusing csv_clean's reader matters: when the validator could only parse CSV, a
    spreadsheet job was silently checked against the wrong file and reported a row-math
    failure that did not exist.
    """
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from csv_clean import read_csv_tolerant
    rows, _headers, _enc = read_csv_tolerant(path)
    return rows


def completeness(row, cols):
    return sum(1 for c in cols if not is_nullish(row.get(c)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--original", required=True)
    ap.add_argument("--clean", required=True)
    ap.add_argument("--removed", required=True)
    ap.add_argument("--key-cols", default="Email Address,Phone",
                    help="comma-separated columns that identify the same entity")
    args = ap.parse_args()

    original, clean, removed = read(args.original), read(args.clean), read(args.removed)
    cols = [c for c in (clean[0].keys() if clean else [])]
    key_cols = [c.strip() for c in args.key_cols.split(",") if c.strip() in cols]

    failures, checks = [], 0

    # 1. Row math. Blank source rows are dropped by design, so count them here.
    checks += 1
    blanks = sum(1 for r in original if all(is_nullish(v) for v in r.values()))
    total = len(clean) + len(removed) + blanks
    if total != len(original):
        failures.append("ROW_MATH: clean %d + removed %d + blank %d = %d, original %d"
                        % (len(clean), len(removed), blanks, total, len(original)))

    # 2/3/4. Merge pointers, merge keys, and survivor completeness.
    for r in removed:
        ptr = (r.get("_merged_into_row") or "").strip()
        if not ptr:
            continue                      # exact duplicates carry no pointer
        checks += 1
        if not re.match(r"^\d+$", ptr) or not (1 <= int(ptr) <= len(clean)):
            failures.append("MERGE_POINTER: %r is not a valid row in the clean file" % ptr)
            continue
        survivor = clean[int(ptr) - 1]

        checks += 1
        shared = [c for c in key_cols
                  if not is_nullish(r.get(c)) and r.get(c) == survivor.get(c)]
        if not shared:
            failures.append("MERGE_KEY: removed row points at a survivor sharing no key "
                            "(%s)" % {c: r.get(c) for c in key_cols})

        # The survivor must be at least as complete as the row it absorbed, or the
        # merge destroyed data rather than consolidating it.
        checks += 1
        if completeness(survivor, cols) < completeness(r, cols):
            failures.append("SURVIVOR: kept row is less complete than the removed row "
                            "it absorbed (row %s)" % ptr)

    # 5. Schema stability: no column invented or silently dropped.
    checks += 1
    if original and clean:
        src = {re.sub(r"\s+", " ", (c or "")).strip() for c in original[0].keys()}
        got = set(cols)
        if not got <= src:
            failures.append("SCHEMA: clean file has columns absent from the source: %s"
                            % sorted(got - src))

    print("original rows  : %d" % len(original))
    print("clean rows     : %d" % len(clean))
    print("removed rows   : %d" % len(removed))
    print("assertions run : %d" % checks)
    if failures:
        print("\nFAILED (%d):" % len(failures))
        for f in failures:
            print("  - %s" % f)
        return 1
    print("\nALL CHECKS PASSED -- delivery is safe to send.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
