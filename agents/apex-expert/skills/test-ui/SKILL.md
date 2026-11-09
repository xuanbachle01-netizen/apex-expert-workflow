---
name: Test an APEX app in the browser
description: Use when running a UI Test Case (UI-n) of spec.md against an installed APEX application - the UI Tester's main task, one test case per run - or when the user asks to test forms, buttons or dialogs in a browser. Runs one UI_Test scenario, confirms what changed with SQL, and returns PASS or FAIL with evidence. Never fixes.
---
## Overview
Turn the one UI test case you were given into one browser scenario, run it, and return its result, the finding with evidence, and a PASS/FAIL verdict. The gate (compile, every page loads) and the database test cases (DB-n) are the DB Tester's; do not run them.

## Inputs
- Project key (session) with spec.md; application id; the test case (UI-n) named in the goal.
- Tools: Page_Check, UI_Test, View_Screenshot, SQL_Query, FS_List, FS_Read.

## Steps
1. FS_Read spec.md once (it always comes back whole). Your test case is under "UI Test Cases"; the names it uses (items, button labels, region static ids, message texts) are defined under "Pages".
2. Retest (only when your context says "Retest: rerun tests/ui-N.json"): rerun that file once with steps "tests/ui-N.json" (no save_as); write a new scenario only when the context says spec.md changed the test case, or the rerun failed because the scenario (not the app) is wrong.
3. For your UI-n:
   - Replace the placeholders: `<test user>` = the test user DB_Target names (upper case), `today + N days` = that date in the format the field shows, `<app id>` = the application id.
   - One UI_Test scenario, save_as "ui-N": "go" to its Start page, its Steps in order, one "see" / "seePage" / "seeItem" per Expected result (exact texts), then its Cleanup steps. No checks of your own.
   - Its "SQL after" query with SQL_Query, compared with its literal expected result.
   - UI-n passes when the scenario and the SQL after both pass.
4. A FAIL that the result does not explain (an APEX error page, "Error processing request", a step that does nothing): run the same scenario again with debug "yes" and put the debug trace's error line and component into the finding. That rerun counts as the test case's second run.
5. Write the answer in the UI Tester's final format; last line PASS or FAIL.

## UI_Test scenarios
- Learning a page is free: a scenario of just `[{"go": 3}]` reports its regions, buttons and items (names, labels, select-list options). Use it when a step's control is not found, to tell "the app lacks it" (FAIL) from "the test names it wrongly" (needs revision).
- Exploring scenarios (trying something) use save_as "-"; UI_Test allows only a few per test run and refuses any save_as name other than "ui-N".
- Two failed runs of one test case are the limit: UI_Test then refuses it with REFUSED. Report it as NOT RUN with the error it quotes and go on. When you correct a scenario, save it again under the same name; UI_Test keeps it only if it passes or the saved one never passed.
- UI_Test refuses scenarios of other test cases and reruns of a scenario that already PASSED in your run. A PASS is final: report it, do not rerun it to "confirm" or to add steps.
- Use the labels the page shows for clicks ("Create", "Save", "Delete", a menu entry), and item names (P4_NAME) for fills -- both as spec.md's Pages section gives them.
- Create flow: `[{"go": 3}, {"click": "Create"}, {"seePage": 4}, {"fill": "P4_NAME", "value": "UITEST task UI-1"}, {"fill": "P4_STATUS", "value": "Open"}, {"click": "Create"}, {"seePage": 3}, {"see": "UITEST task UI-1"}]`, then the test case's SQL after.
- Validation: leave a required item empty, click Save, then `{"see": "<the expected message>"}`; a FAIL on that check is the finding.
- Edit / delete: open the UITEST row you created (click its link text), change or delete it, check the result. Never touch rows you did not create.

## APEX UI patterns (Universal Theme)
These cost earlier runs many retries; use them from the first scenario.
- Escape CLOSES a modal dialog. Use `{"press": "Escape"}` only when a date picker's calendar is open (a click timed out with "locator.click: Timeout", or the result shows "dialog asks: Month January February ...") -- never right after the dialog opens.
- Dates: every date item has its own format, and one app can mix them (M/D/YYYY on one page, YYYY-MM-DD on another). Use the format THAT item shows: its value in the learn run, or its validation message ("must be a valid date, for example 2026-11-05" -> type "2027-02-03"; "for example 11/5/2026" -> "2/3/2027"). Never carry a format over from another page.
- A date picker can open by itself after a failed Create (the focus goes to the date item) and cover the error message: then `{"press": "Escape"}` once (it closes the calendar, not the dialog), `{"wait": 1}`, and check the message.
- Interactive Report edit icon: its label is "Edit" (not "Link"). `{"click": "Edit"}` opens the FIRST row; click has no "nth". To open a given row, narrow the report first (search below) so it is the first row, or click the row's link text if it has one.
- Interactive Report search (it works; the press right after the fill goes into the field): the field is `<region static id>_search_field` (the static id from spec.md's Pages section), e.g. `{"fill": "expenses-ir_search_field", "value": "UITEST"}, {"press": "Enter"}, {"wait": 2}`. It is not a page item like P10_SEARCH.
- Delete in a form: APEX asks to confirm in a dialog whose button is "Delete" again (not "OK"): `{"click": "Delete"}, {"wait": 1}, {"click": "Delete"}`. A UI_Test result lists an open confirmation's buttons.
- Interactive Report Actions menu (Filter, Sort, Columns, ...): do not drive it; it is APEX's own feature, not the app's.

## Rules
- PASS only if the scenario and its SQL after passed. NOT RUN is a FAIL verdict with the reason in the result line.
- A step names something the page does not have: FAIL if spec.md's Pages section defines it (finding for the Developer: the page file and component), otherwise "UI-n needs revision: ..." (for the Analyst). Never try other names.
- Findings name the place to fix: file app/pages/p000NN-*.apx and the component name.
- Never ask the user questions; you report to the APEX Expert.

## Example
UI-6 "create a trip": UI_Test 141 `[{"go": 10}, {"click": "Create Trip"}, ...]` save_as "ui-6" -> "FAIL 5 click \"Create\" -- database error shown: ORA-01400: cannot insert NULL into TRIPS.OWNER_USER" -> FAIL finding 1: the form process inserts without OWNER_USER; spec.md Data Model gives it the default :APP_USER (01-tables.sql or a page process default on page 11).

## Gotchas
- Page_Check only proves pages render (the DB Tester already ran it on every page); use it yourself only with debug "yes" to explain a page error.
- A UI_Test action that fails stops the scenario (the page is in an unknown state); failed "see"/"seeItem"/"seePage" checks do not. Read the "Ended on" part of the result before writing the next scenario.
- Steps act inside an open modal dialog until it closes; after the dialog's Create/Save the scenario is back on the calling page.
- Item and component names are upper case in UI_Test.
- If UI_Test reports LOGIN FAILED or NOT CONFIGURED, report NOT RUN with that message; do not guess.
- Load debug-runtime when a page fails, to name the cause in the finding.
- Page_Check opens modal pages outside their dialog; the debug trace leaves out the "Dialog page cannot be rendered" error that APEX logs for that. Test modal pages with UI_Test.
- View_Screenshot answers from the image only. Ask one precise question per call ("Is the row 'UITEST task 1' highlighted red?"), not "is everything fine?". A screenshot is the full page at 1366 px width; a modal dialog shows on top of its parent page.
