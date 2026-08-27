/** Runs every QA suite in turn. `npm run qa`. */
import { spawnSync } from 'child_process';
const suites = ['lifecycle', 'calls', 'merge', 'report', 'projects'];
let failed = 0;
for (const s of suites) {
  console.log(`\n${'='.repeat(58)}\n  ${s}\n${'='.repeat(58)}`);
  const r = spawnSync('npx', ['tsx', `qa/${s}.ts`], { stdio: 'inherit', shell: false });
  if (r.status !== 0) failed++;
}
console.log(`\n${failed === 0 ? 'All suites passed.' : `${failed} suite(s) failed.`}`);
process.exit(failed === 0 ? 0 : 1);
