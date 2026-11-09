---
name: Requirements to APEX technical spec
description: Use when turning a functional requirement (a user's description of an app or a change) into the technical requirement spec.md for an Oracle APEX app - data model, pages, components, security, database test cases and UI test cases. This is the Analyst's main task. Not for writing APEXlang or SQL code.
---
## Overview
Produce `spec.md`: a complete, testable technical requirement for an APEX app (the APEX version DB_Target reports) that a developer can build in APEXlang without asking questions, and that two testers run without guessing: the DB Tester runs its Database Test Cases (DB-n) with SQL, the UI Tester runs its UI Test Cases (UI-n) in a browser. There are no separate acceptance criteria: the test cases ARE the acceptance criteria, and the user confirms them with the spec.

## Inputs
- The requirement text, the project key, and for a change the exported app under app/.
- Existing database objects (SQL_Query on user_tables, user_tab_columns, user_constraints) and existing apps (apex_applications, apex_application_pages).

## Steps
1. Extract from the requirement: actors/roles, entities and their attributes, actions per entity (list, search, create, edit, delete, approve ...), rules (statuses, required fields, uniqueness, who may do what), outputs (reports, charts, exports, emails).
2. Check the database: reuse existing tables and columns; note name clashes.
3. Design the data model: table per entity, identity PK `ID`, FKs with indexes, check constraints for status values, NOT NULL for required fields, audit columns only if asked, seed data for lookups. Give EVERY constraint a name (TRIPS_PK, TRIPS_OWNER_FK, TRIPS_STATUS_CK, TRIPS_DATES_CK).
4. Map functions to APEX building blocks (load apexlang-pages for the choice): list + search -> interactive report / faceted search; edit -> modal form; bulk edit -> interactive grid; KPIs -> dashboard with charts or cards; dates -> calendar. Each FK column -> select list on a LOV. Navigation menu entries for top-level pages.
5. Security: authentication (Oracle APEX Accounts by default), authorization schemes if roles differ, which pages/buttons each role sees.
6. Write the Pages section with every name a test will use (see "The test contract").
7. Write the Database Test Cases (DB-n) and the UI Test Cases (UI-n): every requirement is proved by at least one of them, and a requirement without a test case is never tested.
8. Verify the database test SQL (see "Verify before you write") and fix every query that errors for a wrong name.
9. Write spec.md with FS_Write in the template below; list open questions and assumptions.

## The test contract (why the testers never guess)
The testers may use only names that spec.md defines, and the Developer must build exactly those names. So:
- Data Model: every table with every column (exact name, type, NULL / NOT NULL), and every constraint by name and type (PK, FK -> table, CHECK with its condition, UNIQUE with its columns).
- Pages: per page its number, name and type; per region its title and static id (e.g. trips-ir); per item its name (P11_TRIP_NAME), type, label and whether it is required; per button its name and its label exactly as shown ("Create", "Save", "Delete"); every success and error message text exactly ("Trip created.", "End Date must be on or after Start Date."); which page a button or link leads to, and which dialog closes.
- A test case names nothing that is not in Data Model, Pages or Shared Components. If a test needs a name, add it there first.
- Only three placeholders exist, and the testers replace them mechanically: `<app id>` (the installed application id), `<test user>` (the user UI_Test and Page_Check log in as, upper case), and dates as `today + N days`. No other placeholder, no "e.g.", no "or similar".
- Expected results are literal: the exact rows or values a query returns, the exact texts a page shows. Never "a row exists", "an error appears", "the report works".

## Database Test Cases (DB-n)
- Run by the DB Tester with SQL_Query: ONE read-only SELECT (or WITH) per test case, never insert, update, delete or PL/SQL. It checks what the database and the APEX dictionary say: tables, columns, constraints, indexes, seed rows, views, LOV queries, pages, regions (source, static id), items (display_as, LOV, required), buttons, processes, validations, authorization schemes, navigation entries.
- DB-1 is always the data-model contract: one query on user_tab_columns for all tables of the spec (`table_name, column_name, data_type, nullable` ordered by table_name, column_id), expected = every row of the Data Model. DB-2 is the constraint contract (user_constraints: constraint_name, constraint_type, search_condition_vc, r_constraint_name, delete_rule, with `constraint_name not like 'SYS_%'` so NOT NULL's system constraints stay out). DB-3 is the page-item contract (apex_application_page_items of application `<app id>`: page_id, item_name, display_as, lov_named_lov for every item of the Pages section). Then one DB-n per further rule.
- What a user is stopped from doing (a constraint, a validation) is tested twice: the constraint or validation row here (DB-n), the message the user sees as a UI test case (UI-n).
- Each test case: "Proves:" (the requirement in one line), "SQL:" (the statement, ready to run once `<app id>` / `<test user>` are replaced), "Expected:" (the literal rows in column order, or "0 rows", or one value).

## UI Test Cases (UI-n)
- Run by the UI Tester with UI_Test: what a user does in the browser and what the page then shows.
- Each test case: "Proves:", "Start:" (page number), numbered "Steps:" with the real names (button labels as shown, item names, the values to enter; dates as `today + N days`; the Tester types them in the format the field shows), "Expected:" (the exact texts shown, the page it ends on, values in items), "SQL after:" (one SELECT that confirms what changed in the tables, with its literal expected result), "Cleanup:" (the steps that delete the data it created, through the app).
- Every UI test case stands alone: one browser scenario that creates its own data, checks, and deletes that data, under 30 steps. Never split setup, check and cleanup into separate test cases, and never rely on sample data or on another test case. A longer flow becomes several test cases, each creating and deleting its own data with its own names.
- Test data values start with "UITEST " and are unique per test case ("UITEST trip UI-4"). Data a user cannot create through the app (e.g. a row of another user) goes into the Test Data section as SQL inserts; the Developer runs them after the install.
- Dates: the same app can show date items in different formats (M/D/YYYY on one page, YYYY-MM-DD on another); give the date as `today + N days` and let the Tester read each field's format.
- Pages render: the UI Tester always loads every page with Page_Check; do not write a test case for that.
- APEX's own report features (the Interactive Report Actions menu) are not UI test cases; if the requirement names one, test its setting as a DB-n on apex_application_page_ir.

## Verify before you write
- Run the SQL of every DB-n that reads the APEX dictionary or existing objects with SQL_Query before you write spec.md, with `<app id>` replaced by 0 and `<test user>` by 'NOBODY'. It must run (0 rows is fine). ORA-00904 (invalid identifier) or ORA-00942 on a dictionary view means a wrong name: look the columns up (`select column_name from all_tab_columns where table_name = 'APEX_APPLICATION_AUTH' order by column_id`) and fix the query. Never guess a dictionary column.
- A DB-n on the app's own new tables cannot run yet (ORA-00942 is expected): check by reading that every table and column it names is in your Data Model.
- Several queries can be verified in one call (UNION ALL of `select count(*) from (<query>)`), or as independent calls in the same turn.

## Rules
- Use real names everywhere (tables, columns, constraints, page numbers, item names P<page>_<COLUMN>, button labels, static ids); no placeholders except the three above.
- Page 1 is the home page; 9999 login; 0 global page; number other pages in steps (2, 3 ... or 10, 20 ...), forms right after their reports.
- Only page and component types APEXlang has (check Example / Valid_Props when unsure).
- Keep scope to the requirement; propose extras only under "Optional".

## Example
spec.md template (fill every section):
```
# <App name> -- technical requirement
## Goal
## Users and Security
Authentication: ... | Roles and authorization schemes: ... | Access per page: ...
## Data Model
### TRIPS  (new | existing)
| Column | Type | Null | Notes |
Constraints: TRIPS_PK primary key (ID); TRIPS_STATUS_CK check (STATUS in ('PLANNED','DONE')); ...
Seed data: ...
## Pages
### Page 10 -- Trips (interactive report, normal)
Purpose / Source / Regions (title, static id) / Items (name, type, label, required) / Buttons (name, label as shown, action) / Processes / Validations (message text) / Dynamic actions / Messages (exact texts) / Navigation (from where, to where)
## Shared Components
LOVs (name, query), lists (navigation menu entries), breadcrumbs, authorization schemes, application items
## Test Data
SQL the Developer runs after every install; only for data a user cannot create in the app:
  insert into trips (trip_name, owner_user, ...) values ('UITEST other user trip', 'UITEST_OTHER', ...);
## Database Test Cases
### DB-1 -- tables and columns (contract)
Proves: the data model is built as specified.
SQL: select table_name, column_name, data_type, nullable from user_tab_columns where table_name in ('TRIPS', 'ITINERARY_ITEMS') order by table_name, column_id
Expected: TRIPS,ID,NUMBER,N | TRIPS,TRIP_NAME,VARCHAR2,N | ... (every column of the Data Model, in this order)
### DB-4 -- end date not before start date
Proves: a trip cannot end before it starts.
SQL: select search_condition_vc from user_constraints where constraint_name = 'TRIPS_DATES_CK'
Expected: end_date >= start_date
## UI Test Cases
### UI-1 -- create a trip
Proves: a user creates a trip from the trips list.
Start: page 10
Steps: 1. Click "Create Trip" -> modal page 11. 2. Fill P11_TRIP_NAME "UITEST trip UI-1", P11_START_DATE today + 30 days, P11_END_DATE today + 34 days, P11_BUDGET_AMOUNT 750. 3. Click "Create".
Expected: the dialog closes; page 10 shows "Trip created." and "UITEST trip UI-1".
SQL after: select count(*) from trips where trip_name = 'UITEST trip UI-1' and owner_user = '<test user>' -> 1
Cleanup: click "UITEST trip UI-1" on page 10, click "Delete", confirm "Delete".
## Assumptions
## Open Questions
## Optional
```

## Gotchas
- A modal form must say how it closes and which report region refreshes.
- Status workflows need an allowed-values LOV and a check constraint with the same values.
- "Users can only see their own records" -> a WHERE clause on :APP_USER in the report source plus a check on the form; write both into the spec, a DB-n for the region source and a UI-n with the other user's row from Test Data.
- Reference files (load_skill with this skill and filePath):
  - `references/application-spec.template.md` -- Oracle's own application-spec template (load before writing; your spec.md may follow it more closely for large apps).
  - `references/workflow-create-app-from-fr-and-model.md` -- Oracle's workflow from functional requirements to an app.
  - `references/apexlang-skeleton-prompt.md` -- what an app skeleton must contain.
  - `references/apex.schema-modeling.md` -- Oracle's data-model conventions.
  - `references/apex.page.md`, `references/apex.layout.md` -- page and layout rules.
