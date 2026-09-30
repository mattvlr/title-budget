#!/usr/bin/env python3
"""Acceptance tests for the Recursion Budget calculator.

The page makes exactly one substantive claim: that it tells you the worst-case number
of model calls a recursive run will make. That number is a geometric series, so it is
checkable rather than approximate, and a tool that gets it wrong is worse than no tool
because people will trust it.

So this loads the real page in Chrome and calls the page's own functions, rather than
a copy of them, and compares against an implementation written separately from the
series definition.

Usage: python tests/verify_recursion_budget.py
"""
import os
import sys


def calls_per_root(depth, branch):
    """1 + b + b^2 + ... + b^(depth-1), written independently of the page."""
    depth = max(0, int(depth))
    branch = max(1, int(branch))
    return sum(branch ** i for i in range(depth))


def total_calls(roots, depth, branch):
    return calls_per_root(depth, branch) * max(0, int(roots))


# Hand-checked values. The depth-6 / branch-5 case is the one quoted in the copy.
TABLE = [
    (1, 0, 5, 0),
    (1, 1, 5, 1),
    (1, 2, 5, 6),
    (1, 3, 5, 31),
    (1, 4, 5, 156),
    (1, 5, 5, 781),
    (1, 6, 5, 3906),
    (3, 3, 5, 93),
    (1, 3, 2, 7),
    (1, 4, 3, 40),
    (2, 4, 3, 80),
    (0, 5, 5, 0),
    (1, 5, 1, 5),       # branch 1 is a chain, not a tree
    (10, 2, 10, 110),
]

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGE = os.path.join(ROOT, "recursion-budget.html")


def main():
    failures, checks = [], 0

    print("CLOSED FORM vs HAND-CHECKED VALUES")
    for roots, depth, branch, expect in TABLE:
        checks += 1
        got = total_calls(roots, depth, branch)
        ok = got == expect
        print("  %2d root(s), d=%d, b=%-2d -> %7d  (expect %7d)  %s"
              % (roots, depth, branch, got, expect, "OK" if ok else "MISMATCH"))
        if not ok:
            failures.append("python total_calls(%d,%d,%d)=%d want %d"
                            % (roots, depth, branch, got, expect))

    # The series must also satisfy its own closed form, which is an independent check
    # on the loop: for b > 1, sum = (b^d - 1) / (b - 1).
    print("")
    print("LOOP AGREES WITH THE CLOSED FORM (b > 1)")
    for branch in (2, 3, 5, 7, 10):
        for depth in range(0, 8):
            checks += 1
            closed = (branch ** depth - 1) // (branch - 1)
            got = calls_per_root(depth, branch)
            if got != closed:
                failures.append("b=%d d=%d: loop %d vs closed form %d"
                                % (branch, depth, got, closed))
    print("  checked b in {2,3,5,7,10} x d in 0..7  %s"
          % ("OK" if not failures else "MISMATCH"))

    print("")
    print("MONOTONIC IN BOTH DIRECTIONS")
    checks += 1
    by_depth = [calls_per_root(d, 5) for d in range(0, 9)]
    if by_depth != sorted(by_depth):
        failures.append("not monotonic in depth: %s" % by_depth)
    print("  depth 0..8 at b=5: %s" % by_depth[:7])
    checks += 1
    by_branch = [calls_per_root(4, b) for b in range(1, 9)]
    if by_branch != sorted(by_branch):
        failures.append("not monotonic in branching: %s" % by_branch)
    print("  branch 1..8 at d=4: %s" % by_branch)

    # ------------------------------------------------------------------ the real page
    print("")
    print("THE PAGE'S OWN JS, RUN IN CHROME")
    from selenium import webdriver
    from selenium.webdriver.chrome.options import Options
    from selenium.webdriver.common.by import By
    from selenium.webdriver.support.ui import WebDriverWait
    from selenium.webdriver.support import expected_conditions as EC

    opts = Options()
    opts.add_argument("--headless=new")
    opts.add_argument("--window-size=1100,1600")
    opts.add_argument("--log-level=3")
    opts.set_capability("goog:loggingPrefs", {"browser": "ALL"})
    driver = webdriver.Chrome(options=opts)
    try:
        driver.get("file:///" + PAGE.replace("\\", "/"))
        WebDriverWait(driver, 15).until(
            EC.presence_of_element_located((By.ID, "calls")))

        got = driver.execute_script(
            "return arguments[0].map(function (c) {"
            "  return window.__rb.totalCalls(c[0], c[1], c[2]); });",
            [[r, d, b] for r, d, b, _ in TABLE])
        for (roots, depth, branch, expect), js in zip(TABLE, got):
            checks += 1
            ok = js == expect
            if not ok:
                failures.append("page JS total_calls(%d,%d,%d)=%s want %d"
                                % (roots, depth, branch, js, expect))
        print("  %d cases, page JS vs python: %s"
              % (len(TABLE), "all agree" if not [f for f in failures if 'page JS' in f]
                 else "MISMATCH"))

        # The headline must render a real number, and the budget verdict must flip.
        def set_and_read(roots, depth, branch, budget):
            return driver.execute_script("""
                var v = arguments[0];
                ['roots','depth','branch','budget'].forEach(function (k, i) {
                  var el = document.getElementById(k);
                  el.value = v[i];
                  el.dispatchEvent(new Event('input'));
                });
                return [document.getElementById('calls').textContent,
                        document.getElementById('verdict').textContent,
                        document.getElementById('calls').className];
            """, [roots, depth, branch, budget])

        checks += 1
        head, verdict, cls = set_and_read(1, 6, 5, 150)
        print("  d=6 b=5 budget=150 -> %r" % head)
        if "3,906" not in head:
            failures.append("headline did not show 3,906 at depth 6: %r" % head)
        checks += 1
        if "over" not in cls or "Over your" not in verdict:
            failures.append("a 3,906-call run under a 150 budget was not flagged over: "
                            "%r / %r" % (cls, verdict))
        print("     verdict: %s" % verdict.strip()[:78])

        checks += 1
        head2, verdict2, cls2 = set_and_read(1, 3, 5, 150)
        print("  d=3 b=5 budget=150 -> %r" % head2)
        if "31" not in head2:
            failures.append("headline did not show 31 at depth 3: %r" % head2)
        checks += 1
        if "ok" not in cls2 or "Inside your" not in verdict2:
            failures.append("a 31-call run inside a 150 budget was flagged over: "
                            "%r / %r" % (cls2, verdict2))

        # Zero and one-call edge cases must not render NaN or "undefined".
        for roots, depth, branch in ((0, 5, 5), (1, 0, 5), (1, 1, 5)):
            checks += 1
            h, _, _ = set_and_read(roots, depth, branch, 150)
            if "NaN" in h or "undefined" in h:
                failures.append("edge case r=%d d=%d b=%d rendered %r"
                                % (roots, depth, branch, h))

        # An emptied field must not blow up the page.
        checks += 1
        blank = driver.execute_script("""
            var el = document.getElementById('depth');
            el.value = ''; el.dispatchEvent(new Event('input'));
            return document.getElementById('calls').textContent;
        """)
        if "NaN" in blank or "undefined" in blank:
            failures.append("clearing the depth field rendered %r" % blank)
        print("  cleared depth field renders: %r" % blank)

        # The ladder must show every level and the 'added' column must be the delta.
        set_and_read(1, 6, 5, 150)
        checks += 1
        rows = driver.execute_script(
            "return Array.from(document.querySelectorAll('#ladder tr')).map("
            "  function (r) { return Array.from(r.children).map("
            "    function (c) { return c.textContent; }); });")
        if len(rows) < 6:
            failures.append("ladder has only %d rows" % len(rows))
        else:
            prev = 0
            for r in rows:
                total = int(r[1].replace(",", ""))
                added = int(r[2].replace("+", "").replace(",", ""))
                checks += 1
                if added != total - prev:
                    failures.append("ladder row %s: added %d but delta is %d"
                                    % (r[0], added, total - prev))
                prev = total
        print("  ladder rows: %d, deltas consistent" % len(rows))

        checks += 1
        errs = [e for e in driver.get_log("browser")
                if e.get("level") == "SEVERE" and "favicon" not in e.get("message", "")]
        if errs:
            failures.append("JS errors: %s" % [e["message"][:120] for e in errs])
        print("  severe console errors: %d" % len(errs))
    finally:
        driver.quit()

    print("")
    print("=" * 66)
    print("assertions run: %d" % checks)
    if failures:
        print("FAILED (%d):" % len(failures))
        for f in failures:
            print("  - %s" % f)
        return 1
    print("ALL PASSED - the call projection is exact, the page's own JS agrees with")
    print("an independent implementation, the budget verdict flips correctly, and")
    print("the edge cases render without NaN.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
