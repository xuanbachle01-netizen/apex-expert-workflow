#!/usr/bin/env node
// Builds the workflow edition of the APEX Expert: plain n8n workflows with AI Agent nodes, no
// n8n Agents feature. Same prompts, skills and tools as scripts/build-apex-expert.mjs (shared in
// scripts/lib/apex-expert-defs.mjs); what differs is how n8n runs them:
//   - every agent is an AI Agent node with an Anthropic Chat Model and one workflow tool node per tool;
//   - the sub-agents are workflows ("APEX Analyst", "APEX Developer", "APEX DB Tester", "APEX UI Tester")
//     that the lead calls as the tools Ask_Analyst, Ask_Developer, Ask_DB_Tester and Ask_UI_Tester
//     (goal, context, expectedOutput);
//   - skills are loaded with the tool Load_Skill (workflow APEX_Skills, which reads
//     agents/apex-expert/skills.built.json, written here);
//   - nothing waits for an approval click (a workflow execution cannot pause for one): the lead and
//     the Developer get the no-approval rule, as in the Agents edition's chat workflow;
//   - the lead's memory is a Simple Memory node per chat session (kept in n8n's process memory).
// Workflows: FS_Workspace_Tool and Squad_APEXlang_Tools (imported from workflows/<name>__.json on a fresh
// n8n), APEX_Agent_Tools, APEX_Skills, the four sub-agents and "APEX Expert Chat" (the chat page).
// Ids of this n8n go to agents/apex-expert/apex-expert.workflows.local.json (git-ignored).
//
// Usage: node scripts/build-apex-workflows.mjs [--check-skills]
//   --check-skills only builds the skills locally and prints their sizes.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, HOST, pub, editorSession } from './lib/n8n-agents.mjs';
import { render, templatize } from './lib/env.mjs';
import { DIR, read, ROLES, SUB_AGENT_USE, HELPERS, TOOLS, toolFixed, toolsWorkflow, buildSkill, modelId, noApprovalInstructions, noApprovalDescription } from './lib/apex-expert-defs.mjs';

const args = new Set(process.argv.slice(2));

// apex-expert.json holds the settings (shared with the Agents edition); apex-expert.workflows.local.json
// the ids of this edition's n8n.
const localPath = path.join(DIR, 'apex-expert.workflows.local.json');
const LOCAL_KEYS = ['credentialId', 'helperWorkflowIds', 'toolsWorkflowId', 'skillsWorkflowId', 'agentWorkflowIds', 'chatWorkflowId'];
const cfg = { ...JSON.parse(read(DIR, 'apex-expert.json')), ...(fs.existsSync(localPath) ? JSON.parse(read(localPath)) : {}) };
const saveCfg = () => fs.writeFileSync(localPath, JSON.stringify(Object.fromEntries(LOCAL_KEYS.filter((k) => cfg[k] !== undefined).map((k) => [k, cfg[k]])), null, 2) + '\n');
const SUBS = ['analyst', 'developer', 'dbtester', 'uitester'];
const ASK = { analyst: 'Ask_Analyst', developer: 'Ask_Developer', dbtester: 'Ask_DB_Tester', uitester: 'Ask_UI_Tester' };

// ---------------------------------------------------------------- skills
// The skills speak of the Agents edition's load_skill and delegate_subagent tools and of approval
// clicks; here they get this edition's words. Every replacement must still find its text, so a
// changed skill stops the build instead of leaving a wrong instruction.
const SKILL_TEXT = [
  [/load_skill with this skill and filePath/g, 'Load_Skill with this skill and file_path'],
  ['loaded with load_skill on this skill and a filePath', 'loaded with Load_Skill on this skill and a file_path'],
  ['The sub-agent ids are listed in the delegate_subagent tool description: APEX Analyst, APEX Developer, APEX DB Tester, APEX UI Tester. Never use "inline" for these steps.', 'The sub-agents are your tools Ask_Analyst, Ask_Developer, Ask_DB_Tester and Ask_UI_Tester (each takes goal, context and expectedOutput).'],
  ['delegate_subagent(subAgentId = Analyst id, ', 'Ask_Analyst('],
  ['delegate_subagent(subAgentId = Developer id, ', 'Ask_Developer('],
  ['delegate_subagent(subAgentId = DB Tester id, ', 'Ask_DB_Tester('],
  ['delegate_subagent(subAgentId = UI Tester id, ', 'Ask_UI_Tester('],
  [' The user approves the Developer\'s Install_App and SQL_Execute calls in the chat.', ' The Developer\'s Install_App and SQL_Execute calls run without an approval click.'],
  ['- If the user rejects an Install_App approval, the Developer stops; ask the user how to continue instead of re-delegating the same step.\n', ''],
  ['Install_App(session) -- the user approves it in chat; that approval is the import choice.', 'Install_App(session) -- it runs at once (no approval click in this edition); calling it is the import choice.'],
  [' (the user approves it in the editor chat)', ''],
  ['then call SQL_Execute (they approve it)', 'then call SQL_Execute (it runs at once)'],
];
function buildSkills() {
  const slugs = [...new Set(Object.values(ROLES).flatMap((r) => r.skills))];
  const skills = Object.fromEntries(slugs.map((s) => [s, buildSkill(s, cfg.skillSource).skill]));
  for (const [from, to] of SKILL_TEXT) {
    let found = false;
    for (const s of Object.values(skills)) {
      const next = s.instructions.split(from).join(to);
      if (next !== s.instructions) { found = true; s.instructions = next; }
    }
    if (!found) throw new Error('skills: text not found, update SKILL_TEXT in build-apex-workflows.mjs: ' + from);
  }
  for (const s of Object.values(skills)) {
    const left = s.instructions.match(/delegate_subagent|load_skill/);
    if (left) throw new Error('skill ' + s.name + ' still names ' + left[0] + ': add a replacement to SKILL_TEXT');
  }
  return { roles: Object.fromEntries(Object.entries(ROLES).map(([role, r]) => [role, r.skills])), skills };
}

// The system message: the role's prompt (without the approval rule where it has one) and its skills.
function systemMessage(role, skills) {
  let text = read(DIR, 'prompts', ROLES[role].prompt);
  if (role === 'lead' || role === 'developer') text = noApprovalInstructions(text, role);
  const list = ROLES[role].skills.map((s) => '- ' + s + ' (' + skills[s].name + '): ' + skills[s].description).join('\n');
  return text.trim() + '\n\n## Skills\nLoad_Skill(skill) returns a skill\'s instructions: load the skill that matches a task before you start it, and follow its steps. ' +
    'Load_Skill(skill, file_path) returns one of the reference files the instructions name. Your skills:\n' + list + '\n';
}

// ---------------------------------------------------------------- nodes
// Ids are stable per workflow and node, so a rebuild updates the same nodes.
const nodeId = (wf, n) => 'c2d0b' + String(wf).padStart(3, '0') + '-0000-4000-8000-' + String(n).padStart(12, '0');
const trigger = (id, inputs, position) => ({
  id, name: 'When Executed by Another Workflow', type: 'n8n-nodes-base.executeWorkflowTrigger', typeVersion: 1.1, position,
  parameters: { workflowInputs: { values: inputs.map((name) => ({ name, type: 'string' })) } },
});
const note = (id, content, position, width = 600, height = 280) => ({ id, name: 'Notes', type: 'n8n-nodes-base.stickyNote', typeVersion: 1, position, parameters: { width, height, content } });
const credential = () => ({ anthropicApi: { id: cfg.credentialId, name: cfg.credentialName } });

// A workflow tool: fixed inputs as given, the model fills the `ai` ones.
function toolNode(id, name, workflowId, workflowName, description, fixed, ai, position) {
  const value = { ...fixed };
  for (const k of ai) value[k] = "={{ $fromAI('" + k + "', '', 'string') }}";
  return {
    id, name, type: '@n8n/n8n-nodes-langchain.toolWorkflow', typeVersion: 2.2, position,
    parameters: {
      description,
      workflowId: { __rl: true, mode: 'list', value: workflowId, cachedResultName: workflowName },
      workflowInputs: {
        mappingMode: 'defineBelow', value, matchingColumns: [],
        schema: Object.keys(value).map((k) => ({ id: k, displayName: k, required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string', removed: false })),
        attemptToConvertTypes: false, convertFieldsToString: false,
      },
    },
  };
}
const WF_NAME = { tools: 'APEX_Agent_Tools', fs: HELPERS.fs, apx: HELPERS.apx };
const wfId = (key) => (key === 'tools' ? cfg.toolsWorkflowId : cfg.helperWorkflowIds[key]);

// One AI Agent with its model, optional memory and tools. Returns the nodes and their connections.
// The tool nodes sit in rows of 8 under the agent.
function agentNodes(w, role, { text, systemMessage: sys, caching, memory, streaming, extraTools = [] }) {
  const r = ROLES[role];
  const agentName = r.name;
  const tools = r.tools.map((name) => {
    const t = TOOLS[name];
    const fixed = toolFixed(t);
    // The UI Tester's UI_Test passes its execution id as run: UI_Test then applies its limits
    // (scenarios named ui-N, few exploring runs, a test case refused after two failed runs).
    // The lead gives it one test case per call, named in the goal ("Run UI test case UI-4 ..."):
    // that number is the scope, and UI_Test refuses scenarios of other test cases.
    if (role === 'uitester' && name === 'UI_Test') {
      fixed.run = '={{ $execution.id }}';
      fixed.scope = "={{ (String($('When Executed by Another Workflow').first().json.goal || '').match(/\\bUI-\\d+/gi) || []).map((s) => s.slice(3)).join(',') }}";
    }
    return [name, wfId(t.wf), WF_NAME[t.wf], noApprovalDescription(t.description), fixed, t.ai];
  });
  tools.push(['Load_Skill', cfg.skillsWorkflowId, 'APEX_Skills', 'Load one of your skills (listed in your instructions): skill = its name, e.g. "' + r.skills[1] + '"; file_path = "-" for its instructions, or a reference file they name, e.g. "references/...md".', { role }, ['skill', 'file_path']]);
  tools.push(...extraTools);
  const nodes = [{
    id: nodeId(w, 10), name: agentName, type: '@n8n/n8n-nodes-langchain.agent', typeVersion: 3.1, position: [0, 0],
    parameters: { promptType: 'define', text, options: { systemMessage: sys, maxIterations: r.maxIterations, enableStreaming: Boolean(streaming) } },
    ...(streaming ? {} : { onError: 'continueRegularOutput' }),
  }, {
    id: nodeId(w, 11), name: 'Claude (' + r.name + ')', type: '@n8n/n8n-nodes-langchain.lmChatAnthropic', typeVersion: 1.6, position: [-320, 260],
    parameters: {
      model: { __rl: true, mode: 'id', value: modelId(cfg.models[role] || cfg.models.tester) },
      // 4096 by default: too few for a whole .apx page or spec.md in one FS_Write.
      // streaming: the model call itself streams (SSE), also for the sub-agents. Without it the
      // Anthropic SDK refuses max_tokens above ~21,333 ("Streaming is required for operations that
      // may take longer than 10 minutes"). The agent's output is unchanged.
      // 128,000 = the model's output maximum (Claude Sonnet 5.5); the API rejects anything above it.
      options: { maxTokensToSample: 128000, streaming: true, promptCaching: caching, ...(r.reasoning ? { thinkingMode: 'adaptive', effort: r.reasoning } : {}) },
    },
    credentials: credential(),
  }];
  const connections = { [nodes[1].name]: { ai_languageModel: [[{ node: agentName, type: 'ai_languageModel', index: 0 }]] } };
  if (memory) {
    nodes.push({ id: nodeId(w, 12), name: 'Chat Memory', type: '@n8n/n8n-nodes-langchain.memoryBufferWindow', typeVersion: 1.3, position: [-140, 260], parameters: memory });
    connections['Chat Memory'] = { ai_memory: [[{ node: agentName, type: 'ai_memory', index: 0 }]] };
  }
  tools.forEach((t, i) => {
    const node = toolNode(nodeId(w, 100 + i), ...t, [40 + (i % 8) * 180, 260 + Math.floor(i / 8) * 200]);
    nodes.push(node);
    connections[node.name] = { ai_tool: [[{ node: agentName, type: 'ai_tool', index: 0 }]] };
  });
  return { nodes, connections, agentName };
}

// ---------------------------------------------------------------- workflows
// APEX_Skills: Load_Skill.
function skillsWorkflow() {
  return render({
    name: 'APEX_Skills',
    nodes: [
      note(nodeId(1, 1), '## APEX_Skills\nLoad_Skill of the APEX Expert agents (workflow edition): a skill\'s instructions or one of its reference files, from agents/apex-expert/skills.built.json. role is fixed per agent, so each agent loads only its own skills.\n\nGenerated by scripts/build-apex-workflows.mjs from agents/apex-expert/src/load-skill.js -- edit there.', [-420, -300]),
      trigger(nodeId(1, 2), ['skill', 'file_path', 'role'], [-380, 60]),
      { id: nodeId(1, 3), name: 'Load Skill', type: 'n8n-nodes-base.code', typeVersion: 2, position: [-120, 60], parameters: { jsCode: read(DIR, 'src', 'load-skill.js') } },
    ],
    connections: { 'When Executed by Another Workflow': { main: [[{ node: 'Load Skill', type: 'main', index: 0 }]] } },
    settings: { executionOrder: 'v1' },
  });
}

// A sub-agent: Execute Workflow Trigger (goal, context, expectedOutput) -> AI Agent -> Result.
// A failed run (e.g. the iteration limit) still answers the lead, with the error.
const RESULT = (name) => `const j = $input.first().json;
if (j.output) return [{ json: { result: j.output } }];
const error = j.error ? (j.error.message || JSON.stringify(j.error)) : 'no answer';
return [{ json: { result: '${name} stopped without a final answer: ' + String(error).slice(0, 800) + '\\nWhat it wrote to the project so far is kept; check it with FS_List before you delegate again.' } }];`;
function subAgentWorkflow(role, skills) {
  const w = 10 + SUBS.indexOf(role);
  const r = ROLES[role];
  const text = "={{ 'Goal: ' + $json.goal + '\\n\\nContext:\\n' + $json.context + '\\n\\nExpected output: ' + $json.expectedOutput }}";
  const a = agentNodes(w, role, { text, systemMessage: systemMessage(role, skills), caching: '5m' });
  return render({
    name: r.name,
    nodes: [
      note(nodeId(w, 1), '## ' + r.name + '\n' + r.description + '\n\nCalled by the APEX Expert as the tool ' + ASK[role] + ' (goal, context, expectedOutput). Prompt: agents/apex-expert/prompts/' + r.prompt + '; skills through Load_Skill.\n\nGenerated by scripts/build-apex-workflows.mjs -- edit the sources and rebuild.', [-700, -320]),
      trigger(nodeId(w, 2), ['goal', 'context', 'expectedOutput'], [-400, 0]),
      ...a.nodes,
      { id: nodeId(w, 3), name: 'Result', type: 'n8n-nodes-base.code', typeVersion: 2, position: [400, 0], parameters: { jsCode: RESULT(r.name) } },
    ],
    connections: {
      'When Executed by Another Workflow': { main: [[{ node: a.agentName, type: 'main', index: 0 }]] },
      [a.agentName]: { main: [[{ node: 'Result', type: 'main', index: 0 }]] },
      ...a.connections,
    },
    settings: { executionOrder: 'v1' },
  });
}

// "APEX Expert Chat": n8n's hosted chat page (n8n login) -> the lead.
const CHAT_WEBHOOK_ID = 'b7d1f0a2-5c3e-4d8a-9e61-2f4a6c8e0b13';
function chatWorkflow(skills) {
  const w = 20;
  const ask = SUBS.map((role) => [ASK[role], cfg.agentWorkflowIds[role], ROLES[role].name,
    ROLES[role].name + ': ' + ROLES[role].description + ' Use: ' + SUB_AGENT_USE[role] + ' It cannot see this chat: goal = what to do; context = everything it needs (Target lines, project key, application id, the requirement or findings verbatim); expectedOutput = the sections you want back. Returns its final answer; a build step can take many minutes.',
    {}, ['goal', 'context', 'expectedOutput']]);
  const a = agentNodes(w, 'lead', {
    text: '={{ $json.chatInput }}', systemMessage: systemMessage('lead', skills), caching: '1h', streaming: true, extraTools: ask,
    // The chat's sessionId keys the conversation; 30 exchanges are kept (tool calls are not stored).
    memory: { sessionIdType: 'fromInput', contextWindowLength: 30 },
  });
  return render({
    name: 'APEX Expert Chat',
    nodes: [
      note(nodeId(w, 1), '## APEX Expert Chat (workflow edition)\nChat page for the APEX Expert: use the Chat button below, or open the chat URL of the trigger in a browser where you are logged in to n8n.\n\nThe lead is the AI Agent below; its sub-agents are the workflows APEX Analyst, APEX Developer, APEX DB Tester and APEX UI Tester (tools Ask_*). SQL_Execute / Install_App run WITHOUT approval clicks; the agent asks in the chat before destructive changes. Only the database target in .env is reachable.\n\nGenerated by scripts/build-apex-workflows.mjs.', [-700, -360], 640, 300),
      {
        id: nodeId(w, 2), name: 'When chat message received', type: '@n8n/n8n-nodes-langchain.chatTrigger', typeVersion: 1.4, position: [-400, 0], webhookId: CHAT_WEBHOOK_ID,
        parameters: {
          public: true, mode: 'hostedChat',
          // n8n's own login (the browser's n8n session); with basic auth the editor's chat panel failed.
          authentication: 'n8nUserAuth',
          initialMessages: 'Hi! I am the APEX Expert.\nAsk me about your APEX apps, SQL or PL/SQL, or tell me which app to build or change.\nNote: in this chat, database changes run without an approval click; I ask before anything destructive.',
          options: { title: 'APEX Expert', subtitle: 'Oracle APEX apps, SQL and PL/SQL', responseMode: 'streaming' },
        },
      },
      ...a.nodes,
    ],
    connections: { 'When chat message received': { main: [[{ node: a.agentName, type: 'main', index: 0 }]] }, ...a.connections },
    settings: { executionOrder: 'v1' },
  });
}

// ---------------------------------------------------------------- n8n
const session = editorSession('build-apex-workflows');

// The Anthropic credential by name (editor API; the public API cannot list credentials).
async function ensureCredential() {
  if (cfg.credentialId) return;
  await session.login();
  const list = await session.rest('GET', '/credentials');
  const c = (list.data || list).find((x) => x.name === cfg.credentialName);
  if (!c) throw new Error('n8n has no credential named "' + cfg.credentialName + '": create it (Anthropic) or set credentialName in apex-expert.json');
  cfg.credentialId = c.id;
  saveCfg();
}

// The helper workflows by name: the saved id if it still exists, else a workflow of that name, else
// imported from workflows/<name>__.json (a fresh n8n). The template is refreshed from n8n afterwards,
// because the helpers are maintained in n8n.
async function ensureHelpers() {
  cfg.helperWorkflowIds = cfg.helperWorkflowIds || {};
  for (const [key, name] of Object.entries(HELPERS)) {
    let id = cfg.helperWorkflowIds[key];
    if (id && !(await pub('GET', '/workflows/' + id).catch(() => null))) id = null;
    if (!id) {
      const list = (await pub('GET', '/workflows?limit=250&name=' + encodeURIComponent(name))).json.data || [];
      id = (list.find((w) => w.name === name && !w.isArchived) || {}).id;
    }
    if (!id) {
      const wf = JSON.parse(read(ROOT, 'workflows', name + '__.json'));
      id = (await pub('POST', '/workflows', render({ name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings || {} }))).json.id;
      console.log('imported', name, id);
    }
    await pub('POST', '/workflows/' + id + '/activate').catch((e) => console.warn('activate ' + name + ':', e.message));
    cfg.helperWorkflowIds[key] = id;
    const w = (await pub('GET', '/workflows/' + id)).json;
    fs.writeFileSync(path.join(ROOT, 'workflows', name + '__.json'), JSON.stringify(templatize({ name: w.name, nodes: w.nodes, connections: w.connections, settings: w.settings || {} }), null, 2) + '\n');
  }
  saveCfg();
}

// Create or update a workflow, activate it and save the server's copy under workflows/.
async function upsert(wf, set) {
  const id = set();
  let saved = id ? (await pub('PUT', '/workflows/' + id, wf)).json : (await pub('POST', '/workflows', wf)).json;
  if (!id) { set(saved.id); saveCfg(); }
  await pub('POST', '/workflows/' + saved.id + '/activate').catch((e) => console.warn('activate ' + wf.name + ':', e.message));
  saved = (await pub('GET', '/workflows/' + saved.id)).json;
  fs.writeFileSync(path.join(ROOT, 'workflows', saved.name + '__' + saved.id + '.json'), JSON.stringify(templatize(saved), null, 2));
  console.log('workflow', JSON.stringify(saved.name), saved.id, 'active=' + saved.active);
  return saved;
}

const built = buildSkills();
if (args.has('--check-skills')) {
  for (const [slug, s] of Object.entries(built.skills)) console.log(slug + ': instructions ' + s.instructions.length + ', ' + (s.references || []).length + ' refs');
} else {
  fs.writeFileSync(path.join(DIR, 'skills.built.json'), JSON.stringify(built));
  await ensureCredential();
  await ensureHelpers();
  await upsert(toolsWorkflow(cfg), (id) => (id === undefined ? cfg.toolsWorkflowId : (cfg.toolsWorkflowId = id)));
  await upsert(skillsWorkflow(), (id) => (id === undefined ? cfg.skillsWorkflowId : (cfg.skillsWorkflowId = id)));
  cfg.agentWorkflowIds = cfg.agentWorkflowIds || {};
  // The single "APEX Tester" of earlier builds becomes the UI Tester (same workflow id, renamed).
  if (cfg.agentWorkflowIds.tester && !cfg.agentWorkflowIds.uitester) { cfg.agentWorkflowIds.uitester = cfg.agentWorkflowIds.tester; delete cfg.agentWorkflowIds.tester; saveCfg(); }
  for (const role of SUBS) await upsert(subAgentWorkflow(role, built.skills), (id) => (id === undefined ? cfg.agentWorkflowIds[role] : (cfg.agentWorkflowIds[role] = id)));
  await upsert(chatWorkflow(built.skills), (id) => (id === undefined ? cfg.chatWorkflowId : (cfg.chatWorkflowId = id)));
  console.log('chat URL:', HOST + '/webhook/' + CHAT_WEBHOOK_ID + '/chat');
}
