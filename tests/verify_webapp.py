#!/usr/bin/env python3
"""Browser test for the published title auditor.

Cycle 6 shipped the web app with an honest gap: there was no JavaScript runtime here,
so the rules were verified only as Python. This closes that gap by driving real Chrome
and asserting on the rendered DOM.

By default it tests the local index.html. Pass --url to run the same assertions
against a deployed copy, which is how the live site is checked before release.

Usage: python scripts/verify_webapp.py [--show]
Exit 0 = every assertion passed.
"""
import argparse
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGE = os.path.join(ROOT, "index.html")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--show", action="store_true", help="run with a visible window")
    ap.add_argument("--url", help="test a live URL instead of the local file, so the "
                                  "harness can verify what the public actually gets")
    args = ap.parse_args()

    from selenium import webdriver
    from selenium.webdriver.chrome.options import Options
    from selenium.webdriver.common.by import By
    from selenium.webdriver.support.ui import WebDriverWait
    from selenium.webdriver.support import expected_conditions as EC

    opts = Options()
    if not args.show:
        opts.add_argument("--headless=new")
    opts.add_argument("--window-size=1280,1400")
    opts.add_argument("--log-level=3")
    # Surface page errors instead of letting a broken script fail silently.
    opts.set_capability("goog:loggingPrefs", {"browser": "ALL"})

    failures, checks = [], 0
    driver = webdriver.Chrome(options=opts)
    try:
        target = args.url or ("file:///" + PAGE.replace("\\", "/"))
        print("testing: %s" % target)
        driver.get(target)
        WebDriverWait(driver, 15).until(
            EC.presence_of_element_located((By.CSS_SELECTOR, "#tiles .tile")))

        def check(label, cond, detail=""):
            nonlocal checks
            checks += 1
            if not cond:
                failures.append("%s %s" % (label, detail))

        # 1. Did the script run at all? An empty #tiles means it threw on load.
        tiles = driver.find_elements(By.CSS_SELECTOR, "#tiles .tile")
        check("TILES_RENDERED", len(tiles) == 5, "got %d tiles, expected 5" % len(tiles))

        # Labels are keyed lowercase: CSS text-transform uppercases them for display, and
        # Selenium's .text returns the RENDERED text, so a mixed-case key never matches.
        summary = {}
        for t in tiles:
            k = t.find_element(By.CSS_SELECTOR, ".k").text.strip().lower()
            v = t.find_element(By.CSS_SELECTOR, ".v").text.strip()
            summary[k] = v
        print("summary tiles:")
        for k, v in summary.items():
            print("   %-20s %s" % (k, v.replace("\n", " ")))

        # 2. All 20 sample titles audited on load.
        check("AUDITED_20", summary.get("titles audited") == "20",
              "got %r" % summary.get("titles audited"))

        # 3. Findings table populated.
        rows = driver.find_elements(By.CSS_SELECTOR, "#rules tbody tr")
        check("RULES_TABLE", len(rows) >= 5, "only %d rule rows" % len(rows))

        # 4. Listing cards rendered, worst first.
        cards = driver.find_elements(By.CSS_SELECTOR, "#listings .listing")
        check("CARDS_RENDERED", len(cards) == 20, "got %d cards" % len(cards))
        scores = []
        for c in cards:
            txt = c.find_element(By.CSS_SELECTOR, ".score").text
            scores.append(int(txt.split("/")[0]))
        check("SORTED_WORST_FIRST", scores == sorted(scores),
              "scores not ascending: %s" % scores[:6])

        # 5. The regression that mattered: "L@@K ... WOW" must not leave an "L K"
        #    fragment behind. This is the exact bug found in the Python version.
        body = driver.find_element(By.TAG_NAME, "body").text
        check("NO_LK_FRAGMENT", "L K Vintage" not in body,
              "the 'L@@K' -> 'L K' fragment bug is present")
        check("SEIKO_FIXED", "Vintage Seiko Watch" in body,
              "expected the cleaned Seiko title")

        # 6. Trading-card rarity must survive: "Holo Rare" is a real rarity tier.
        check("RARITY_PRESERVED", "Holo Rare 125/197" in body,
              "'Holo Rare' was stripped from the Charizard title")

        # 7. Inverted author names fixed, and NOT mangled.
        check("AUTHOR_FIXED", "by Alex Michaelides" in body,
              "'Michaelides, Alex' was not reordered")
        check("AUTHOR_NOT_MANGLED", "Michaelides" in body and "Alex Hardcover" not in body,
              "author reorder corrupted the title")

        # 8. No rewrite may exceed the 80-character limit.
        over = []
        for c in cards:
            for el in c.find_elements(By.CSS_SELECTOR, ".meter-num"):
                used = int(el.text.split("/")[0].strip())
                if used > 80:
                    over.append(used)
        check("NONE_OVER_80", not over, "lengths over limit: %s" % over)

        # 9. Interaction: Clear then Audit should report nothing to audit.
        driver.find_element(By.ID, "clear").click()
        driver.find_element(By.ID, "run").click()
        status = driver.find_element(By.ID, "status").text
        check("EMPTY_INPUT_HANDLED", "at least one title" in status.lower(),
              "status said %r" % status)

        # 10. Reload sample via the button.
        driver.find_element(By.ID, "sample").click()
        WebDriverWait(driver, 10).until(
            lambda d: len(d.find_elements(By.CSS_SELECTOR, "#listings .listing")) == 20)
        check("SAMPLE_BUTTON", True)

        # 11. A CSV paste with a header must use the Title column, not split on the
        #     author comma. This is the parser bug fixed before publishing.
        ta = driver.find_element(By.ID, "input")
        ta.clear()
        ta.send_keys('SKU,Title\n'
                     'A1,"The Silent Patient - Hardcover By Michaelides, Alex - Very Good"\n'
                     'A2,Pyrex Mixing Bowl Set\n')
        driver.find_element(By.ID, "run").click()
        WebDriverWait(driver, 10).until(
            lambda d: len(d.find_elements(By.CSS_SELECTOR, "#listings .listing")) == 2)
        body2 = driver.find_element(By.TAG_NAME, "body").text
        check("CSV_HEADER_MODE", "Michaelides" in body2 and "Very Good" in body2,
              "the CSV row was truncated at the author comma")
        check("CSV_ROW_COUNT",
              len(driver.find_elements(By.CSS_SELECTOR, "#listings .listing")) == 2)

        # 12. No JavaScript errors anywhere in the run.
        errs = [e for e in driver.get_log("browser")
                if e.get("level") == "SEVERE" and "favicon" not in e.get("message", "")
                and "fonts.googleapis" not in e.get("message", "")]
        check("NO_JS_ERRORS", not errs,
              "console errors: %s" % [e["message"][:160] for e in errs])

        if args.show:
            driver.save_screenshot(os.path.join(ROOT, "webapp_render.png"))
            print("screenshot -> webapp_render.png")
    finally:
        driver.quit()

    print("\nassertions run : %d" % checks)
    if failures:
        print("FAILED (%d):" % len(failures))
        for f in failures:
            print("  - %s" % f)
        return 1
    print("ALL CHECKS PASSED -- the published JavaScript runs correctly in Chrome.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
