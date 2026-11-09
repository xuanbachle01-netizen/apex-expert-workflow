// Local patches for the installed n8n: AI agents lose their own tool-call
// arguments from the conversation history they send back to Claude.
//
// 1. common.js (every AI Agent node version): @langchain/anthropic stores each
//    tool call in the AI message as a `tool_use` block with input "" plus a
//    separate `input_json_delta` block holding the JSON. LangChain would rebuild
//    the real input from message.tool_calls, but n8n's fixEmptyContentMessage()
//    runs first and turns "" into {}.
// 2. utils/agent-execution/buildSteps.js (AI Agent v3, with Claude thinking on):
//    the history of an earlier tool call is rebuilt as [thinking, tool_use]
//    blocks with `input: toolInput.input` -- but toolInput IS the arguments
//    object ({session, file_path, content}), so .input is undefined and every
//    earlier call becomes `"input": {}`.
//
// Either way Claude is shown `"input": {}` for every tool call it made earlier
// in the same agent run. The tools themselves receive the right arguments. The
// model then "sees" empty calls that succeeded, reports its own work as "empty
// tool calls", rewrites the same files again and again, and starts sending
// genuinely empty calls itself (more and more as the run gets longer).
//
// The patches restore the real arguments. n8n updates overwrite them: re-run
// this script after every n8n upgrade and restart n8n.
//
// Usage:
//   node scripts/patch-n8n-tool-history.mjs            # apply (idempotent)
//   node scripts/patch-n8n-tool-history.mjs --check    # report status only
//   node scripts/patch-n8n-tool-history.mjs --revert   # restore the originals
//   N8N_LANGCHAIN_DIR=<...>/@n8n/n8n-nodes-langchain node scripts/...  # custom install path

import fs from 'node:fs';
import path from 'node:path';

const LANGCHAIN_DIR = process.env.N8N_LANGCHAIN_DIR ||
  path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'n8n', 'node_modules', '@n8n', 'n8n-nodes-langchain');

const MARKER1 = '[local patch: restore tool_use input from tool_calls]';
const MARKER2 = '[local patch: tool_use input is the arguments object]';
const PATCHES = [
  {
    file: path.join(LANGCHAIN_DIR, 'dist', 'nodes', 'agents', 'Agent', 'agents', 'ToolsAgent', 'common.js'),
    marker: MARKER1,
    original: `                            if (content.input === '') {
                                content.input = {};
                            }`,
    patched: `                            if (content.input === '') {
                                // ${MARKER1}
                                const call = content.type === 'tool_use' && Array.isArray(message.tool_calls)
                                    ? message.tool_calls.find((tc) => tc.id === content.id)
                                    : undefined;
                                content.input = call && call.args ? call.args : {};
                            }`,
  },
  {
    file: path.join(LANGCHAIN_DIR, 'dist', 'utils', 'agent-execution', 'buildSteps.js'),
    marker: MARKER2,
    original: `    const toolInputData = toolInput.input;`,
    patched: `    // ${MARKER2}
    const toolInputData = toolInput && typeof toolInput.input === 'object' && toolInput.input !== null
        ? toolInput.input
        : (() => { const { id, log, type, ...args } = toolInput || {}; return args; })();`,
  },
];

const mode = process.argv.includes('--revert') ? 'revert' : process.argv.includes('--check') ? 'check' : 'apply';
let failed = false;
let changed = false;

for (const p of PATCHES) {
  if (!fs.existsSync(p.file)) {
    console.error(`Not found: ${p.file}\nSet N8N_LANGCHAIN_DIR to your @n8n/n8n-nodes-langchain folder.`);
    failed = true;
    continue;
  }
  const src = fs.readFileSync(p.file, 'utf8');
  const isPatched = src.includes(p.marker);
  if (mode === 'check') {
    console.log(`${isPatched ? 'PATCHED' : 'NOT patched'}: ${p.file}`);
    if (!isPatched) failed = true;
    continue;
  }
  if (mode === 'revert') {
    if (!isPatched) { console.log(`Not patched; nothing to revert: ${p.file}`); continue; }
    fs.writeFileSync(p.file, src.replace(p.patched, p.original), 'utf8');
    console.log(`Reverted ${p.file}`);
    changed = true;
    continue;
  }
  if (isPatched) { console.log(`Already patched: ${p.file}`); continue; }
  const count = src.split(p.original).length - 1;
  if (count !== 1) {
    console.error(`Expected exactly 1 match of the original code in ${p.file}, found ${count}. n8n's code has changed -- check whether the bug is fixed upstream before patching by hand.`);
    failed = true;
    continue;
  }
  const backup = p.file + '.orig';
  if (!fs.existsSync(backup)) fs.writeFileSync(backup, src, 'utf8');
  fs.writeFileSync(p.file, src.replace(p.original, p.patched), 'utf8');
  console.log(`Patched ${p.file}\nBackup: ${backup}`);
  changed = true;
}
if (changed) console.log('Restart n8n for the change to take effect.');
process.exit(failed ? (mode === 'check' ? 2 : 1) : 0);
