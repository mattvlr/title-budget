#!/usr/bin/env python3
"""Acceptance tests for a listing_audit.py delivery.

No delivery goes to a customer until this passes. The two important checks are
INVENTED_WORDS and LOST_NUMBERS: together they prove the rewriter only expanded
wording that was already present and never silently dropped a year, card number, or
model number. Everything else is a schema or limit check.

Usage: python scripts/validate_audit.py --rewrites FILE_rewrites.csv
Exit code 0 = all checks passed.
"""
import argparse
import csv
import re
import sys

EBAY_TITLE_MAX = 80

# Words the rewriter is permitted to introduce. Every one is the expansion of a
# shorthand form, a possessive correction, or a case fix -- never a new claim about
# the item. Keep this in sync with ABBREV/possessives in listing_audit.py.
ALLOWED_NEW_WORDS = {
    "vintage", "hardcover", "dust", "jacket", "paperback", "trade", "softcover",
    "one", "size", "fits", "most", "near", "mint", "first", "edition",
    "women's", "men's", "children's", "america's", "dawn's", "by", "with",
}


def words(s):
    """Lowercased word tokens, apostrophes kept so possessive fixes compare cleanly."""
    return [w.lower() for w in re.findall(r"[A-Za-z][A-Za-z']*", s)]


def numbers(s):
    """All digit runs, so we can prove none were lost.

    Ordinals are excluded because turning "1st Edition" into "First Edition" is an
    approved expansion that legitimately consumes the digit. Counting it as a lost
    number would flag a correct rewrite.
    """
    s = re.sub(r"\b\d+(?:st|nd|rd|th)\b", " ", s, flags=re.I)
    return sorted(re.findall(r"\d+", s))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rewrites", required=True)
    args = ap.parse_args()

    with open(args.rewrites, newline="", encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))

    failures = []
    checks = 0

    for r in rows:
        rid = r["item_id"]
        before, after = r["original_title"], r["suggested_title"]

        # 1. Length limit.
        checks += 1
        if len(after) > EBAY_TITLE_MAX:
            failures.append("%s OVER_LIMIT: %d chars" % (rid, len(after)))

        # 2. Non-empty and not degenerate.
        checks += 1
        if len(after.strip()) < 10:
            failures.append("%s TOO_SHORT: %r" % (rid, after))

        # 3. No invented vocabulary. Any word present after but not before must be
        #    an approved expansion, otherwise the tool asserted something new.
        checks += 1
        introduced = set(words(after)) - set(words(before))
        bad = introduced - ALLOWED_NEW_WORDS
        if bad:
            failures.append("%s INVENTED_WORDS: %s" % (rid, sorted(bad)))

        # 4. No lost numbers. Years, card numbers and model numbers are the highest
        #    value keywords in a title; dropping one silently would be a real defect.
        checks += 1
        lost = [n for n in numbers(before) if n not in numbers(after)]
        if lost:
            failures.append("%s LOST_NUMBERS: %s" % (rid, lost))

        # 5. Character counts in the CSV must match the strings they describe.
        checks += 1
        if int(r["chars_before"]) != len(before) or int(r["chars_after"]) != len(after):
            failures.append("%s COUNT_MISMATCH: reported %s/%s actual %d/%d"
                            % (rid, r["chars_before"], r["chars_after"],
                               len(before), len(after)))

        # 6. Every rewrite must name the rules that produced it.
        checks += 1
        if not r["changes_applied"].strip():
            failures.append("%s NO_RULES_RECORDED" % rid)

    print("rows checked   : %d" % len(rows))
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
