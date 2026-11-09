---
name: Test an APEX app's database and metadata
description: Use when running the gate or ONE Database Test Case (DB-n) of spec.md against an installed APEX application - the DB Tester's main task - or when the user asks to verify tables, constraints, seed data or an app's components through SQL and the APEX dictionary. The gate is the SQLcl compile, INVALID objects, the app and Page_Check of every page; a test case is one read-only query compared literally. Returns PASS or FAIL with evidence. Never fixes.
---
## Overview
Run the ONE item your goal names -- the gate, or one DB-n exactly as written -- and return its result line, the finding with evidence, and a PASS/FAIL verdict. The APEX Expert gives you the items one at a time and decides what is rerun; the other DB-n and the UI test cases are not yours in this call.

## Inputs
- Project key (session) with spec.md and app/; application id.
- Tools: Check_App, SQL_Query, Page_Check, FS_Read, FS_List, DB_Target.

## Steps
1. FS_Read spec.md once. Your test cases are under "Database Test Cases"; the names they use are defined under "Data Model", "Pages" and "Shared Components".
2. Gate (goal "Run the gate ..."), the four checks in one turn:
   - Check_App(session): PASSED with 0 errors, else a FAIL finding with the compiler messages.
   - `select object_type, object_name from user_objects where status = 'INVALID' and object_name in (<the tables, views, packages, triggers spec.md names>)` -- any row is a FAIL finding (with `select name, line, text from user_errors where name in (...)`). Older INVALID objects of other apps are not findings.
   - `select application_id, alias, pages from apex_applications where application_id = <id>` -- the app exists.
   - Page_Check(app_id, "all"): every page loads without an APEX/ORA error. For a page that fails, run Page_Check on it again with debug "yes" and put the trace's error line and component into the finding. Modal pages are opened outside their dialog; Page_Check accounts for that.
3. Test case (goal "Run database test case DB-n ..."): take that one DB-n. Replace its placeholders: `<app id>` = the application id, `<test user>` = the test user DB_Target names (upper case). Nothing else in the SQL changes. Run it with one SQL_Query.
4. Compare the result with Expected literally: the same rows in the same order, the same values (case as given; ignore only surrounding whitespace and the quoting of CSV output). Contract queries (DB-1..DB-3): list every missing, extra or different row in the finding. One more query is allowed only to explain a FAIL (e.g. what the constraint is called instead), never to change the verdict.
5. Write the answer in the DB Tester's final format; last line PASS or FAIL.

## When a query errors
- ORA-00942 (table or view does not exist) or ORA-00904 (invalid identifier) for a name that spec.md defines (a table, column or constraint of its Data Model, an item of its Pages): the app lacks it -> FAIL; the finding names the object and the supporting-objects script or page file.
- The same errors for a name spec.md does not define (a dictionary view column, a typo in the test): "DB-n NOT RUN -- needs revision: <the ORA message>" and a finding for the Analyst. Do not repair the query, do not look for a similar column.
- ORA-01722, ORA-01843 and similar data errors: FAIL with the message; the data does not match the model.

## Rules
- Gate PASS only if all four checks pass. DB-n PASS only if the result matches Expected; FAIL and NOT RUN (needs revision included) give the verdict FAIL.
- Never run a second DB-n, and never the gate in a test-case call (or the reverse).
- Findings name the place to fix: app/supporting-objects/<script>.sql and the object, or app/pages/p000NN-*.apx and the component.
- Do not report APEXlang syntax opinions when Check_App passed.
- Never ask the user questions; you report to the APEX Expert.

## Example
Goal DB-4, SQL `select search_condition_vc from user_constraints where constraint_name = 'TRIPS_DATES_CK'`, Expected `end_date >= start_date` -> 0 rows -> FAIL finding 1: constraint TRIPS_DATES_CK is missing (app/supporting-objects/01-tables.sql: add `constraint trips_dates_ck check (end_date >= start_date)`).
Goal DB-9, SQL `select is_current_yn from apex_application_auth where application_id = 141` -> ORA-00904 "IS_CURRENT_YN": invalid identifier -> DB-9 NOT RUN -- needs revision: ORA-00904 on apex_application_auth.is_current_yn (finding for the Analyst).

## Gotchas
- SQL_Query returns CSV with at most 200 rows; a contract query over many tables may need one query per table.
- Dictionary values are upper case (item names, display_as like "Text Field", constraint types P/R/C/U).
- A NOT NULL column also appears in user_constraints as a C constraint with a system name (SYS_C...); contract queries filter on constraint_name not like 'SYS_%' when the spec names only its own constraints.
- Load inspect-apps when a finding needs a dictionary view explained.
