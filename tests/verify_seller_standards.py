#!/usr/bin/env python3
"""Acceptance tests for the eBay Seller Standards Checker.

The page makes one substantive claim: it tells you how many more late shipments, defects
or unresolved cases you can take before you fall out of Top Rated. That is an integer,
not an estimate, so it is checkable - and a tool that gets it wrong in the generous
direction costs someone their fee discount.

Three things could quietly be wrong, and each has its own section below:

  ALLOWANCE  - eBay writes two of the limits with a fixed count beside the percentage,
               "no more than 5 (or 3% of transactions)". The page reads that as the
               LARGER of the two clauses. The fixed 5 must therefore hold all the way to
               199 transactions and 3% must overtake it at exactly 200 - which is the
               claim in the page copy, and the thing every guide that quotes only "3%"
               gets wrong.
  FLOOR      - 0.5% is not representable in binary. `Math.floor(n * 0.005)` can land a
               whole unit low exactly where n/200 is an integer, which is exactly where
               a seller's headroom changes. The page uses integer num/den; this asserts
               the result against exact rational arithmetic.
  RECOVERY   - when you are already over, the only lever is more clean sales. The number
               printed has to be the SMALLEST count that gets back under, and it has to
               actually get back under. Both are asserted, and off-by-one in either
               direction is caught.

The independent implementation here does not reproduce the page's formula. It searches
with a predicate written straight from eBay's sentence, using fractions.Fraction, so a
shared algebra mistake cannot pass both sides.

Usage: python scripts/verify_seller_standards.py
"""
import os
import sys
from fractions import Fraction

# ------------------------------------------------------------------ the rules, restated
# Quoted from eBay's Seller standards policy (id=4347), US sellers, read 2026-09-30.
#   defect  "No more than 0.5%, associated with no more than 3 different buyers"
#   cases   "No more than 2 (or 0.3% of transactions)"
#   late    "No more than 5 (or 3% of transactions)"
#   track   "At least 95% of transactions have tracking uploaded within handling time
#            and validated by carrier"
RULES = {
    "defect": (1, 200, 0),
    "cases":  (3, 1000, 2),
    "late":   (3, 100, 5),
}
TRACK = (19, 20)


def meets(count, n, num, den, floor_count):
    """Does `count` bad transactions out of `n` meet the requirement?

    Written from the sentence rather than from a formula: you are inside the limit if the
    fixed count allows it, or if the rate is at or under the percentage. Rate is
    undefined at n == 0, and eBay cannot hold a rate against a seller with no
    transactions, so that passes.
    """
    if count <= floor_count:
        return True
    if n <= 0:
        return count == 0
    return Fraction(count, n) <= Fraction(num, den)


def allowance_by_search(n, num, den, floor_count):
    """Largest count that still meets the requirement, found by walking up from zero."""
    k = 0
    while meets(k + 1, n, num, den, floor_count):
        k += 1
        if k > 10 ** 6:
            raise AssertionError("allowance search ran away at n=%d" % n)
    return k


def required_by_search(n, num, den):
    """Smallest on-time count m with m/n >= num/den. n == 0 needs nothing."""
    if n <= 0:
        return 0
    m = 0
    while Fraction(m, n) < Fraction(num, den):
        m += 1
    return m


def recover_by_search(count, n, num, den, floor_count):
    """Smallest number of extra clean transactions that brings `count` back inside."""
    k = 0
    while not meets(count, n + k, num, den, floor_count):
        k += 1
        if k > 10 ** 7:
            raise AssertionError("recovery search ran away")
    return k


def tracking_ok(ontime, n):
    """Is `ontime` of `n` at or above 95%? No transactions means nothing to fall short of."""
    if n <= 0:
        return True
    return Fraction(ontime, n) >= Fraction(*TRACK)


def recover_tracking_by_search(ontime, n):
    """Smallest k with (ontime + k)/(n + k) >= 19/20. Each tracked sale lifts both."""
    k = 0
    while not tracking_ok(ontime + k, n + k):
        k += 1
        if k > 10 ** 7:
            raise AssertionError("tracking recovery search ran away")
    return k


def eval_window(t3, t12):
    """eBay: last 3 months if MORE than 400 transactions in them, else last 12."""
    return (3, t3) if t3 > 400 else (12, t12)


def find_page():
    here = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        os.path.join(os.path.dirname(here), "..", "title-budget", "seller-standards.html"),
        os.path.join(os.path.dirname(here), "seller-standards.html"),
        os.path.join(os.path.dirname(os.path.dirname(here)), "title-budget",
                     "seller-standards.html"),
    ]
    if len(sys.argv) > 1:
        candidates.insert(0, sys.argv[1])
    for c in candidates:
        c = os.path.abspath(c)
        if os.path.isfile(c):
            return c
    raise SystemExit("could not find seller-standards.html; pass its path as argv[1]")


SWEEP = list(range(0, 260)) + [
    299, 300, 333, 380, 399, 400, 401, 500, 600, 666, 999, 1000, 1001, 1234, 2000,
    3333, 5000,
    9999, 10000, 12345,
]


def main():
    PAGE = find_page()
    failures, checks = [], 0

    def fail(msg):
        failures.append(msg)

    print("PAGE: %s" % PAGE)
    print("")

    # ------------------------------------------------- 1. allowance vs rational search
    print("1. ALLOWANCE == LARGEST COUNT THAT MEETS THE SENTENCE (exact fractions)")
    expected = {}
    for name, (num, den, fc) in RULES.items():
        got = {}
        for n in SWEEP:
            checks += 1
            by_search = allowance_by_search(n, num, den, fc)
            by_formula = max(fc, (n * num) // den)
            got[n] = by_search
            if by_search != by_formula:
                fail("%s n=%d: search %d vs integer formula %d"
                     % (name, n, by_search, by_formula))
            # and the allowance must genuinely be the edge
            checks += 1
            if not meets(by_search, n, num, den, fc):
                fail("%s n=%d: allowance %d does not itself meet the rule"
                     % (name, n, by_search))
            checks += 1
            if meets(by_search + 1, n, num, den, fc):
                fail("%s n=%d: allowance %d is not maximal" % (name, n, by_search))
        expected[name] = got
        print("   %-7s %d values of n, search agrees with integer floor division" %
              (name, len(SWEEP)))

    print("")
    print("2. THE PAGE'S HEADLINE CLAIMS, AS HARD ASSERTIONS")
    # "Five late shipments is inside the limit until you pass 199 sales"
    for n in range(0, 200):
        checks += 1
        if expected["late"][n] != 5:
            fail("late allowance at n=%d is %d, page copy claims 5 up to 199"
                 % (n, expected["late"][n]))
    checks += 1
    if expected["late"][200] != 6:
        fail("late allowance at n=200 is %d, page copy claims 3%% overtakes to 6"
             % expected["late"][200])
    print("   late: allowance is 5 for every n in 0..199, and 6 at n=200   OK")

    # "its fixed allowance of 2 holds all the way to 999 transactions"
    checks += 1
    if expected["cases"][999] != 2:
        fail("cases allowance at n=999 is %d, page copy claims 2"
             % expected["cases"][999])
    checks += 1
    if expected["cases"][1000] != 3:
        fail("cases allowance at n=1000 is %d, page copy claims 3"
             % expected["cases"][1000])
    print("   cases: fixed 2 holds to n=999, becomes 3 at n=1,000          OK")

    # "one defect puts a 100-transaction seller out of Top Rated ... 200 before one
    #  fits, 400 before two do"
    for n, want in ((100, 0), (150, 0), (199, 0), (200, 1), (399, 1), (400, 2)):
        checks += 1
        if expected["defect"][n] != want:
            fail("defect allowance at n=%d is %d, page copy claims %d"
                 % (n, expected["defect"][n], want))
    print("   defect: 0 at n=100/150/199, 1 at n=200/399, 2 at n=400       OK")

    # tracking: 95 of 100, and 96 of 101 (rounding up must not round down)
    for n, want in ((100, 95), (101, 96), (380, 361), (20, 19), (21, 20), (0, 0)):
        checks += 1
        got = required_by_search(n, *TRACK)
        if got != want:
            fail("tracking required at n=%d is %d, expected %d" % (n, got, want))
    print("   tracking: 95/100, 96/101, 361/380, 19/20, 20/21              OK")

    # evaluation window flips strictly above 400
    for t3, t12, want_months in ((400, 900, 12), (401, 900, 3), (0, 50, 12),
                                 (1200, 4000, 3)):
        checks += 1
        months, _ = eval_window(t3, t12)
        if months != want_months:
            fail("eval window for t3=%d is %d months, expected %d"
                 % (t3, months, want_months))
    print("   window: 400 -> 12 months, 401 -> 3 months                    OK")

    print("")
    print("3. ALLOWANCE IS MONOTONIC IN VOLUME")
    for name in RULES:
        checks += 1
        series = [expected[name][n] for n in sorted(expected[name])]
        if series != sorted(series):
            fail("%s allowance is not monotonic in n" % name)
    print("   all three allowances non-decreasing as transactions rise    OK")

    # ------------------------------------------------------------- 4. the real page
    print("")
    print("4. THE PAGE'S OWN JS, RUN IN HEADLESS CHROME")
    from selenium import webdriver
    from selenium.webdriver.chrome.options import Options
    from selenium.webdriver.common.by import By
    from selenium.webdriver.support.ui import WebDriverWait
    from selenium.webdriver.support import expected_conditions as EC

    opts = Options()
    opts.add_argument("--headless=new")
    opts.add_argument("--window-size=1200,2200")
    opts.add_argument("--log-level=3")
    opts.set_capability("goog:loggingPrefs", {"browser": "ALL"})
    driver = webdriver.Chrome(options=opts)
    try:
        driver.get("file:///" + PAGE.replace("\\", "/"))
        WebDriverWait(driver, 20).until(EC.presence_of_element_located((By.ID, "level")))

        api = driver.execute_script("return !!window.__ss;")
        checks += 1
        if not api:
            fail("window.__ss is not exposed; the page's own functions cannot be tested")
            raise SystemExit(1)

        # 4a. the page's allowance() against the searched values, over the whole sweep
        for name, (num, den, fc) in RULES.items():
            js = driver.execute_script(
                "return arguments[0].map(function (n) {"
                "  return window.__ss.allowance(n, %d, %d, %d); });" % (num, den, fc),
                SWEEP)
            for n, got in zip(SWEEP, js):
                checks += 1
                if got != expected[name][n]:
                    fail("page allowance(%s, n=%d) = %s, expected %d"
                         % (name, n, got, expected[name][n]))
            print("   %-7s %d values: page JS agrees with the rational search" %
                  (name, len(SWEEP)))

        # 4b. required() for tracking
        js = driver.execute_script(
            "return arguments[0].map(function (n) {"
            "  return window.__ss.required(n, 19, 20); });", SWEEP)
        for n, got in zip(SWEEP, js):
            checks += 1
            want = required_by_search(n, *TRACK)
            if got != want:
                fail("page required(%d, 19, 20) = %s, expected %d" % (n, got, want))
        print("   track   %d values: page JS agrees on the 95%% minimum" % len(SWEEP))

        # 4c. recover(): must be the smallest k that gets back inside, and must work
        RECOVER_CASES = []
        for name, (num, den, fc) in RULES.items():
            for n in (0, 25, 40, 100, 150, 199, 200, 380, 500, 1000, 2500):
                for count in (0, 1, 2, 3, 5, 6, 8, 12, 30):
                    RECOVER_CASES.append((name, count, n, num, den, fc))
        js = driver.execute_script(
            "return arguments[0].map(function (c) {"
            "  return window.__ss.recover(c[0], c[1], c[2], c[3], c[4]); });",
            [[c, n, num, den, fc] for _, c, n, num, den, fc in RECOVER_CASES])
        for (name, count, n, num, den, fc), got in zip(RECOVER_CASES, js):
            want = recover_by_search(count, n, num, den, fc)
            checks += 1
            if got != want:
                fail("page recover(%s count=%d n=%d) = %s, expected %d"
                     % (name, count, n, got, want))
            # independently: the answer must land inside, and one fewer must not
            checks += 1
            if not meets(count, n + got, num, den, fc):
                fail("page recover(%s count=%d n=%d) = %s does not reach compliance"
                     % (name, count, n, got))
            if got > 0:
                checks += 1
                if meets(count, n + got - 1, num, den, fc):
                    fail("page recover(%s count=%d n=%d) = %s is one too many"
                         % (name, count, n, got))
        print("   recover %d cases: smallest k, and k-1 genuinely fails" %
              len(RECOVER_CASES))

        # 4d. recoverTracking(): raises numerator and denominator together
        TRACK_CASES = [(o, n) for n in (0, 20, 100, 101, 380, 1000)
                       for o in (0, 10, 80, 90, 95, 96, 100, 361, 370, 380, 1000)
                       if o <= max(n, 1)]
        js = driver.execute_script(
            "return arguments[0].map(function (c) {"
            "  return window.__ss.recoverTracking(c[0], c[1]); });",
            [[o, n] for o, n in TRACK_CASES])
        for (o, n), got in zip(TRACK_CASES, js):
            checks += 1
            want = recover_tracking_by_search(o, n)
            if got != want:
                fail("page recoverTracking(%d, %d) = %s, expected %d"
                     % (o, n, got, want))
            checks += 1
            if not tracking_ok(o + got, n + got):
                fail("page recoverTracking(%d, %d) = %s still under 95%%" % (o, n, got))
        print("   track   %d recovery cases: reaches exactly 95%%, not 94.x" %
              len(TRACK_CASES))

        # 4e. the evaluation window boundary, through the page
        for t3, t12, want in ((400, 900, 12), (401, 900, 3)):
            checks += 1
            got = driver.execute_script(
                "return window.__ss.evalWindow(arguments[0], arguments[1]).months;",
                t3, t12)
            if got != want:
                fail("page evalWindow(t3=%d) months = %s, expected %d" % (t3, got, want))
        print("   window  400 -> 12 months, 401 -> 3 months, through the page")

        # ------------------------------------------------------- 5. what it renders
        print("")
        print("5. WHAT THE PAGE ACTUALLY PRINTS")

        def set_and_read(**kw):
            driver.execute_script("""
                var v = arguments[0];
                Object.keys(v).forEach(function (k) {
                  var el = document.getElementById(k);
                  if (!el) throw new Error('no input ' + k);
                  el.value = v[k];
                  el.dispatchEvent(new Event('input'));
                });
            """, kw)
            return driver.execute_script("""
                return {
                  level: document.getElementById('level').textContent,
                  because: document.getElementById('because').textContent,
                  window: document.getElementById('window').textContent,
                  worth: document.getElementById('worth').textContent,
                  cls: document.getElementById('verdict').className,
                  rows: Array.from(document.querySelectorAll('#out tbody tr')).map(
                    function (r) {
                      return { cls: r.className,
                               cells: Array.from(r.children).map(function (c) {
                                 return c.textContent.trim(); }) };
                    })
                };
            """)

        # Defaults: a 380-transaction seller, 1 defect, 4 late, 370 tracked -> Top Rated
        r = set_and_read(t3=120, t12=380, sales=9500, age=400, defects=1, buyers=1,
                         cases=0, late=4, ontime=370, avg="29.95", fvf="13.6")
        checks += 1
        if r["level"] != "Top Rated":
            fail("default inputs render level %r, expected Top Rated" % r["level"])
        checks += 1
        if "trs" not in r["cls"]:
            fail("Top Rated verdict is not styled as a pass: %r" % r["cls"])
        checks += 1
        if "last 12 months" not in r["window"] or "380" not in r["window"]:
            fail("window line does not name the 12-month window and 380: %r"
                 % r["window"])
        print("   defaults -> %s  (%s)" % (r["level"], r["window"]))
        checks += 1
        if len(r["rows"]) != 6:
            fail("the requirement table has %d rows, expected 6" % len(r["rows"]))
        checks += 1
        if any(row["cls"] != "pass" for row in r["rows"]):
            fail("a requirement row is marked short on Top Rated defaults: %s"
                 % [(x["cells"][0][:28], x["cls"]) for x in r["rows"]])

        # The printed Top Rated limits must equal the searched allowances at n=380.
        n = 380
        want_limits = {
            0: expected["defect"][n],
            2: expected["cases"][n],
            3: expected["late"][n],
        }
        for idx, want in want_limits.items():
            checks += 1
            cell = r["rows"][idx]["cells"][2]
            lead = cell.split()[0].replace(",", "")
            if lead != str(want):
                fail("row %d printed limit %r, expected %d (n=%d)"
                     % (idx, cell, want, n))
        checks += 1
        if not r["rows"][4]["cells"][2].startswith("at least %d"
                                                   % required_by_search(n, *TRACK)):
            fail("tracking row printed limit %r, expected 'at least %d'"
                 % (r["rows"][4]["cells"][2], required_by_search(n, *TRACK)))
        print("   printed limits at n=380: defect %d, cases %d, late %d, track %d" %
              (want_limits[0], want_limits[2], want_limits[3],
               required_by_search(n, *TRACK)))

        # Headroom must be limit - yours on each passing row.
        for idx, key, yours in ((0, "defect", 1), (2, "cases", 0), (3, "late", 4)):
            checks += 1
            head = r["rows"][idx]["cells"][3]
            want = "+%d" % (expected[key][n] - yours)
            if head != want:
                fail("row %d printed headroom %r, expected %r" % (idx, head, want))
        print("   printed headroom is limit minus yours on every passing row")

        # The money line at the documented defaults.
        checks += 1
        if "$0.41" not in r["worth"] or "$4.07" not in r["worth"]:
            fail("worth line at $29.95/13.6%% does not show $0.41 of a $4.07 fee: %r"
                 % r["worth"])
        print("   worth: %s" % r["worth"][:96])

        # The small-seller case the page is named after: 40 transactions, 5 late.
        r2 = set_and_read(t3=10, t12=40, sales=1200, age=400, defects=0, buyers=0,
                          cases=0, late=5, ontime=40)
        checks += 1
        if r2["rows"][3]["cls"] != "pass":
            fail("5 late shipments on 40 transactions was flagged short; the page's "
                 "whole premise is that the fixed 5 applies at low volume")
        checks += 1
        if "the fixed 5" not in r2["rows"][3]["cells"][2]:
            fail("at n=40 the late limit cell does not say it is the fixed 5: %r"
                 % r2["rows"][3]["cells"][2])
        checks += 1
        if r2["level"] != "Above Standard":
            fail("40 transactions is under the 100-transaction minimum, so the level "
                 "should be Above Standard, not %r" % r2["level"])
        checks += 1
        if "volume minimums" not in r2["because"]:
            fail("the reason line does not name the volume minimums: %r" % r2["because"])
        print("   40 txns / 5 late -> late row passes on the fixed 5, level %s"
              % r2["level"])

        # 6 late on 40 transactions must flip it.
        r3 = set_and_read(late=6)
        checks += 1
        if r3["rows"][3]["cls"] != "fail":
            fail("6 late shipments on 40 transactions was not flagged short")
        checks += 1
        want_rec = recover_by_search(6, 40, 3, 100, 5)
        if str(want_rec) not in r3["rows"][3]["cells"][3]:
            fail("recovery cell %r does not contain the %d clean sales needed"
                 % (r3["rows"][3]["cells"][3], want_rec))
        print("   40 txns / 6 late -> short, needs %d more clean sales" % want_rec)

        # A genuinely Below Standard seller: 5% defects across many buyers.
        r4 = set_and_read(t3=100, t12=1000, sales=30000, age=500, defects=50,
                          buyers=50, cases=0, late=0, ontime=1000)
        checks += 1
        if r4["level"] != "Below Standard":
            fail("50 defects from 50 buyers on 1,000 transactions rendered %r"
                 % r4["level"])
        checks += 1
        if "below" not in r4["cls"]:
            fail("Below Standard verdict is not styled as a failure: %r" % r4["cls"])
        print("   1,000 txns / 50 defects / 50 buyers -> %s" % r4["level"])

        # The buyer shield eBay states: same rate, few buyers, must not be Below Standard.
        r5 = set_and_read(defects=50, buyers=3)
        checks += 1
        if r5["level"] == "Below Standard":
            fail("eBay states Below Standard needs defects from more than 4 different "
                 "buyers; 3 buyers rendered Below Standard anyway")
        print("   same 50 defects but only 3 buyers -> %s (eBay's buyer shield)"
              % r5["level"])

        # The 3-month window must actually engage above 400.
        r6 = set_and_read(t3=600, t12=2000, sales=60000, age=900, defects=3, buyers=3,
                          cases=0, late=10, ontime=600)
        checks += 1
        if "last 3 months" not in r6["window"] or "600" not in r6["window"]:
            fail("t3=600 did not switch the page to the 3-month window: %r"
                 % r6["window"])
        checks += 1
        want = expected["defect"][600]
        if r6["rows"][0]["cells"][2].split()[0] != str(want):
            fail("on the 3-month window the defect limit printed %r, expected %d"
                 % (r6["rows"][0]["cells"][2], want))
        print("   t3=600 -> judged on 3 months, defect limit %d not %d"
              % (want, expected["defect"][2000]))

        # 6. robustness: nothing may render NaN, undefined or null
        print("")
        print("6. NOTHING RENDERS NaN, undefined OR null")
        EDGE = [
            dict(t3=0, t12=0, sales=0, age=0, defects=0, buyers=0, cases=0, late=0,
                 ontime=0),
            dict(t3=0, t12=0, sales=0, age=0, defects=5, buyers=5, cases=5, late=5,
                 ontime=0),
            dict(t3=401, t12=0, sales=0, age=0, defects=1, buyers=1, cases=1, late=1,
                 ontime=1),
            dict(t12=1, ontime=1, defects=1),
        ]
        for e in EDGE:
            checks += 1
            out = set_and_read(**e)
            blob = out["level"] + out["because"] + out["window"] + out["worth"] + \
                "".join("".join(row["cells"]) for row in out["rows"])
            for bad in ("NaN", "undefined", "null", "Infinity"):
                if bad in blob:
                    fail("edge case %s rendered %r somewhere" % (e, bad))
        print("   %d edge cases incl. all-zero and zero-transaction: clean" % len(EDGE))

        # Emptied fields must not break the page either.
        checks += 1
        blob = driver.execute_script("""
            ['t3','t12','sales','age','defects','buyers','cases','late','ontime',
             'avg','fvf'].forEach(function (k) {
              var el = document.getElementById(k);
              el.value = ''; el.dispatchEvent(new Event('input'));
            });
            return document.getElementById('level').textContent +
                   document.getElementById('because').textContent +
                   document.getElementById('worth').textContent +
                   document.querySelector('#out tbody').textContent;
        """)
        for bad in ("NaN", "undefined", "null", "Infinity"):
            if bad in blob:
                fail("clearing every field rendered %r" % bad)
        print("   every field cleared at once: clean")

        # 7. the quoted rules table must come from the same constants
        print("")
        print("7. THE QUOTED THRESHOLDS MATCH THE ONES IT COMPUTES WITH")
        rules_txt = driver.execute_script(
            "return document.querySelector('#rules tbody').textContent;")
        for frag, why in (
            ("No more than 5 (or 3% of transactions)", "late shipment quote"),
            ("No more than 2 (or 0.3% of transactions)", "unresolved case quote"),
            ("No more than 0.5%, associated with no more than 3 different buyers",
             "defect quote"),
            ("No more than 2% of transactions", "Above Standard defect quote"),
            ("At least 95% of transactions have tracking uploaded within handling time",
             "tracking quote"),
        ):
            checks += 1
            if frag not in rules_txt:
                fail("the rules table is missing the %s: %r" % (why, frag))
        print("   all five verbatim eBay thresholds present in the rules table")

        # And the constants behind them must be the fractions this file asserts against.
        js_rules = driver.execute_script("""
            var R = window.__ss.RULES;
            return {defect: [R.defect.num, R.defect.den, R.defect.floorCount],
                    cases:  [R.cases.num,  R.cases.den,  R.cases.floorCount],
                    late:   [R.late.num,   R.late.den,   R.late.floorCount],
                    track:  [R.track.num,  R.track.den]};
        """)
        for name, want in list(RULES.items()) + [("track", TRACK)]:
            checks += 1
            got = tuple(js_rules[name])
            if got != tuple(want):
                fail("page RULES.%s is %s, this harness asserts against %s"
                     % (name, got, tuple(want)))
        print("   page constants: %s" % js_rules)

        # 8. no console errors
        print("")
        checks += 1
        errs = [e for e in driver.get_log("browser")
                if e.get("level") == "SEVERE" and "favicon" not in e.get("message", "")
                and "fonts.googleapis" not in e.get("message", "")]
        if errs:
            fail("severe console errors: %s" % [e["message"][:140] for e in errs])
        print("8. SEVERE CONSOLE ERRORS: %d" % len(errs))

        # 9. the page is server-renderable: the prose a crawler needs is in the HTML
        checks += 1
        html = driver.execute_script("return document.documentElement.outerHTML;")
        for frag in ("How many late shipments before you lose Top Rated",
                     "whichever is larger",
                     "seller-standards.html"):
            if frag not in html:
                fail("static HTML is missing %r" % frag)
        with open(PAGE, "r", encoding="utf-8") as fh:
            raw = fh.read()
        for frag in ("<title>eBay Seller Standards Checker</title>",
                     'rel="canonical"',
                     "FAQPage",
                     "no carrier scan within your handling time"):
            checks += 1
            if frag not in raw:
                fail("the file on disk is missing %r" % frag)
        print("9. STATIC HTML CARRIES THE TITLE, CANONICAL, FAQ SCHEMA AND THE PROSE")

    finally:
        driver.quit()

    print("")
    print("=" * 72)
    print("assertions run: %d" % checks)
    if failures:
        print("FAILED (%d):" % len(failures))
        for f in failures[:40]:
            print("  - %s" % f)
        if len(failures) > 40:
            print("  ... and %d more" % (len(failures) - 40))
        return 1
    print("ALL PASSED - the allowances match a rational-arithmetic search of eBay's own")
    print("sentence, the fixed-5 clause holds to 199 and 3% overtakes at exactly 200,")
    print("recovery counts are minimal and actually reach compliance, and the page's")
    print("own JS agrees with all of it.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
