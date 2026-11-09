# APEX Expert: workflow edition

The **APEX Expert** as plain n8n workflows: AI Agent nodes with workflow
tools, no n8n Agents feature. It does the same work as the Agents edition,
with the same prompts, skills and tools: it answers APEX / SQL / PL/SQL
questions, inspects and changes the apps of one workspace, and builds new
apps with an Analyst, a Developer, a DB Tester and a UI Tester. After the first install the Analyst reviews the test cases against the installed app before the testers run.

This folder runs its **own n8n instance** (port 5692, its own data folder),
so it can run next to another n8n on the same machine.

**How to use the agent** (what to ask, builds, tests, sample data):
[docs/USING-THE-AGENT.md](docs/USING-THE-AGENT.md). In this edition there is
only the chat page, and database changes always run without an approval
click (see **Differences** below).

## Install (Windows)

1. Requirements:
   - Node.js 18+
   - n8n 2.43.x (`npm install -g n8n@2.43.8`)
   - SQLcl
   - Microsoft Edge or Chrome (for UI_Test)
   - network access to the database and ORDS (VPN)
   - an Anthropic API key (or the company AI gateway)
2. Open a terminal in this folder and run `npm install`.
3. Copy `.env.example` to `.env`. Keep `N8N_BASE_URL=http://localhost:5692`
   (or choose another free port) and fill in the rest after step 5.
4. Start n8n: `powershell -ExecutionPolicy Bypass -File scripts\start-n8n.ps1`.
   It starts n8n on the port of `N8N_BASE_URL` (task runner broker on the
   next port) with its data in `~\.n8n-apex-expert-workflow` (or
   `N8N_USER_FOLDER` in `.env`), and sets what the tool Code nodes need
   (`NODE_FUNCTION_ALLOW_BUILTIN=fs,path,child_process`,
   `N8N_RUNNERS_TASK_TIMEOUT=300`). Keep that terminal open.
5. Open `http://localhost:5692`, create the owner account, then
   **Settings → API → Create an API key**. Put the key into `N8N_API_KEY`
   and the owner login into `N8N_EMAIL` / `N8N_PASSWORD` in `.env`.
6. Run `node scripts/patch-n8n-tool-history.mjs` once per n8n install, then
   restart n8n. It fixes n8n's AI Agent node, which otherwise shows the model
   its earlier tool calls without their arguments (see **Local n8n patch**).
   This edition runs on that node, so the patch matters here.
7. In n8n, create an **Anthropic** credential named `Anthropic account`, or
   put your credential's name in `credentialName` in
   `agents/apex-expert/apex-expert.json`. In the same file, set `ordsBaseUrl`
   to your ORDS address.
8. Save a SQLcl connection with its password: `sql /nolog`, then
   `conn -save <connection name> -savepwd <user>/<password>@//<host>:<port>/<service>`.
9. Copy `squad-install.config.example.json` to `squad-install.config.json`
   and set the SQLcl path (absolute).
10. Fill in the database target in `.env`: `APEX_CONNECTION` (the connection
    from step 8), `APEX_WORKSPACE`, `APEX_SCHEMA`, and the APEX test user
    `APEX_TEST_USER` / `APEX_TEST_PASSWORD` for Page_Check and UI_Test.
11. Run `node scripts/squad-install.mjs --probe` (checks the connection), then
    `node scripts/build-apex-workflows.mjs`. It prints the chat URL.
12. Open the chat URL in the browser where you are logged in to n8n, or open
    the workflow **APEX Expert Chat** and use its Chat button.

## What the build creates

| Workflow | What it is |
|---|---|
| APEX Expert Chat | Chat Trigger → the lead, an AI Agent with Simple Memory and all its tools |
| APEX Analyst | Sub-agent: writes the technical spec `spec.md` |
| APEX Developer | Sub-agent: builds or fixes the app, checks and installs it |
| APEX DB Tester | Sub-agent: one item per call, the gate (compile, INVALID objects, the app exists, every page loads) or one Database Test Case (DB-n) of `spec.md` with SQL; PASS / FAIL with evidence |
| APEX UI Tester | Sub-agent: ONE UI Test Case (UI-n) of `spec.md` per call, in a browser; the lead calls it once per test case |
| APEX_Agent_Tools | DB_Target, New_Project, SQL_Query, SQL_Execute, Export_App, Check_App, Install_App, Page_Check, UI_Test, View_Screenshot |
| APEX_Skills | Load_Skill: a skill's instructions or one of its reference files |
| FS_Workspace_Tool | FS_List, FS_Read, FS_Write, FS_Delete (imported from `workflows/`) |
| Squad_APEXlang_Tools | Valid_Props, Example (imported from `workflows/`) |

Every agent is an AI Agent node with:
- an Anthropic Chat Model node: the model from `apex-expert.json`, prompt
  caching on (1 hour for the lead, which waits for sub-agents and for you;
  5 minutes for the sub-agents), up to 32,000 output tokens, adaptive
  thinking for the lead (medium) and the Developer (low);
- one Call n8n Workflow Tool node per tool, with the same descriptions as
  in the Agents edition;
- its iteration limit: lead 200, Analyst 40, Developer 100, DB Tester 15 (per gate or test case), UI Tester 25 (per test case).

The lead calls the sub-agents through the tools **Ask_Analyst**,
**Ask_Developer**, **Ask_DB_Tester** and **Ask_UI_Tester** (goal, context, expectedOutput). Each
call is a separate execution of that sub-agent's workflow, so you can follow
and cost every sub-agent run in **Executions**. A sub-agent that stops (for
example at its iteration limit) answers the lead with the error instead of
failing the chat.

The ids of this n8n's workflows are written to
`agents/apex-expert/apex-expert.workflows.local.json` (git-ignored). Run the
build again after you change a prompt, a skill, a tool or `apex-expert.json`;
it updates the same workflows.

## Differences from the Agents edition

- **Skills.** n8n agent skills exist only in the Agents feature. Here each
  agent has the tool **Load_Skill** (workflow APEX_Skills), and its system
  message lists its skills. The build writes the skills, with their Oracle
  reference files, to `agents/apex-expert/skills.built.json`, which
  Load_Skill reads. The skill texts come from `agents/apex-expert/skills/`;
  the build replaces the Agents edition's wording (`load_skill`,
  `delegate_subagent`, approval clicks) and stops when a text it replaces is
  no longer found.
- **No approvals.** A workflow execution cannot pause for an approval click,
  so SQL_Execute and Install_App run at once. The lead and the Developer get
  the same rule as the Agents edition's chat workflow: the lead asks in the
  chat before dropping or changing existing objects, deleting data or
  overwriting an existing app.
- **Memory.** The lead keeps the last 30 exchanges per chat session in a
  Simple Memory node. That memory lives in the n8n process: after a restart
  of n8n the agent no longer remembers earlier chats. Give it the project
  key and the application id to continue.
- **Sub-agents** are separate workflows, not saved agents.

## Tools, database target, install, UI_Test

The tools, the database target in `.env` (`APEX_CONNECTION`,
`APEX_WORKSPACE`, `APEX_SCHEMA`, optionally `ORDS_BASE_URL` and
`APEX_APP_URL`), `squad-install.config.json`, Install_App and UI_Test work
exactly as in the Agents edition. Projects are folders under this folder's
`workspace/`, separate from any other installation.

`@@PROJECT_ROOT@@`, `@@USER_HOME@@` and `@@NODE_EXE@@` in the sources are
filled in when workflows are sent to n8n (`scripts/lib/env.mjs`), so the
Code nodes point to this folder.

## Layout

```
agents/apex-expert/   apex-expert.json (models, credential name, ORDS URL), prompts/, skills/, src/
                      (agent-tools.js, view-screenshot.js, load-skill.js); written by the build:
                      apex-expert.workflows.local.json (this n8n's ids), skills.built.json
agents/src/           shared-helpers.js: the helper block in every tool Code node
apexlang-skill/       vendored copy of Oracle's official APEXlang skill package
docs/                 USING-THE-AGENT.md: the user guide
scripts/              build-apex-workflows.mjs, start-n8n.ps1, apex-agent-db.mjs (database tools),
                      squad-install.mjs (Install_App), squad-examples.mjs (Example tool),
                      patch-n8n-tool-history.mjs, pull.js / push.js,
                      lib/ (env, n8n API, roles/tools/skills definitions, SQLcl, UI test)
workflows/            <name>__.json: templates of the two helper workflows (imported on a fresh n8n);
                      <name>__<id>.json: this n8n's workflows as saved by the build (git-ignored)
workspace/            one folder per project (8-char key); .apex-agent/sql-log/; .squad-install/ (app pins)
```

## Local n8n patch

`scripts/patch-n8n-tool-history.mjs` patches the installed n8n's AI Agent
node (`@n8n/n8n-nodes-langchain/.../ToolsAgent/common.js`): its
`fixEmptyContentMessage()` turned the input of every earlier tool call into
`{}` in the history sent to Claude, so agents believed they had called tools
without arguments. The patch restores the real arguments. **Re-run it after
every n8n upgrade, then restart n8n.** `--check` shows whether it is in
place, `--revert` undoes it. It patches the n8n installation, so it applies
to every n8n instance started from it.
