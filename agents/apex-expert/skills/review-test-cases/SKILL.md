---
name: Review the test cases against the installed app
description: Use after the Developer installed the app and before the testers run, when the APEX Expert asks the Analyst to review the test cases of spec.md against the installed application. Compares every name, label, message, navigation path and dictionary column the DB-n and UI-n use with what the app actually has, corrects the test cases where the spec left a detail open, and reports where the app differs from what the spec requires. Never weakens a test to fit the app.
---
## Overview
The spec was written before the app existed, so some test cases assume details the spec did not define: the label APEX gives a generated button, how the navigation reaches a page, a dictionary column, the format a date item shows. You look at the installed app and correct those details, so the testers do not fail on the test instead of the app. What the spec requires stays: where the app differs from a requirement, the app is wrong, not the test.

## Inputs
- Project key (session) with spec.md and the installed app's files under app/; the application id.
- Tools: SQL_Query (APEX dictionary views and the tables), FS_List / FS_Read (app/ files), FS_Write (spec.md only).

## Steps
1. FS_Read spec.md once: the Data Model, Pages, Shared Components, the Database Test Cases and the UI Test Cases.
2. Read what the app has, in as few turns as possible (independent SQL_Query calls in one turn):
   - pages: `select page_id, page_name, page_mode, page_alias from apex_application_pages where application_id = <id> order by page_id`
   - regions: `select page_id, region_name, static_id, source_type from apex_application_page_regions where application_id = <id> order by page_id, display_sequence`
   - items: `select page_id, item_name, label, display_as, item_default from apex_application_page_items where application_id = <id> order by page_id, display_sequence`
   - buttons: `select page_id, button_name, label, button_action from apex_application_page_buttons where application_id = <id> order by page_id, button_sequence`
   - navigation: `select entry_text, entry_target from apex_application_list_entries where application_id = <id> order by display_sequence`
   - messages: validations (`apex_application_page_val`: error_message) and processes (`apex_application_page_proc`: process_success_message)
   - your app's tables: user_tab_columns, user_constraints
   FS_Read an app/ page file only when a dictionary row does not answer the question (a dialog's confirm text, a dynamic action).
3. Go through every test case, step by step, and check each name, label, message and path it uses against what you read. Run every DB-n once with SQL_Query (placeholders replaced): it must run without an ORA error.
4. Sort each difference:
   - **Correct the test case** when the spec did not define the detail, or the test case uses it wrongly. Examples: a confirm dialog button the APEX template labels "Delete" while the test said "OK"; the menu entry text that leads to a page; a dictionary column that does not exist (ORA-00904 on a view); the order rows come back in when the spec did not define one; a UI test case of more than 40 browser actions (split it into UI-n and UI-na, each creating and deleting its own data).
   - **App deviation** when the spec defines the detail (a table, column, constraint, page number, item name, button label, static id, message text, a rule like "users see only their own trips") and the app has something else or nothing. Do NOT change the test case: report it for the Developer, with the spec line and what the app has.
5. FS_Write spec.md with the corrected test cases, changing nothing else. Append (or extend) a section at the end:
   ```
   ## Test Case Changes after the install
   - UI-4: confirm button "OK" -> "Delete" (the app's delete dialog uses the template label "Delete"; not defined in Pages)
   ```
6. Answer in the Analyst's review format (prompt, "Final answer of a review").

## Rules
- Never weaken a test: never drop an expectation, never loosen an expected value, never delete a test case, never replace a check of a requirement with a check of something else. A correction keeps what the test case proves (its "Proves:" line) and only fixes how it gets there.
- Never change the Data Model, Pages, Shared Components or any other requirement section. If a requirement itself turns out to be impossible in APEX, report it under App Deviations with "spec needs a decision" so the APEX Expert can ask the user.
- Evidence for every change and every deviation: the dictionary row or file line you saw.
- Test the test cases only by reading: you never run UI_Test, never change data, never fix the app.

## Gotchas
- Dictionary values are upper case (item names, button names, static ids are as written).
- A modal dialog's confirm button (delete) often comes from the theme, not from the page: read the page file's button or process, and say so when it is a template label.
- Sample data does not change test cases: a test case never depends on it.
