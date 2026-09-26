// agent 한 명의 도구를 그 작업칸에 건다.
//
//   node tools/agent-setup.mjs ui          작업칸이 없으면 git worktree 로 판다
//   node tools/agent-setup.mjs --list      역할과 도구 목록
//   node tools/agent-setup.mjs --selftest
//
// 작업칸은 폴더가 다르니 .claude/ 도 따로 먹는다. 여기에 두 가지를 적는다:
//   .claude/skills/<이름>        그 역할 스킬만 (~/.claude/skill-store 에서 복사)
//   .claude/settings.local.json  enabledPlugins — 역할에 안 맞는 플러그인은 false
// 둘 다 git 에 안 올라간다(.gitignore). settings.local.json 의 다른 칸은 건드리지 않는다.
import { readFileSync, writeFileSync, existsSync, mkdirSync, cpSync, rmSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const AGENTS = JSON.parse(readFileSync(join(REPO, 'agents', 'agents.json'), 'utf8'));
const STORE = process.env.SKILL_STORE ?? join(homedir(), '.claude', 'skill-store');
// 이 저장소가 들고 다니는 스킬. 역할과 상관없이 모든 작업칸에 있다.
const SHARED = ['ops'];

/** 작업칸 폴더 하나에 역할을 건다. 무엇을 했는지 줄로 돌려준다. */
export function apply(dir, role, store = STORE) {
  const a = AGENTS[role];
  if (!a) throw new Error(`모르는 역할: ${role}`);
  const out = [];
  const sk = join(dir, '.claude', 'skills');
  mkdirSync(sk, { recursive: true });
  // 다른 역할에서 넣었던 스킬은 걷어 낸다. 저장소 것(SHARED)은 둔다.
  for (const f of readdirSync(sk)) {
    if (!SHARED.includes(f) && !a.skills.includes(f)) { rmSync(join(sk, f), { recursive: true, force: true }); out.push(`- ${f}`); }
  }
  for (const s of a.skills) {
    const src = join(store, s);
    if (!existsSync(src)) { out.push(`! ${s} 이 창고에 없다 (${src})`); continue; }
    cpSync(src, join(sk, s), { recursive: true, force: true });
    out.push(`+ ${s}`);
  }
  const sf = join(dir, '.claude', 'settings.local.json');
  let cur = {};
  try { cur = JSON.parse(readFileSync(sf, 'utf8')); } catch { /* 없으면 새로 */ }
  cur.enabledPlugins = { ...(cur.enabledPlugins ?? {}), ...a.plugins };
  writeFileSync(sf, JSON.stringify(cur, null, 2) + '\n');
  out.push(`플러그인 ${Object.entries(a.plugins).map(([k, v]) => (v ? '' : '-') + k.split('@')[0]).join(' ')}`);
  return out;
}

function main(argv) {
  if (argv[0] === '--list') {
    for (const [k, a] of Object.entries(AGENTS)) {
      if (k.startsWith('$')) continue;
      console.log(`${k.padEnd(6)} ${a.dir}  — ${a.what}\n       스킬 ${a.skills.join(', ')}\n`);
    }
    return;
  }
  const role = argv[0];
  const a = AGENTS[role];
  if (!a || role.startsWith('$')) { console.error(`역할을 주세요: ${Object.keys(AGENTS).filter(k => !k.startsWith('$')).join(' | ')}`); process.exit(1); }
  // 작업칸은 본체 옆(같은 과제 폴더 안)에 둔다.
  const dir = role === 'main' ? REPO : join(dirname(REPO), a.dir);
  if (!existsSync(dir)) {
    const hasBranch = execFileSync('git', ['-C', REPO, 'branch', '--list', a.branch], { encoding: 'utf8' }).trim();
    execFileSync('git', ['-C', REPO, 'worktree', 'add', dir, ...(hasBranch ? [a.branch] : ['-b', a.branch])], { stdio: 'inherit' });
  }
  console.log(`${role} → ${dir}`);
  for (const l of apply(dir, role)) console.log('  ' + l);
  console.log(`\n  창을 켜려면:  cd "${dir}"  그리고  claude  —  켠 뒤 /rename ${role}`);
}

function selftest() {
  let n = 0;
  const ok = (label, cond, extra = '') => { if (!cond) throw new Error(`${label}  ${extra}`); n++; console.log(`  PASS  ${label}`); };
  const t = join(tmpdir(), 'agent-setup-' + process.pid);
  const store = join(t, 'store'), dir = join(t, 'wt');
  try {
    for (const s of ['taste', 'lexicon-tuning']) { mkdirSync(join(store, s), { recursive: true }); writeFileSync(join(store, s, 'SKILL.md'), s); }
    mkdirSync(join(dir, '.claude', 'skills', 'ops'), { recursive: true });
    writeFileSync(join(dir, '.claude', 'settings.local.json'), JSON.stringify({ permissions: { allow: ['x'] }, enabledPlugins: { 'other@x': true } }));
    apply(dir, 'ui', store);
    const s1 = JSON.parse(readFileSync(join(dir, '.claude', 'settings.local.json'), 'utf8'));
    ok('역할 스킬을 넣는다', existsSync(join(dir, '.claude', 'skills', 'taste', 'SKILL.md')));
    ok('저장소 스킬은 둔다', existsSync(join(dir, '.claude', 'skills', 'ops')));
    ok('다른 칸은 안 건드린다', s1.permissions.allow[0] === 'x' && s1.enabledPlugins['other@x'] === true);
    ok('안 맞는 플러그인은 끈다', s1.enabledPlugins['notion-log@notion-log'] === false);
    const out = apply(dir, 'train', store);
    ok('역할을 바꾸면 앞 스킬을 걷는다', !existsSync(join(dir, '.claude', 'skills', 'taste')) && out.includes('- taste'));
    ok('창고에 없는 스킬은 알린다', out.some(l => l.startsWith('! backtest-expert')));
    ok('모르는 역할은 거절', (() => { try { apply(dir, 'nope', store); return false; } catch { return true; } })());
  } finally { rmSync(t, { recursive: true, force: true }); }
  console.log(`\n${n}개 점검 통과\n`);
}

const argv = process.argv.slice(2);
if (argv.includes('--selftest')) selftest(); else main(argv);
