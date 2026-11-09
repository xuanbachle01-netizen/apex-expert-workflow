// ---- Load_Skill (workflow APEX_Skills, workflow edition) ----
// The workflow edition's stand-in for n8n agent skills: the instructions of a skill, or one of its
// reference files, from agents/apex-expert/skills.built.json (written by scripts/build-apex-workflows.mjs
// from agents/apex-expert/skills/). role is fixed per agent: an agent loads only its own skills.
//   skill      the skill's slug (test-app) or name (Test an APEX app)
//   file_path  "-" or empty for the instructions, else a reference file the instructions name
const fsMod = require('fs');
const trig = $('When Executed by Another Workflow').first().json;
const reply = (result) => [{ json: { result } }];
const FILE = '@@PROJECT_ROOT@@\\agents\\apex-expert\\skills.built.json';

let built;
try { built = JSON.parse(fsMod.readFileSync(FILE, 'utf8')); } catch (e) {
  return reply('UNAVAILABLE -- the skills are not built (' + e.message + '): run node scripts/build-apex-workflows.mjs');
}
const mine = built.roles[String(trig.role || '')] || [];
const want = String(trig.skill || '').trim().toLowerCase();
const slug = mine.find((s) => s === want || built.skills[s].name.toLowerCase() === want);
if (!slug) return reply('ERROR: you have no skill "' + trig.skill + '". Your skills: ' + mine.join(', '));
const skill = built.skills[slug];
const file = String(trig.file_path || '').trim().replace(/^\.?\//, '');
if (!file || file === '-') return reply('# Skill ' + slug + ' -- ' + skill.name + '\n\n' + skill.instructions);
const ref = (skill.references || []).find((r) => r.path === file || r.path === 'references/' + file);
if (!ref) return reply('ERROR: skill ' + slug + ' has no file "' + file + '". Its files: ' + ((skill.references || []).map((r) => r.path).join(', ') || 'none'));
return reply(ref.content);
