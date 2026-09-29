#!/usr/bin/env python3
"""eBay / Etsy listing-title auditor.

Finds rule-detectable defects in marketplace listing titles and proposes corrected
titles. Every rule here is deterministic and explainable, and the rewriter only
rearranges or expands wording ALREADY PRESENT in the title. It never invents a fact
about an item -- it will not guess that a book is a hardcover. Anything it cannot know
is emitted as a "seller must supply" item instead of a guess. That distinction is the
reason the output can be trusted and sold.

Input : CSV containing at least a title column (default "Title").
Output: <stem>_AUDIT.md, <stem>_findings.csv, <stem>_rewrites.csv

Usage:
  python scripts/listing_audit.py --input FILE.csv [--title-col Title]
         [--id-col ItemID] [--out-dir DIR] [--seller-name "Shop"]
"""
import argparse
import csv
import os
import re
import sys
from collections import Counter

EBAY_TITLE_MAX = 80        # eBay's hard title limit
UTILIZATION_FLOOR = 65     # below this, keyword space is being wasted

# --- Abbreviation table ----------------------------------------------------------
# Buyers type whole words into search. Seller shorthand matches almost no queries.
# pattern -> (expansion, why it matters)
ABBREV = [
    (r"\bVtg\b", "Vintage", "'Vtg' is not a term buyers type into search"),
    (r"\bVint\b", "Vintage", "'Vint' is not a term buyers type into search"),
    (r"\bHb/dj\b", "Hardcover Dust Jacket", "'Hb/dj' is seller shorthand"),
    (r"\bHB/DJ\b", "Hardcover Dust Jacket", "'HB/DJ' is seller shorthand"),
    (r"\bHard Cover\b", "Hardcover", "buyers search the single word 'Hardcover'"),
    (r"\bHB\b", "Hardcover", "'HB' is seller shorthand for Hardcover"),
    (r"\bHC\b", "Hardcover", "'HC' is seller shorthand for Hardcover"),
    (r"\bTPB\b", "Trade Paperback", "'TPB' is collector shorthand"),
    (r"\bPB\b", "Paperback", "'PB' is seller shorthand for Paperback"),
    (r"\bSC\b", "Softcover", "'SC' is seller shorthand"),
    (r"\bDJ\b", "Dust Jacket", "'DJ' is seller shorthand"),
    (r"\bOSFM\b", "One Size Fits Most", "'OSFM' is niche shorthand"),
    (r"\bNM\b", "Near Mint", "'NM' is collector shorthand; include the words as well"),
    (r"\b1st Ed\b", "First Edition", "buyers search the spelled-out form"),
    (r"\b1st Edition\b", "First Edition", "buyers search the spelled-out form"),
]

# --- Subjective filler: burns characters that could hold real search keywords -----
FILLER = ["VERY RARE", "RARE", "BEAUTIFUL", "STUNNING", "GORGEOUS", "AMAZING",
          "MUST SEE", "AWESOME", "FAST SHIP", "FREE SHIP", "L@@K", "WOW", "HTF"]

# "Rare" is filler in most categories but is a real, searched RARITY TIER in trading
# cards ("Holo Rare", "Ultra Rare"). Stripping it there would destroy a keyword, so
# these contexts protect it.
RARITY_CONTEXT = re.compile(
    r"(holo|secret|ultra|super|amazing|illustration|double|hyper|shiny|special)\s+rare"
    r"|rare\s+(holo|secret|ultra)", re.I)

# Words that look like a surname to the "Lastname, Firstname" pattern but are not
# names at all. Swapping around these produced mangled titles in testing.
NOT_A_NAME = {
    "hardcover", "paperback", "softcover", "hardback", "volume", "edition", "book",
    "books", "series", "vol", "signed", "inscribed", "autographed", "reckless",
    "rogue", "renegade", "very", "good", "mint", "new", "used", "vintage", "antique",
    "first", "second", "third", "illustrated", "revised", "complete", "trade",
    "collectible", "novel", "cookbook", "magazine", "issue", "set", "lot",
}

# --- Characters that do not belong in a marketplace title ------------------------
BAD_CHARS = [
    ("…", "ellipsis -- usually means the title was truncated and is incomplete"),
    ("•", "bullet character -- not searchable and wastes a character"),
    ("™", "trademark symbol"),
    ("®", "registered symbol"),
    ("“", "curly quote"),
    ("”", "curly quote"),
    ("*", "asterisk -- reads as spam"),
    ("!", "exclamation mark -- reads as spam"),
    ("@", "at sign"),
    ("#", "hash"),
    ("~", "tilde"),
    ("|", "pipe"),
]

# --- Item-type detection, and the keywords each type needs -----------------------
# (type name, trigger patterns, [(human label, pattern that satisfies it), ...])
TYPE_RULES = [
    ("pokemon_card",
     [r"pokemon", r"pokémon", r"\bholo\b", r"\bTCG\b", r"\b\d{3}/\d{3}\b"],
     [("the words 'Pokemon TCG'", r"pok[eé]mon"),
      ("a card number such as 014/094", r"\b\d{1,3}/\d{1,3}\b"),
      ("a condition grade (Near Mint, Lightly Played, ...)",
       r"near mint|\bNM\b|\bmint\b|lightly played|\bLP\b|excellent|played")]),
    ("magazine",
     [r"\bmagazine\b", r"\bnewsweek\b", r"\btime magazine\b", r"\blife magazine\b"],
     [("the word 'Magazine'", r"magazine"),
      ("'Back Issue', a very common buyer search", r"back issue"),
      ("a cover date", r"\b(19|20)\d{2}\b")]),
    ("book",
     [r"\bhardcover\b", r"\bpaperback\b", r"\bedition\b", r"\bnovel\b", r"\bbook\b",
      r"\bHb\b", r"\bsigned\b", r"\binscribed\b", r"\bby\b"],
     [("a binding format (Hardcover, Paperback, Softcover)",
       r"hardcover|paperback|softcover|hardback|hard cover|board book|spiral"),
      ("an author credit written as \"by Firstname Lastname\"", r"\bby\s+[A-Z]"),
      ("a publication year", r"\b(18|19|20)\d{2}\b")]),
    ("apparel",
     [r"\bhat\b", r"\bcap\b", r"\bshirt\b", r"\btee\b", r"\bjacket\b", r"\bdress\b",
      r"\bpants\b", r"\bhoodie\b", r"\bsweater\b"],
     [("a size", r"\b(XS|S|M|L|XL|XXL|2XL|3XL|small|medium|large|OSFM|One Size)\b"),
      ("a color", r"\b(black|white|red|blue|green|grey|gray|pink|purple|brown|navy|"
                  r"tan|beige|yellow|orange|cream|olive|maroon|teal)\b")]),
]

SEVERITY_WEIGHT = {"high": 12, "medium": 6, "low": 2}

WHY_IT_COSTS = {
    "wasted_title_space": "Unused title characters are unused free advertising -- "
                          "fewer buyer searches can match the listing.",
    "abbreviation": "Buyers type whole words. Shorthand like 'Vtg' or 'HB' matches "
                    "almost no searches.",
    "abbreviation_no_room": "Worth fixing once lower-value words are removed.",
    "missing_keyword": "The most common search term for this item type is absent "
                       "from the title.",
    "inverted_name": "'Lastname, Firstname' does not match how buyers search a name.",
    "all_caps": "Caps give no search advantage and reduce buyer trust.",
    "subjective_filler": "Words like RARE consume the character budget without "
                         "matching real searches.",
    "duplicate_token": "A repeated word wastes characters that could hold a new keyword.",
    "bad_character": "Symbols are not searchable, and an ellipsis usually means the "
                     "title was cut off.",
    "missing_apostrophe": "Minor, but it affects how professional the listing looks.",
    "whitespace_or_dangling_punctuation": "Cosmetic cleanup.",
    "over_length": "eBay truncates titles past the limit, hiding your keywords.",
}


def norm_spaces(s):
    """Collapse whitespace runs, trim, and drop leading/trailing separators."""
    s = re.sub(r"\s+", " ", s).strip()
    s = re.sub(r"^[\-•,;:*|~]+\s*", "", s)
    s = re.sub(r"\s*[\-•,;:*|~]+$", "", s)
    return s.strip()


def detect_type(title):
    """Return the first item type whose trigger patterns match, else 'generic'."""
    for name, triggers, _req in TYPE_RULES:
        for pat in triggers:
            if re.search(pat, title, re.I):
                return name
    return "generic"


def caps_ratio(title):
    """Share of words of 4+ letters that are entirely uppercase."""
    words = re.findall(r"[A-Za-z]{4,}", title)
    if not words:
        return 0.0
    return sum(1 for w in words if w.isupper()) / len(words)


def audit_title(row_id, title, item_type):
    """Audit one title.

    Returns (findings, rewritten_title, seller_must_supply, original_title).
    """
    findings = []
    need_from_seller = []
    original = title
    work = norm_spaces(title)

    def add(rule, severity, detail, fix):
        findings.append({"item_id": row_id, "rule": rule, "severity": severity,
                         "detail": detail, "suggested_fix": fix})

    if work != title.strip():
        add("whitespace_or_dangling_punctuation", "low",
            "Irregular spacing or a leading/trailing separator.",
            "Normalize spacing and remove dangling punctuation.")

    # 1. Subjective filler FIRST, before symbols are stripped. Some filler contains
    #    punctuation ("L@@K"), and removing the symbols first would leave behind a
    #    fragment ("L K") that no later rule recognizes as filler.
    for f in FILLER:
        # Protect "Rare" where it names a real trading-card rarity tier.
        if f.endswith("RARE") and RARITY_CONTEXT.search(work):
            continue
        if re.search(r"\b%s\b" % re.escape(f), work, re.I):
            add("subjective_filler", "medium",
                "Contains '%s', which buyers rarely search and which consumes %d "
                "characters." % (f, len(f)),
                "Remove '%s' and use those characters for a searchable attribute "
                "(brand, model, year, size, material)." % f)
            work = norm_spaces(re.sub(r"\b%s\b" % re.escape(f), " ", work, flags=re.I))

    # 2. Characters that do not belong in a title.
    for ch, why in BAD_CHARS:
        if ch in work:
            add("bad_character", "high" if ch == "…" else "low",
                "Contains %r (%s)." % (ch, why),
                "Remove %r and spend the characters on a keyword." % ch)
            work = work.replace(ch, " ")
    work = norm_spaces(work)

    # 2. ALL-CAPS shouting. eBay search is case-insensitive, so caps buy nothing.
    cr = caps_ratio(work)
    if cr >= 0.40:
        add("all_caps", "medium",
            "%.0f%% of the significant words are ALL CAPS." % (cr * 100),
            "Use Title Case. eBay search is case-insensitive, so caps add no search "
            "benefit and read as spam to buyers.")
        # Title-case only long all-caps words, leaving short acronyms intact.
        work = " ".join(w.title() if (w.isupper() and len(w) > 3) else w
                        for w in work.split())
        # Repair Mc/Mac surnames that shouted only their tail, e.g. "McNALLY".
        work = re.sub(r"\b(Mc|Mac)([A-Z]{2,})\b",
                      lambda mm: mm.group(1) + mm.group(2).title(), work)

    # 4. Abbreviations buyers never type.
    for pat, expansion, why in ABBREV:
        m = re.search(pat, work)
        if not m:
            continue
        if re.search(r"\b%s\b" % re.escape(expansion), work, re.I):
            continue  # expansion already present; shorthand is harmless duplication
        projected = len(work) - len(m.group(0)) + len(expansion)
        if projected <= EBAY_TITLE_MAX:
            add("abbreviation", "high",
                "%s. Expanding it lets the listing match more buyer searches." % why,
                "Replace with '%s'." % expansion)
            work = norm_spaces(re.sub(pat, expansion, work, count=1))
        else:
            add("abbreviation_no_room", "medium",
                "%s, but expanding to '%s' would exceed %d characters."
                % (why, expansion, EBAY_TITLE_MAX),
                "Remove a lower-value word first, then expand to '%s'." % expansion)

    # 5. Library-style inverted names: "by Russell, Bob" -> "by Bob Russell".
    #    Anchored to a preceding "by" and screened against NOT_A_NAME, because an
    #    unanchored pattern also matches things like "Gingrich, Hardcover" and
    #    "Cats, Volume" and rewriting those mangles the title.
    m = re.search(r"\bby\s+([A-Z][a-z]{2,}),\s+([A-Z][a-z]{2,})((?:\s+[A-Z]\.?)?)\b",
                  work, re.I)
    if m and m.group(1).lower() not in NOT_A_NAME \
            and m.group(2).lower() not in NOT_A_NAME:
        last, first, middle = m.group(1), m.group(2), m.group(3).strip()
        fixed = " ".join(p for p in (first, middle, last) if p)
        add("inverted_name", "high",
            "The author is written library-style as '%s, %s%s'. Buyers search "
            "'%s'." % (last, first, (" " + middle) if middle else "", fixed),
            "Write the author as '%s'." % fixed)
        candidate = norm_spaces(work[:m.start()] + "by " + fixed + work[m.end():])
        if len(candidate) <= EBAY_TITLE_MAX:
            work = candidate

    # 6. Repeated tokens waste the character budget.
    tokens = [t.lower() for t in re.findall(r"[A-Za-z0-9']{3,}", work)]
    for tok, count in Counter(tokens).items():
        if count > 1 and tok not in {"the", "and", "for", "with"}:
            add("duplicate_token", "medium",
                "The word '%s' appears %d times." % (tok, count),
                "Remove the repeat and use the freed characters for another keyword.")

    # 7. Possessives commonly typed as bare plurals.
    for bad, good in [("Womens", "Women's"), ("Mens", "Men's"),
                      ("Childrens", "Children's"), ("Americas", "America's"),
                      ("Dawns", "Dawn's")]:
        if re.search(r"\b%s\b" % bad, work):
            add("missing_apostrophe", "low",
                "'%s' should be '%s'." % (bad, good),
                "Use '%s'." % good)
            work = re.sub(r"\b%s\b" % bad, good, work)

    # 8. Item-type keyword completeness. These become explicit asks rather than
    #    guesses, because the tool must not assert an attribute it cannot verify.
    for name, _trig, required in TYPE_RULES:
        if name != item_type:
            continue
        for label, pat in required:
            if not re.search(pat, work, re.I):
                add("missing_keyword", "high",
                    "Item type looks like '%s' but the title is missing %s."
                    % (item_type, label),
                    "Add %s. Only you can supply this, so the tool does not guess it."
                    % label)
                need_from_seller.append(label)

    # 9. Character-budget utilization, measured on the rewritten title.
    work = norm_spaces(work)
    if len(work) < UTILIZATION_FLOOR:
        add("wasted_title_space", "high",
            "Title uses %d of %d characters, leaving %d characters of keyword space "
            "unused." % (len(work), EBAY_TITLE_MAX, EBAY_TITLE_MAX - len(work)),
            "Add specific attributes buyers search on: brand, model or edition, year, "
            "size, color, material, condition.")
    if len(work) > EBAY_TITLE_MAX:
        add("over_length", "high",
            "Title is %d characters, past the %d limit, so eBay will truncate it."
            % (len(work), EBAY_TITLE_MAX),
            "Cut the lowest-value words until it fits within %d." % EBAY_TITLE_MAX)

    return findings, work, need_from_seller, original


def score(findings):
    """100 minus weighted deductions, floored at zero, comparable across listings."""
    return max(0, 100 - sum(SEVERITY_WEIGHT[f["severity"]] for f in findings))


def read_csv_tolerant(path):
    """Marketplace exports are often cp1252 and often carry a BOM."""
    for enc in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            with open(path, newline="", encoding=enc) as fh:
                rows = list(csv.DictReader(fh))
            print("read %s as %s" % (path, enc))
            return rows
        except UnicodeDecodeError:
            continue
    sys.exit("ERROR: could not decode %s in utf-8, cp1252, or latin-1" % path)


def build_report(per_item, all_findings, seller_name, stem, paths):
    """Render the human-readable audit report."""
    n = len(per_item)
    rule_counts = Counter(f["rule"] for f in all_findings)
    sev = Counter(f["severity"] for f in all_findings)
    avg_score = sum(p["score"] for p in per_item) / n if n else 0
    avg_chars = sum(len(p["title"]) for p in per_item) / n if n else 0
    reclaimable = sum(max(0, EBAY_TITLE_MAX - len(p["title"])) for p in per_item)
    worst = sorted(per_item, key=lambda p: p["score"])[:15]

    L = []
    L.append("# Listing Title Audit -- %s\n" % seller_name)
    L.append("| Metric | Value |")
    L.append("|---|---|")
    L.append("| Listings analyzed | **%d** |" % n)
    L.append("| Average title score | **%.0f / 100** |" % avg_score)
    L.append("| Average title length | **%.0f of %d characters** |"
             % (avg_chars, EBAY_TITLE_MAX))
    L.append("| Unused title characters across all listings | **%d** |" % reclaimable)
    L.append("| Findings | **%d** (high %d, medium %d, low %d) |"
             % (len(all_findings), sev["high"], sev["medium"], sev["low"]))
    L.append("\n## How to read this report\n")
    L.append("Every finding comes from a deterministic rule applied to your listing "
             "titles. Suggested titles only **rearrange or expand wording that is "
             "already in your title** -- the tool never invents a fact about an item. "
             "Where a title is missing something only you can know (a binding format, "
             "a size, a condition grade), it is listed under *you must add*, not "
             "guessed. Apply the suggested titles with your normal bulk-edit tool; "
             "nothing here changes your listings automatically.\n")
    L.append("\n## Findings by rule\n")
    L.append("| Rule | Findings | Why it costs you sales |")
    L.append("|---|---|---|")
    for rule, c in rule_counts.most_common():
        L.append("| `%s` | %d | %s |" % (rule, c, WHY_IT_COSTS.get(rule, "")))

    L.append("\n## Fix these first\n")
    L.append("The %d lowest-scoring listings, worst first.\n" % len(worst))
    by_item = {}
    for f in all_findings:
        by_item.setdefault(f["item_id"], []).append(f)
    for p in worst:
        L.append("### %s -- score %d/100 -- detected type: %s"
                 % (p["item_id"], p["score"], p["item_type"]))
        L.append("")
        L.append("- **Current** (%d chars): `%s`" % (len(p["title"]), p["title"]))
        if p["suggested"] != p["title"]:
            L.append("- **Suggested** (%d chars): `%s`"
                     % (len(p["suggested"]), p["suggested"]))
        if p["needs"]:
            L.append("- **You must add:** %s" % "; ".join(p["needs"]))
        for f in by_item.get(p["item_id"], []):
            L.append("    - `%s` (%s) -- %s %s"
                     % (f["rule"], f["severity"], f["detail"], f["suggested_fix"]))
        L.append("")

    L.append("\n## Files in this delivery\n")
    L.append("| File | Contents |")
    L.append("|---|---|")
    L.append("| `%s` | This report. |" % (stem + "_AUDIT.md"))
    L.append("| `%s` | Every finding, one row per issue, with its fix. |"
             % os.path.basename(paths["findings"]))
    L.append("| `%s` | Original vs suggested title, character counts, what changed, "
             "and what you must supply. |" % os.path.basename(paths["rewrites"]))
    return "\n".join(L) + "\n"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--title-col", default="Title")
    ap.add_argument("--id-col", default=None)
    ap.add_argument("--out-dir", default=None)
    ap.add_argument("--seller-name", default="your shop")
    args = ap.parse_args()

    rows = read_csv_tolerant(args.input)
    if not rows:
        sys.exit("ERROR: %s has no data rows" % args.input)
    if args.title_col not in rows[0]:
        sys.exit("ERROR: no column %r. Columns present: %s"
                 % (args.title_col, list(rows[0].keys())))

    id_col = args.id_col
    if not id_col:
        for cand in ("ItemID", "Item number", "id", "SKU", "Custom label"):
            if cand in rows[0]:
                id_col = cand
                break

    out_dir = args.out_dir or os.path.dirname(os.path.abspath(args.input))
    os.makedirs(out_dir, exist_ok=True)
    stem = os.path.splitext(os.path.basename(args.input))[0]
    paths = {"findings": os.path.join(out_dir, stem + "_findings.csv"),
             "rewrites": os.path.join(out_dir, stem + "_rewrites.csv"),
             "report": os.path.join(out_dir, stem + "_AUDIT.md")}

    all_findings, rewrites, per_item = [], [], []
    for i, row in enumerate(rows, start=1):
        title = (row.get(args.title_col) or "").strip()
        if not title:
            continue
        rid = (row.get(id_col) if id_col else None) or "row-%d" % i
        itype = detect_type(title)
        findings, new_title, needs, original = audit_title(rid, title, itype)
        all_findings.extend(findings)
        per_item.append({"item_id": rid, "item_type": itype, "score": score(findings),
                         "issues": len(findings), "title": original,
                         "suggested": new_title, "needs": needs})
        if new_title != original:
            applied = sorted({f["rule"] for f in findings
                              if f["rule"] not in ("missing_keyword",
                                                   "wasted_title_space")})
            rewrites.append({"item_id": rid, "item_type": itype,
                             "original_title": original,
                             "chars_before": len(original),
                             "suggested_title": new_title,
                             "chars_after": len(new_title),
                             "changes_applied": "; ".join(applied),
                             "seller_must_supply": "; ".join(needs)})

    with open(paths["findings"], "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=["item_id", "rule", "severity", "detail",
                                           "suggested_fix"])
        w.writeheader()
        w.writerows(all_findings)

    with open(paths["rewrites"], "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=["item_id", "item_type", "original_title",
                                           "chars_before", "suggested_title",
                                           "chars_after", "changes_applied",
                                           "seller_must_supply"])
        w.writeheader()
        w.writerows(rewrites)

    with open(paths["report"], "w", encoding="utf-8") as fh:
        fh.write(build_report(per_item, all_findings, args.seller_name, stem, paths))

    # Machine-checkable summary, used by the validation harness.
    n = len(per_item)
    over = sum(1 for r in rewrites if r["chars_after"] > EBAY_TITLE_MAX)
    print("")
    print("=== AUDIT SUMMARY ===")
    print("listings_analyzed   : %d" % n)
    print("findings_total      : %d" % len(all_findings))
    print("titles_rewritten    : %d" % len(rewrites))
    print("avg_score           : %.1f" % (sum(p["score"] for p in per_item) / n if n else 0))
    print("avg_title_chars     : %.1f" % (sum(len(p["title"]) for p in per_item) / n if n else 0))
    print("rewrites_over_limit : %d" % over)
    for k in ("report", "findings", "rewrites"):
        print("%-8s -> %s" % (k, paths[k]))
    return 1 if over else 0


if __name__ == "__main__":
    sys.exit(main())
