// What the two editions of the APEX Expert share: the roles, their prompts and skills, the
// tools with their descriptions, and the tool workflow APEX_Agent_Tools.
//   scripts/build-apex-expert.mjs    n8n Agents (agents with skills and saved sub-agents)
//   scripts/build-apex-workflows.mjs classic workflows (AI Agent nodes, workflow tools)
// Both editions send the same text to the model; only how n8n runs it differs.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, render } from './env.mjs';

export const DIR = path.join(ROOT, 'agents', 'apex-expert');
export const read = (...p) => fs.readFileSync(path.join(...p), 'utf8').replace(/\r\n/g, '\n');

// ---------------------------------------------------------------- roles
export const ROLES = {
  analyst: {
    name: 'APEX Analyst',
    description: 'Turns a user requirement into the technical requirement spec.md for an Oracle APEX app (data model, pages, components, security, database and UI test cases), and after the install reviews the test cases against the installed app.',
    prompt: 'analyst.md',
    tools: ['DB_Target', 'SQL_Query', 'Export_App', 'FS_List', 'FS_Read', 'FS_Write', 'Valid_Props', 'Example'],
    skills: ['oracle-apexlang', 'requirements-to-spec', 'review-test-cases', 'inspect-apps', 'apexlang-pages'],
    maxIterations: 40,
  },
  developer: {
    name: 'APEX Developer',
    description: 'Builds or changes an Oracle APEX app in APEXlang + SQL/PL/SQL from spec.md, checks it with the live compiler (SQLcl) and installs it.',
    prompt: 'developer.md',
    tools: ['DB_Target', 'FS_List', 'FS_Read', 'FS_Write', 'FS_Delete', 'Check_App', 'Install_App', 'SQL_Query', 'SQL_Execute', 'Export_App', 'Valid_Props', 'Example'],
    skills: ['oracle-apexlang', 'sql-plsql', 'apexlang-edit', 'apexlang-pages', 'apexlang-components', 'sample-data'],
    maxIterations: 100,
    reasoning: 'low',
  },
  dbtester: {
    name: 'APEX DB Tester',
    description: 'Runs ONE item per call against an installed Oracle APEX app: the gate (SQLcl compile, INVALID objects, the app exists, every page loads) or ONE database test case (DB-n) of spec.md, a read-only query on the tables and the APEX dictionary. Returns PASS or FAIL with evidence.',
    prompt: 'db-tester.md',
    tools: ['DB_Target', 'Check_App', 'SQL_Query', 'Page_Check', 'FS_List', 'FS_Read'],
    skills: ['test-database', 'inspect-apps', 'debug-runtime'],
    maxIterations: 15,
  },
  uitester: {
    name: 'APEX UI Tester',
    description: 'Runs ONE UI test case (UI-n) of spec.md against an installed Oracle APEX app in a real browser: one UI_Test scenario (forms, buttons, dialogs, messages) and its SQL check. Returns PASS or FAIL with evidence.',
    prompt: 'ui-tester.md',
    tools: ['DB_Target', 'SQL_Query', 'Page_Check', 'UI_Test', 'View_Screenshot', 'FS_List', 'FS_Read'],
    skills: ['test-ui', 'debug-runtime', 'inspect-apps'],
    maxIterations: 25,
  },
  lead: {
    name: 'APEX Expert',
    description: 'Oracle APEX expert for one APEX workspace: answers APEX/SQL/PL/SQL questions, inspects and changes apps, and builds new apps with its Analyst, Developer, DB Tester and UI Tester sub-agents.',
    prompt: 'lead.md',
    tools: ['DB_Target', 'New_Project', 'SQL_Query', 'SQL_Execute', 'Export_App', 'Check_App', 'Install_App', 'Page_Check', 'UI_Test', 'View_Screenshot', 'FS_List', 'FS_Read', 'FS_Write', 'FS_Delete', 'Valid_Props', 'Example'],
    skills: ['oracle-apexlang', 'inspect-apps', 'sql-plsql', 'debug-runtime', 'apexlang-edit', 'build-and-test-loop', 'sample-data'],
    maxIterations: 200,
    reasoning: 'medium',
  },
};
// When the lead hands work to a sub-agent.
export const SUB_AGENT_USE = {
  analyst: 'Step 1 of a build (skill build-and-test-loop): turn the user\'s requirement into spec.md. Pass the requirement verbatim, the project key, and for a change the application id; on a revision the user\'s answers. Also step 2b, after the Developer\'s first install: goal = "Review the test cases of spec.md against the installed application <id>" (it corrects test case details the spec left open and reports App Deviations; it never weakens a test).',
  developer: 'Step 2 of a build, after the user confirmed spec.md: build or fix the app and install it. Pass the project key, the application id once known, and on a fix round the testers\' findings verbatim.',
  dbtester: 'Step 3 of a build, after the Developer reports Check_App PASSED and an application id: ONE item per call. First goal = "Run the gate of application <id>" (compile, INVALID objects, the app exists, every page loads), then goal = "Run database test case DB-<n> of spec.md against application <id>" (exactly one DB-n) for each DB-n of your test plan. context = Target lines, project key, application id, and on a retest its previous finding. One call per response, never two at once.',
  uitester: 'Step 4 of a build, after the DB test cases of the round (skip it when the DB Tester\'s gate failed): ONE UI test case of spec.md per call, in a browser. goal = "Run UI test case UI-<n> of spec.md against application <id>" (exactly one UI-n); context = Target lines, project key, application id, sample data, and on a retest its previous finding. Call it once per UI test case, one call per response, never two at once.',
};

// The model id without n8n Agents' provider prefix ("anthropic/claude-sonnet-5-5" -> "claude-sonnet-5-5").
export const modelId = (m) => String(m).replace(/^anthropic\//, '');

// ---------------------------------------------------------------- approvals
// Where the user cannot click an approval (a workflow execution cannot pause for one), the
// lead and the Developer get this rule instead, and the tool descriptions lose their approval note.
export const NO_APPROVAL_RULE = {
  lead: [
    '- SQL_Execute and Install_App change the database. The user approves each call in the chat. Before calling one, say in one or two sentences what it will change. Never chain several unrelated changes into one script. If the user rejects a call, do not retry it; ask what they want instead.',
    '- SQL_Execute and Install_App change the database and run IMMEDIATELY in this chat: there is no approval click here. So before any change that deletes data, drops or alters an existing object, or updates an existing application (Install_App on a project made by Export_App), describe it and ask the user to confirm in their next message; run it only after a clear yes. New objects of a build whose spec the user confirmed need no further confirmation. Never chain several unrelated changes into one script.',
  ],
  developer: [
    '- Install_App (scripts + validate + import) changes the database: the user approves each call. Call it only after Check_App has PASSED, normally once per task, plus once after a fix.',
    '- Install_App (scripts + validate + import) changes the database and runs immediately (no approval in this channel). Call it only after Check_App has PASSED, normally once per task, plus once after a fix. Never drop, truncate or delete from existing tables, and never use Export_App + Install_App on an application the spec does not name.',
  ],
};
export function noApprovalInstructions(text, role) {
  const [from, to] = NO_APPROVAL_RULE[role];
  if (!text.includes(from)) throw new Error('prompts/' + role + '.md: approval rule not found; update NO_APPROVAL_RULE in scripts/lib/apex-expert-defs.mjs');
  return text.replace(from, to);
}
export const noApprovalDescription = (d) => (d || '').replace(/ The user must approve each call\./g, '');

// ---------------------------------------------------------------- skills
const LIMITS = { instructions: 65536, refs: 20, ref: 65536, total: 262144 };
// One skill from agents/apex-expert/skills/<slug>/: SKILL.md (frontmatter name + description, then the
// instructions) and references.json (files of Oracle's APEXlang skill package under skillSource).
export function buildSkill(slug, skillSource) {
  const raw = read(DIR, 'skills', slug, 'SKILL.md');
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error('skills/' + slug + '/SKILL.md: missing frontmatter');
  const front = Object.fromEntries(m[1].split('\n').map((l) => l.match(/^(\w+):\s*(.*)$/)).filter(Boolean).map((x) => [x[1], x[2].trim()]));
  const skill = { name: front.name, description: front.description, instructions: m[2].trim() };
  const refFile = path.join(DIR, 'skills', slug, 'references.json');
  const source = path.resolve(ROOT, skillSource || 'apexlang-skill');
  if (fs.existsSync(refFile)) {
    const refs = [];
    for (const r of JSON.parse(read(refFile))) {
      if (r.dir) {
        const dir = path.join(source, r.dir);
        for (const f of fs.readdirSync(dir).filter((x) => /\.md$/i.test(x)).sort()) refs.push({ path: r.as + f, content: read(dir, f) });
      } else {
        refs.push({ path: r.path, content: read(source, r.from) });
      }
    }
    if (refs.length) skill.references = refs;
  }
  Object.assign(skill, render(skill));
  const total = (skill.references || []).reduce((n, r) => n + r.content.length, 0);
  const problems = [];
  if (!skill.name || skill.name.length > 128) problems.push('name');
  if (!skill.description || skill.description.length > 512) problems.push('description is ' + (skill.description || '').length + ' chars (max 512)');
  if (skill.instructions.length > LIMITS.instructions) problems.push('instructions too long');
  if ((skill.references || []).length > LIMITS.refs) problems.push((skill.references || []).length + ' references (max 20)');
  for (const r of skill.references || []) {
    if (r.content.length > LIMITS.ref) problems.push(r.path + ' too long');
    if (!/^references\/.+\.md$/.test(r.path)) problems.push(r.path + ': must be references/....md');
  }
  if (total > LIMITS.total) problems.push('references total ' + total + ' chars (max 262144)');
  // Every reference the body names must exist, and every reference must be named in the body.
  const named = new Set([...skill.instructions.matchAll(/`(references\/[^`]+\.md)`/g)].map((x) => x[1]));
  for (const r of skill.references || []) if (!named.has(r.path)) problems.push(r.path + ' is not mentioned in the instructions');
  for (const p of named) if (!(skill.references || []).some((r) => r.path === p)) problems.push('instructions name ' + p + ', which is not a reference');
  if (problems.length) throw new Error('skill ' + slug + ': ' + problems.join('; '));
  return { skill, stats: skill.name + ': instructions ' + skill.instructions.length + ', ' + (skill.references || []).length + ' refs, ' + total + ' chars' };
}

// ---------------------------------------------------------------- tools
export const TOOL_INPUTS = ['operation', 'session', 'app_id', 'sql', 'pages', 'mode', 'steps', 'debug', 'file_path', 'question', 'save_as', 'run', 'scope'];
// Hand-made tool workflows the agents also use, by key.
export const HELPERS = { fs: 'FS_Workspace_Tool', apx: 'Squad_APEXlang_Tools' };
const P = ' session = the 8-character project key (from New_Project, or given in your task).';
const DEBUG = ' debug = "yes" turns APEX debug on for the tool\'s own session and adds a debug trace (per page view its time and the errors / warnings logged with the messages before them, from apex_debug_messages) -- use it when something fails or is slow; "no" otherwise (faster).';
// Every tool: the workflow it runs ('tools' = APEX_Agent_Tools, else a HELPERS key), the operation
// (APEX_Agent_Tools) or the fixed inputs (helpers), the inputs the model fills, and whether the user
// approves each call (where approvals exist).
export const TOOLS = {
  DB_Target: { wf: 'tools', op: 'target', ai: [], description: 'Get the database target every tool works on, read live from the database: SQLcl connection, schema, database product and version, APEX version and workspace, the URL apps run at, and the SQLcl compiler version. Call it once at the start of a task, before you name any of these or write version-dependent code. No input.' },
  New_Project: { wf: 'tools', op: 'new_project', ai: ['mode'], description: 'Create a new project folder and return its PROJECT key (pass it as session to every project tool and sub-agent). mode = "scaffold" for a NEW application (Oracle\'s valid baseline app is put under app/), or "empty" for a folder that Export_App fills with an existing application.' },
  SQL_Query: { wf: 'tools', op: 'query', ai: ['sql'], description: 'Run ONE read-only SELECT (or WITH ... SELECT) on the target schema (see DB_Target) and get the result as CSV (max 200 rows). Use it for the APEX dictionary views (apex_applications, apex_application_pages, ...), user_* views and data. Runs in a read-only transaction; anything else is refused. sql = the statement.' },
  SQL_Execute: { wf: 'tools', op: 'execute', ai: ['sql'], approval: true, description: 'Run a SQL / PL/SQL script on the target schema (see DB_Target) and COMMIT it: DDL, DML, packages, anonymous blocks. The user must approve each call. End SQL statements with ";" and PL/SQL units with a line containing only "/"; no EXIT, CONNECT, HOST, SPOOL, @file or & variables. Returns errors per statement, compile errors and the INVALID objects of the schema. sql = the script.' },
  Export_App: { wf: 'tools', op: 'export', ai: ['session', 'app_id'], description: 'Export an existing APEX application of the target workspace as APEXlang into app/ of an EMPTY project (New_Project with mode "empty"). The project is then pinned to that application: Install_App on it updates the application in place.' + P + ' app_id = the numeric application id.' },
  Check_App: { wf: 'tools', op: 'validate', ai: ['session'], description: 'THE validator: compile the project\'s app with the live APEX compiler through SQLcl (apex validate on the target connection). No import, no changes. Returns PASSED, or every compile error (file, line, message with the valid values) plus warnings.' + P },
  Install_App: { wf: 'tools', op: 'install', ai: ['session'], approval: true, description: 'Install the project\'s app into the target database with SQLcl: runs the scripts under app/supporting-objects/, compiles and imports the app. Creates a new application on the first install of a scaffolded project, otherwise UPDATES the pinned application in place. The user must approve each call. Call it only after Check_App PASSED. Returns INSTALLED with the application id, or the SQL / compile / import errors.' + P },
  Page_Check: { wf: 'tools', op: 'page_check', ai: ['app_id', 'pages', 'debug'], description: 'Load pages of an installed application through ORDS, logged in as the test user, and report per page the HTTP status, the title and any APEX/ORA error shown. Rendering only (no clicks). app_id = the numeric application id; pages = "all" or a comma-separated list of page numbers.' + DEBUG },
  UI_Test: {
    wf: 'tools', op: 'ui_test', ai: ['app_id', 'steps', 'session', 'debug', 'save_as'],
    description: 'Use an installed application like a user, in a real (headless) browser logged in as the test user: open pages, fill items, click buttons and links, work inside modal dialogs, and check what is shown. One call runs one scenario (at most 40 steps, about 85 s) and reports each step (ok / FAIL, the page it led to, success and error messages, JavaScript and server errors), then the page it ended on with its regions, buttons, items and text, so you can write the next scenario. A failed action stops the scenario; failed checks do not. app_id = the numeric application id. ' +
      'steps = a JSON array, one action per step: {"go": <page number or alias>} | {"fill": "P10_NAME", "value": "text"} (select lists, radio groups and switches by label; popup LOVs by return value; dates as shown in the field) | {"click": "<visible label of a button, link, tab or menu entry>"} | {"press": "Enter"} (right after a "fill" it goes to that field, e.g. an Interactive Report search; otherwise to the page) | {"wait": <seconds, max 10>} | {"see": "text"} | {"notSee": "text"} | {"seeItem": "P10_NAME", "value": "x"} | {"seePage": <number or alias>} | {"shot": "<name>"} (screenshot of the page as it is now). ' +
      'Example: [{"go": 3}, {"click": "Create"}, {"fill": "P4_NAME", "value": "Test"}, {"click": "Create"}, {"seePage": 3}, {"see": "Test"}]. steps may instead name a scenario file saved in the project, e.g. "tests/ui-1.json", to rerun it. ' +
      'save_as = a name such as "ui-1" to keep this scenario as tests/ui-1.json in the project (saved after the run; replaced when saved again, except that a version that did not pass never replaces one that passed), or "-" to not save it; ignored when steps names a file. ' +
      'session = the project key (screenshots and result.txt are saved under test-results/<save_as or file name, e.g. ui-7>/<time>/ there, explore/ when unsaved; also one screenshot at the end and one at a failed step; View_Screenshot looks at them) or "-" for none.' + DEBUG + ' With debug the scenario gets about 70 s instead of 85 s.',
  },
  View_Screenshot: { wf: 'tools', op: 'view_screenshot', ai: ['session', 'file_path', 'question'], description: 'Look at a UI_Test screenshot: a vision model sees the image and answers your question in text (you cannot see images yourself). Use it for what the page text cannot tell: layout, overlapping or cut-off elements, colours and highlighting, charts, icons, which message is shown where, empty or broken regions. file_path = a path from the "Screenshots:" line or a "shot" step of a UI_Test result, e.g. test-results/ui-7/2026-11-02T13-59-33/end.png; question = what to check, as specific as possible (e.g. "Are there three success messages? Quote them."), or "describe".' + P },
  FS_List: { wf: 'fs', fixed: { operation: 'list', file_path: '', content: '', offset: '' }, ai: ['session'], description: 'List every file in a project folder (path + size).' + P },
  FS_Read: { wf: 'fs', fixed: { operation: 'read', content: '' }, ai: ['session', 'file_path', 'offset'], description: 'Read ONE file of a project. spec.md always comes back whole. Other files come in parts of 15k chars: the result gives size, and when truncated is true, "next" names the offset to read the rest from. file_path = relative path exactly as FS_List shows it, e.g. app/pages/p00002-tasks.apx or spec.md; offset = 0 for the start (ignored for spec.md).' + P },
  FS_Write: { wf: 'fs', fixed: { operation: 'write', offset: '' }, ai: ['session', 'file_path', 'content'], description: 'Create or overwrite ONE file of a project. file_path = relative path with forward slashes; content = the COMPLETE file content (never a fragment). Folders are created automatically.' + P },
  FS_Delete: { wf: 'fs', fixed: { operation: 'delete', content: '', offset: '' }, ai: ['session', 'file_path'], description: 'Delete ONE file of a project, e.g. an experiment under scratch/. file_path exactly as FS_List shows it.' + P },
  Valid_Props: { wf: 'apx', fixed: { operation: 'props', name: '' }, ai: ['session', 'component', 'parent', 'group'], description: 'Look up the REAL property names, groups, required flags and allowed values of an APEXlang component type from the metadata of the SQLcl compiler. component = region, pageItem, button, process, dynamicAction, action, validation, column, lov, list, entry, ...; parent = disambiguation (region for column, dynamicAction for action) or "-" when not needed; group = one property group (layout, source, behavior, ...) or "-" for all groups.' + P },
  Example: { wf: 'apx', fixed: { operation: 'example', component: '', parent: '', group: '' }, ai: ['session', 'name'], description: 'Read Oracle\'s own APEXlang code from the example library: full pages (form-page, interactive-report-page, dashboard-page, classic-report-page, ...), regions (chart, cards, form, ...), items (select-list, date-picker, ...), buttons, dynamic actions (dynamic-actions.close-dialog, ...), processes (processes.form-initialization, ...), validations and shared components. name = an example name, a family name to list its files, or a search word.' + P },
};
// The fixed inputs of a tool: APEX_Agent_Tools gets every input ('' unless the model fills it).
export function toolFixed(t) {
  if (t.wf !== 'tools') return t.fixed;
  const fixed = { ...Object.fromEntries(TOOL_INPUTS.map((k) => [k, ''])), operation: t.op };
  for (const k of t.ai) delete fixed[k];
  return fixed;
}

// ---------------------------------------------------------------- tool workflow
// The model that looks at screenshots (View_Screenshot): visionModel in apex-expert.json, else the UI Tester's.
const visionModel = (cfg) => modelId(cfg.visionModel || cfg.models.uitester || cfg.models.tester);
const ifNode = (id, name, position, leftValue, operation, rightValue) => ({
  id, name, type: 'n8n-nodes-base.if', typeVersion: 2.2, position,
  parameters: {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
      conditions: [{ id: id + '-c', leftValue, rightValue, operator: { type: 'string', operation, ...(rightValue === undefined ? { singleValue: true } : {}) } }],
      combinator: 'and',
    },
    options: {},
  },
});
// n8n gives the agent the output of the LAST node that ran, so every branch ends in a node whose item has "result".
const SCREENSHOT_ANSWER = `const r = $input.first().json;
const file = $('Load Screenshot').first().json.file;
const text = Array.isArray(r.content) ? r.content.filter((c) => c.type === 'text').map((c) => c.text).join('\\n').trim() : '';
const error = r.error ? (r.error.message || JSON.stringify(r.error)) : 'the model gave no answer';
return [{ json: { result: text ? 'View_Screenshot (' + file + '):\\n' + text : 'View_Screenshot: UNAVAILABLE -- ' + String(error).slice(0, 500) } }];`;
// cfg: models, visionModel, credentialId, credentialName (apex-expert.json + the edition's local ids).
export function toolsWorkflow(cfg) {
  const helpers = read(ROOT, 'agents', 'src', 'shared-helpers.js') + '\n';
  return render({
    name: 'APEX_Agent_Tools',
    nodes: [
      {
        id: 'c2d0a001-0000-4000-8000-000000000001',
        name: 'Notes',
        type: 'n8n-nodes-base.stickyNote',
        typeVersion: 1,
        position: [-420, -300],
        parameters: {
          width: 640, height: 340,
          content: '## APEX_Agent_Tools\nProject and database tools of the APEX Expert agents: DB_Target, New_Project, SQL_Query, SQL_Execute, Export_App, Check_App (SQLcl apex validate), Install_App, Page_Check (ORDS), UI_Test (browser), View_Screenshot.\n\nThe database work is done by scripts/apex-agent-db.mjs with SQLcl on APEX_CONNECTION / APEX_WORKSPACE from .env. n8n stops a workflow tool after 120 s, so every operation stays below that.\n\nView_Screenshot (lower branch): n8n gives agents no images, so the Anthropic node looks at the screenshot and answers in text.\n\nGenerated by scripts/build-apex-expert.mjs from agents/apex-expert/src/ -- edit there.',
        },
      },
      {
        id: 'c2d0a001-0000-4000-8000-000000000002',
        name: 'When Executed by Another Workflow',
        type: 'n8n-nodes-base.executeWorkflowTrigger',
        typeVersion: 1.1,
        position: [-380, 120],
        parameters: { workflowInputs: { values: TOOL_INPUTS.map((name) => ({ name, type: 'string' })) } },
      },
      ifNode('c2d0a001-0000-4000-8000-000000000004', 'Screenshot?', [-160, 120], '={{ $json.operation }}', 'equals', 'view_screenshot'),
      {
        id: 'c2d0a001-0000-4000-8000-000000000003',
        name: 'Run Tool',
        type: 'n8n-nodes-base.code',
        typeVersion: 2,
        position: [80, 220],
        parameters: { jsCode: helpers + read(DIR, 'src', 'agent-tools.js') },
      },
      {
        id: 'c2d0a001-0000-4000-8000-000000000005',
        name: 'Load Screenshot',
        type: 'n8n-nodes-base.code',
        typeVersion: 2,
        position: [80, 0],
        parameters: { jsCode: helpers + read(DIR, 'src', 'view-screenshot.js') },
      },
      ifNode('c2d0a001-0000-4000-8000-000000000006', 'Has Image', [300, 0], '={{ $json.prompt }}', 'notEmpty'),
      {
        id: 'c2d0a001-0000-4000-8000-000000000007',
        name: 'Look at Screenshot',
        type: '@n8n/n8n-nodes-langchain.anthropic',
        typeVersion: 1,
        position: [520, -100],
        parameters: {
          resource: 'image', operation: 'analyze',
          modelId: { __rl: true, mode: 'id', value: visionModel(cfg) },
          text: '={{ $json.prompt }}', inputType: 'binary', binaryPropertyName: 'data', simplify: true,
          options: { maxTokens: 1500 },
        },
        credentials: { anthropicApi: { id: cfg.credentialId, name: cfg.credentialName } },
        onError: 'continueRegularOutput',
      },
      {
        id: 'c2d0a001-0000-4000-8000-000000000008',
        name: 'Answer',
        type: 'n8n-nodes-base.code',
        typeVersion: 2,
        position: [740, -100],
        parameters: { jsCode: SCREENSHOT_ANSWER },
      },
    ],
    connections: {
      'When Executed by Another Workflow': { main: [[{ node: 'Screenshot?', type: 'main', index: 0 }]] },
      'Screenshot?': { main: [[{ node: 'Load Screenshot', type: 'main', index: 0 }], [{ node: 'Run Tool', type: 'main', index: 0 }]] },
      'Load Screenshot': { main: [[{ node: 'Has Image', type: 'main', index: 0 }]] },
      'Has Image': { main: [[{ node: 'Look at Screenshot', type: 'main', index: 0 }], []] },
      'Look at Screenshot': { main: [[{ node: 'Answer', type: 'main', index: 0 }]] },
    },
    settings: { executionOrder: 'v1' },
  });
}
