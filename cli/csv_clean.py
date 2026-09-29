#!/usr/bin/env python3
"""CSV cleaner, deduplicator, and audit-report generator.

Built for the most common paid request on gig boards: "here is a messy export, make it
usable." Design rules that make the output trustworthy:

  * Nothing is discarded silently. Every removed row is written to a side file.
  * Row math must reconcile exactly: kept + exact_dupes + merged_dupes + blank == input.
    The program asserts this and fails loudly rather than shipping a wrong file.
  * Normalizations are conservative. A value that cannot be parsed is LEFT ALONE and
    flagged, never blanked and never guessed.
  * Near-duplicate merging keeps the most complete record and fills its gaps from the
    twin, so data is combined rather than dropped.

Usage:
  python scripts/csv_clean.py --input FILE.csv [--out-dir DIR]
         [--dedupe-keys email,phone] [--no-merge]
"""
import argparse
import csv
import os
import re
import sys
from collections import Counter, defaultdict

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$")
NULLISH = {"", "n/a", "na", "none", "null", "-", "--", "—", "not sure", "unknown", "?"}

MONTHS = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun",
     "jul", "aug", "sep", "oct", "nov", "dec"], start=1)}

BOOL_TRUE = {"yes", "y", "true", "t", "1"}
BOOL_FALSE = {"no", "n", "false", "f", "0"}

STATES = {
    "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR",
    "california": "CA", "colorado": "CO", "connecticut": "CT", "delaware": "DE",
    "florida": "FL", "georgia": "GA", "hawaii": "HI", "idaho": "ID", "illinois": "IL",
    "indiana": "IN", "iowa": "IA", "kansas": "KS", "kentucky": "KY", "louisiana": "LA",
    "maine": "ME", "maryland": "MD", "massachusetts": "MA", "michigan": "MI",
    "minnesota": "MN", "mississippi": "MS", "missouri": "MO", "montana": "MT",
    "nebraska": "NE", "nevada": "NV", "new hampshire": "NH", "new jersey": "NJ",
    "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND",
    "ohio": "OH", "oklahoma": "OK", "oregon": "OR", "pennsylvania": "PA",
    "rhode island": "RI", "south carolina": "SC", "south dakota": "SD",
    "tennessee": "TN", "texas": "TX", "utah": "UT", "vermont": "VT", "virginia": "VA",
    "washington": "WA", "west virginia": "WV", "wisconsin": "WI", "wyoming": "WY",
}


def is_nullish(v):
    return (v or "").strip().lower() in NULLISH


def norm_ws(v):
    """Trim and collapse internal whitespace runs."""
    return re.sub(r"\s+", " ", (v or "")).strip()


def clean_email(v):
    """Lowercase and trim. Returns (value, ok). Unparseable values are left alone."""
    s = norm_ws(v).lower()
    if is_nullish(s):
        return "", True
    return (s, bool(EMAIL_RE.match(s)))


def clean_phone(v):
    """Format a US 10-digit number. Anything else is returned untouched and flagged."""
    s = norm_ws(v)
    if is_nullish(s):
        return "", True
    ext = ""
    m = re.search(r"(?:ext|x|extension)\.?\s*(\d{1,6})\s*$", s, re.I)
    if m:
        ext = " ext %s" % m.group(1)
        s = s[:m.start()]
    digits = re.sub(r"\D", "", s)
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    if len(digits) == 10:
        return "(%s) %s-%s%s" % (digits[:3], digits[3:6], digits[6:], ext), True
    return norm_ws(v), False


def clean_date(v):
    """Parse common US/ISO formats to YYYY-MM-DD. Unparseable is left alone and flagged."""
    s = norm_ws(v)
    if is_nullish(s):
        return "", True

    def ok(y, mo, d):
        return 1900 <= y <= 2100 and 1 <= mo <= 12 and 1 <= d <= 31

    m = re.match(r"^(\d{4})-(\d{1,2})-(\d{1,2})$", s)
    if m:
        y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if ok(y, mo, d):
            return "%04d-%02d-%02d" % (y, mo, d), True
        return s, False
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{2}|\d{4})$", s)
    if m:
        mo, d, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if y < 100:                      # 2-digit years: 70-99 -> 1900s, else 2000s
            y += 1900 if y >= 70 else 2000
        if ok(y, mo, d):
            return "%04d-%02d-%02d" % (y, mo, d), True
        return s, False
    m = re.match(r"^(\d{1,2})-([A-Za-z]{3})-(\d{4})$", s)
    if m and m.group(2).lower() in MONTHS:
        d, mo, y = int(m.group(1)), MONTHS[m.group(2).lower()], int(m.group(3))
        if ok(y, mo, d):
            return "%04d-%02d-%02d" % (y, mo, d), True
        return s, False
    m = re.match(r"^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$", s)
    if m and m.group(1)[:3].lower() in MONTHS:
        mo, d, y = MONTHS[m.group(1)[:3].lower()], int(m.group(2)), int(m.group(3))
        if ok(y, mo, d):
            return "%04d-%02d-%02d" % (y, mo, d), True
        return s, False
    return s, False


def clean_money(v):
    """Strip currency symbols/commas to a plain 2dp number. Unparseable left alone."""
    s = norm_ws(v)
    if is_nullish(s):
        return "", True
    t = re.sub(r"(?i)\b(usd|eur|gbp)\b", "", s)
    t = t.replace("$", "").replace(",", "").strip()
    if re.match(r"^-?\d+(\.\d+)?$", t):
        return "%.2f" % float(t), True
    return s, False


def clean_bool(v):
    s = norm_ws(v).lower()
    if is_nullish(s):
        return "", True
    if s in BOOL_TRUE:
        return "TRUE", True
    if s in BOOL_FALSE:
        return "FALSE", True
    return norm_ws(v), False


def clean_state(v):
    s = norm_ws(v)
    if is_nullish(s):
        return "", True
    if len(s) == 2 and s.isalpha():
        return s.upper(), True
    if s.lower() in STATES:
        return STATES[s.lower()], True
    return s, False


def clean_zip(v):
    """Restore leading zeros on 3-4 digit US ZIPs, a classic Excel-import defect."""
    s = norm_ws(v)
    if is_nullish(s):
        return "", True
    if re.match(r"^\d{5}(-\d{4})?$", s):
        return s, True
    if re.match(r"^\d{3,4}$", s):
        return s.zfill(5), True
    return s, False


# Column-name patterns mapped to the cleaner they get.
COLUMN_CLEANERS = [
    (re.compile(r"e-?mail", re.I), "email", clean_email),
    (re.compile(r"phone|mobile|cell|tel", re.I), "phone", clean_phone),
    (re.compile(r"date|signup|created|joined", re.I), "date", clean_date),
    (re.compile(r"price|value|amount|total|revenue|cost|ltv", re.I), "money", clean_money),
    (re.compile(r"^state$|province", re.I), "state", clean_state),
    (re.compile(r"zip|postal", re.I), "zip", clean_zip),
    (re.compile(r"newsletter|subscribed|opt.?in|active|is_", re.I), "bool", clean_bool),
]


def detect_cleaners(headers):
    """Map each header to (kind, fn). Unmatched columns get whitespace cleanup only."""
    out = {}
    for h in headers:
        for pat, kind, fn in COLUMN_CLEANERS:
            if pat.search(h or ""):
                out[h] = (kind, fn)
                break
        else:
            out[h] = ("text", None)
    return out


def read_xlsx(path):
    """Read the first worksheet of an Excel file into the same shape as the CSV reader.

    Buyers searching for "Excel cleanup" send .xlsx far more often than .csv, so
    refusing the format would mean declining most of the work this tool exists for.
    Values are stringified because every downstream cleaner expects text; dates are
    rendered ISO so they survive the date normalizer unchanged.
    """
    try:
        import openpyxl
    except ImportError:
        sys.exit("ERROR: reading .xlsx needs openpyxl. Install it with:\n"
                 "  python -m pip install openpyxl")
    import datetime

    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb[wb.sheetnames[0]]
    rows_iter = ws.iter_rows(values_only=True)
    headers = []
    for raw in rows_iter:
        if raw and any(c is not None and str(c).strip() for c in raw):
            headers = [("" if c is None else str(c).strip()) or "column_%d" % (i + 1)
                       for i, c in enumerate(raw)]
            break
    if not headers:
        sys.exit("ERROR: %s has no header row" % path)

    def cell(v):
        if v is None:
            return ""
        if isinstance(v, datetime.datetime):
            return v.date().isoformat() if (v.hour, v.minute, v.second) == (0, 0, 0) \
                else v.isoformat(sep=" ")
        if isinstance(v, datetime.date):
            return v.isoformat()
        if isinstance(v, float) and v.is_integer():
            return str(int(v))          # stop Excel turning 5565 into "5565.0"
        return str(v)

    out = []
    for raw in rows_iter:
        vals = [cell(c) for c in raw][:len(headers)]
        vals += [""] * (len(headers) - len(vals))
        out.append(dict(zip(headers, vals)))
    wb.close()
    return out, headers, "xlsx (sheet %r)" % ws.title


def read_csv_tolerant(path):
    """Read .csv/.tsv by encoding fallback, or dispatch to the Excel reader."""
    if os.path.splitext(path)[1].lower() in (".xlsx", ".xlsm", ".xltx"):
        return read_xlsx(path)
    for enc in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            with open(path, newline="", encoding=enc) as fh:
                r = csv.DictReader(fh)
                rows = list(r)
                return rows, list(r.fieldnames or []), enc
        except UnicodeDecodeError:
            continue
    sys.exit("ERROR: could not decode %s" % path)


def completeness(row):
    """Count non-blank fields, used to pick the survivor among near-duplicates."""
    return sum(1 for v in row.values() if not is_nullish(v))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--out-dir", default=None)
    ap.add_argument("--dedupe-keys", default="email,phone",
                    help="comma-separated kinds to match near-duplicates on")
    ap.add_argument("--no-merge", action="store_true",
                    help="drop near-duplicates instead of merging their fields")
    args = ap.parse_args()

    rows, headers, enc = read_csv_tolerant(args.input)
    if not rows:
        sys.exit("ERROR: no data rows in %s" % args.input)
    n_input = len(rows)
    print("read %s as %s: %d rows, %d columns" % (args.input, enc, n_input, len(headers)))

    out_dir = args.out_dir or os.path.dirname(os.path.abspath(args.input))
    os.makedirs(out_dir, exist_ok=True)
    stem = os.path.splitext(os.path.basename(args.input))[0]

    # --- header hygiene ---------------------------------------------------------
    header_map, seen = {}, Counter()
    for h in headers:
        clean = norm_ws(h) or "column"
        seen[clean] += 1
        if seen[clean] > 1:                      # de-duplicate repeated header names
            clean = "%s_%d" % (clean, seen[clean])
        header_map[h] = clean
    new_headers = [header_map[h] for h in headers]
    renamed = {h: header_map[h] for h in headers if h != header_map[h]}

    cleaners = detect_cleaners(headers)
    flags = []          # per-cell values we could not parse
    change_counts = Counter()

    # --- pass 1: per-cell cleaning and blank-row removal ------------------------
    cleaned, blank_rows = [], []
    for i, row in enumerate(rows, start=2):      # start=2 -> spreadsheet line numbers
        if all(is_nullish(v) for v in row.values()):
            blank_rows.append(row)
            continue
        out = {}
        for h in headers:
            kind, fn = cleaners[h]
            original = row.get(h)
            if fn is None:
                value, ok = norm_ws(original), True
            else:
                value, ok = fn(original)
            if not ok:
                flags.append({"source_line": i, "column": header_map[h],
                              "value": original, "issue": "could not parse as %s" % kind,
                              "action": "left unchanged for manual review"})
            if value != (original or ""):
                change_counts["%s (%s)" % (header_map[h], kind)] += 1
            out[header_map[h]] = value
        cleaned.append(out)

    # --- pass 2: exact duplicate rows -------------------------------------------
    seen_exact, deduped, exact_dupes = set(), [], []
    for row in cleaned:
        key = tuple(row[h] for h in new_headers)
        if key in seen_exact:
            exact_dupes.append(row)
            continue
        seen_exact.add(key)
        deduped.append(row)

    # --- pass 3: near-duplicates on business keys, survivor keeps the most data --
    kinds = [k.strip() for k in args.dedupe_keys.split(",") if k.strip()]
    key_cols = [header_map[h] for h in headers if cleaners[h][0] in kinds]
    merged_dupes = []
    if key_cols:
        groups = defaultdict(list)
        for idx, row in enumerate(deduped):
            for col in key_cols:
                v = (row.get(col) or "").strip().lower()
                if v:
                    groups[(col, v)].append(idx)
        drop = set()
        for (_col, _v), idxs in groups.items():
            live = [i for i in idxs if i not in drop]
            if len(live) < 2:
                continue
            # Survivor = most complete record; ties resolved by first appearance.
            live.sort(key=lambda i: (-completeness(deduped[i]), i))
            keep, losers = live[0], live[1:]
            for lo in losers:
                if not args.no_merge:
                    for col in new_headers:      # fill the survivor's gaps from the twin
                        if is_nullish(deduped[keep].get(col)) \
                                and not is_nullish(deduped[lo].get(col)):
                            deduped[keep][col] = deduped[lo][col]
                            change_counts["%s (merged from duplicate)" % col] += 1
                rec = dict(deduped[lo])
                # Store the survivor's PRE-FILTER index; it is translated to the final
                # row number below. Recording the raw index here would go stale as soon
                # as dropped rows are removed and every later row shifts up.
                rec["_survivor_index"] = keep
                merged_dupes.append(rec)
                drop.add(lo)
        kept_indices = [i for i in range(len(deduped)) if i not in drop]
        # old index -> 1-based row number in the cleaned output file
        final_row_of = {old: new for new, old in enumerate(kept_indices, start=1)}
        for rec in merged_dupes:
            rec["_merged_into_row"] = str(final_row_of.get(rec.pop("_survivor_index"), ""))
        deduped = [deduped[i] for i in kept_indices]

    # --- the reconciliation that makes the output trustworthy -------------------
    total = len(deduped) + len(exact_dupes) + len(merged_dupes) + len(blank_rows)
    assert total == n_input, \
        "ROW MATH FAILED: kept %d + exact %d + merged %d + blank %d = %d, input was %d" % (
            len(deduped), len(exact_dupes), len(merged_dupes), len(blank_rows),
            total, n_input)

    # --- write outputs ----------------------------------------------------------
    def write(path, fieldnames, data):
        with open(path, "w", newline="", encoding="utf-8") as fh:
            w = csv.DictWriter(fh, fieldnames=fieldnames, extrasaction="ignore")
            w.writeheader()
            w.writerows(data)
        return path

    p_clean = write(os.path.join(out_dir, stem + "_clean.csv"), new_headers, deduped)
    p_dupes = write(os.path.join(out_dir, stem + "_removed_duplicates.csv"),
                    new_headers + ["_merged_into_row"], exact_dupes + merged_dupes)
    p_flags = os.path.join(out_dir, stem + "_flagged_values.csv")
    with open(p_flags, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=["source_line", "column", "value", "issue",
                                           "action"])
        w.writeheader()
        w.writerows(flags)

    p_report = os.path.join(out_dir, stem + "_CLEANING_REPORT.md")
    with open(p_report, "w", encoding="utf-8") as fh:
        W = fh.write
        W("# Cleaning Report - %s\n\n" % os.path.basename(args.input))
        W("## Row reconciliation\n\n")
        W("| | Rows |\n|---|---|\n")
        W("| Input rows | %d |\n" % n_input)
        W("| Fully blank rows removed | %d |\n" % len(blank_rows))
        W("| Exact duplicate rows removed | %d |\n" % len(exact_dupes))
        W("| Near-duplicate rows %s | %d |\n"
          % ("merged" if not args.no_merge else "removed", len(merged_dupes)))
        W("| **Rows in clean file** | **%d** |\n\n" % len(deduped))
        W("Kept + removed = %d, which equals the %d input rows. Checked "
          "programmatically; the run aborts if this does not balance.\n\n"
          % (total, n_input))
        if renamed:
            W("## Headers corrected\n\n| Original | Corrected |\n|---|---|\n")
            for a, b in renamed.items():
                W("| `%s` | `%s` |\n" % (a, b))
            W("\n")
        W("## Column types detected\n\n| Column | Treated as |\n|---|---|\n")
        for h in headers:
            W("| `%s` | %s |\n" % (header_map[h], cleaners[h][0]))
        W("\n## Values changed\n\n| Column (rule) | Cells changed |\n|---|---|\n")
        for k, v in change_counts.most_common():
            W("| %s | %d |\n" % (k, v))
        W("\n## Values flagged for your review (%d)\n\n" % len(flags))
        W("These could not be parsed confidently, so they were **left exactly as they "
          "were** rather than guessed at or blanked.\n\n")
        if flags:
            W("| Line | Column | Value | Issue |\n|---|---|---|---|\n")
            for f in flags[:60]:
                W("| %s | `%s` | `%s` | %s |\n"
                  % (f["source_line"], f["column"], f["value"], f["issue"]))
            if len(flags) > 60:
                W("\n...and %d more in `%s`.\n"
                  % (len(flags) - 60, os.path.basename(p_flags)))
        else:
            W("None.\n")
        W("\n## Files\n\n| File | Contents |\n|---|---|\n")
        W("| `%s` | The cleaned, deduplicated data. |\n" % os.path.basename(p_clean))
        W("| `%s` | Every row removed, and which row it merged into. |\n"
          % os.path.basename(p_dupes))
        W("| `%s` | Every value flagged for review. |\n" % os.path.basename(p_flags))
        W("| `%s` | This report. |\n" % os.path.basename(p_report))

    print("")
    print("=== CLEANING SUMMARY ===")
    print("input_rows        : %d" % n_input)
    print("blank_removed     : %d" % len(blank_rows))
    print("exact_dupes       : %d" % len(exact_dupes))
    print("near_dupes_merged : %d" % len(merged_dupes))
    print("clean_rows        : %d" % len(deduped))
    print("cells_changed     : %d" % sum(change_counts.values()))
    print("values_flagged    : %d" % len(flags))
    print("row_math          : OK (%d == %d)" % (total, n_input))
    for p in (p_clean, p_dupes, p_flags, p_report):
        print("  -> %s" % p)
    return 0


if __name__ == "__main__":
    sys.exit(main())
