# Title Budget

**A browser-only auditor for eBay listing titles, plus a spreadsheet cleaner that proves it didn't lose your rows.**

eBay gives you 80 characters per title. Most sellers spend about half of them, then fill the
rest with words buyers never type — `Vtg`, `L@@K`, `RARE`, `HB`. This finds those, tells you
what each one costs you, and suggests a corrected title.

**[▶ Open the web version](https://mattvlr.github.io/title-budget/)** — nothing installs, and
your data never leaves your browser because there is no server.

---

## The rule that makes the output trustworthy

**Suggested titles only rearrange or expand wording that is already in your title.**

The tool will not guess that a book is a hardcover, or that a card is Near Mint. It cannot
know that, so it doesn't pretend to. Where a title is missing something only you can know, it
says *you need to add this* instead of inventing it.

This is enforced mechanically, not by good intentions. `cli/validate_audit.py` fails the run if
any word appears in a rewrite that wasn't in the original or on a short list of approved
expansions (`Vtg → Vintage`, `HB → Hardcover`, and so on).

## What it checks

| Rule | Example | Why it matters |
|---|---|---|
| Wasted character budget | 31 of 80 used | Unused title space is unused free advertising |
| Seller shorthand | `Vtg`, `HB`, `Hb/dj`, `OSFM`, `1st Ed` | Buyers type whole words; shorthand matches almost no searches |
| ALL CAPS | `STAR WARS VINTAGE 1977 KENNER` | eBay search ignores case, so caps buy nothing and read as shouting |
| Subjective filler | `RARE`, `L@@K`, `MUST SEE`, `WOW` | Spends characters without matching real searches |
| Library-order names | `By Michaelides, Alex` | Buyers search `Alex Michaelides` |
| Repeated words | `1977 ... 1977` | The budget is spent twice on one keyword |
| Unsearchable symbols | `•`, `…`, `*`, `~` | Not searchable — and an ellipsis usually means the title was cut off |
| Missing category keywords | a book with no binding format | The most common search term for that item type is absent |
| Over the limit | 83 characters | eBay truncates, hiding your keywords |

**Trading cards are a deliberate exception:** `Holo Rare` is a real rarity tier and a real
search term, so `Rare` is never stripped there. Getting this wrong was an actual bug during
development — the sort of domain detail a generic text cleaner gets backwards.

## Example

```
Before (28)  L@@K Vintage Seiko Watch WOW
After  (19)  Vintage Seiko Watch

Before (63)  The Silent Patient - Hardcover By Michaelides, Alex - Very Good
After  (62)  The Silent Patient - Hardcover by Alex Michaelides - Very Good

Before (67)  NATIONAL GEOGRAPHIC MAGAZINE JULY 1985 AFGHAN GIRL COVER ISSUE 1985
After  (67)  National Geographic Magazine July 1985 Afghan Girl Cover Issue 1985
             ...and it flags the duplicated "1985" and the missing "Back Issue"
```

## Command line, for whole inventories

The browser version is for a quick look. For a few hundred listings:

```bash
python cli/listing_audit.py --input samples/example_listings.csv --id-col SKU
python cli/validate_audit.py --rewrites samples/example_listings_rewrites.csv
```

You get an audit report, a findings CSV (one row per issue, with its fix), and a rewrites CSV
with character counts and what you must supply yourself.

Export a CSV of your active listings from eBay Seller Hub and point the tool at it. **It never
asks for your eBay account** — it reads a file you exported.

## Also included: a spreadsheet cleaner

`cli/csv_clean.py` cleans and deduplicates messy customer or inventory exports — `.csv` and
`.xlsx`. It normalises phone numbers, mixed date formats, currency stored as text, state names
versus codes, ZIP codes that lost their leading zero in Excel, and yes/no columns. It merges
near-duplicates on email or phone, keeping the most complete record and **filling its gaps from
the duplicate** rather than discarding data.

The part that matters:

> **Rows kept + rows removed + blank rows must equal the rows you started with.**
> The program asserts this and **aborts rather than write a file where it doesn't balance.**

Every removed row is written to a side file naming which record it merged into, and any value
it could not parse confidently is **left exactly as it was and flagged** — never guessed at,
never silently blanked.

```bash
python cli/csv_clean.py --input samples/example_messy_customers.csv
python cli/validate_clean.py --original samples/example_messy_customers.csv \
    --clean samples/example_messy_customers_clean.csv \
    --removed samples/example_messy_customers_removed_duplicates.csv
```

## Tests

The acceptance harnesses are the interesting part, because each check exists for a bug that
actually happened:

- `INVENTED_WORDS` — a rewrite introduced a word that was never in the original
- `LOST_NUMBERS` — a year, card number, or model number vanished
- `MERGE_POINTER` — a removed row pointed at the wrong surviving record *(this caught a real
  bug: the pointer was recorded before dropped rows were filtered, so every index shifted and
  6 of 8 pointers named an unrelated person)*
- `MERGE_KEY` — two records were merged that never shared an email or phone
- `SURVIVOR` — the merge lost data instead of consolidating it
- `ROW_MATH` — rows vanished or were double-counted

Current state: 72 assertions on the title auditor, 26 on the CSV path, 32 on the xlsx path, and
16 browser assertions driving real Chrome against the web version.

Run them yourself:

```bash
python cli/validate_audit.py --rewrites samples/example_listings_rewrites.csv
python cli/validate_clean.py \
    --original samples/example_messy_customers.csv \
    --clean samples/example_messy_customers_clean.csv \
    --removed samples/example_messy_customers_removed_duplicates.csv
python tests/verify_webapp.py                 # local index.html, needs selenium + Chrome
python tests/verify_webapp.py --url https://mattvlr.github.io/title-budget/
```

## Requirements

- Web version: any modern browser. No install, no account, no network calls.
- CLI: Python 3.8+. Standard library only, except `openpyxl` if you want `.xlsx` input
  (`pip install openpyxl`).

## A paid companion, if you want it

This tool tells you what's wrong with your titles. It doesn't tell you what you actually
earned.

**[Reseller Profit & Inventory Tracker](https://bookmonger.gumroad.com/l/reseller-profit-tracker)**
($19) is a spreadsheet that does: cost, fees, net profit, margin, ROI and days-to-sell per
item, with a dashboard and an editable fee table for 8 marketplaces.

It exists because most homemade trackers calculate marketplace fees on the item price alone.
eBay charges its fee on the **total the buyer paid, shipping included** - so those trackers
understate fees on every order. This one doesn't.

Buying it is entirely optional. Everything in this repository stays free and MIT licensed.

## Honest limitations

- The 80-character limit and the rules here are **eBay-shaped**. Etsy and Depop have different
  limits and conventions; most findings still apply, but the budget number won't.
- It audits titles, not prices, photos, or item specifics.
- It cannot tell you whether a listing will sell. Nothing can. It tells you which keywords
  you're leaving on the table.
- Category detection is keyword-based, so an unusual title can be classed as `general` and skip
  the category checks.

MIT licensed. Issues and pull requests welcome.
