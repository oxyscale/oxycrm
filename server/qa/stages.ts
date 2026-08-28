/**
 * The pipeline stages. Adding one touches ~20 files, so the thing worth
 * asserting is that a lead can actually be moved into the new stages,
 * that they show on the board, and that parked deals do not leak into
 * the numbers that go to shareholders.
 */
import { startHarness, check, eq, setSection, report } from './harness';

const ORDER = ['new_lead', 'no_answer', 'meeting_booked', 'proposal', 'pulse', 'on_ice', 'won', 'lost'];

(async () => {
  const { api, db, close } = await startHarness();
  const mk = async (name: string, phone: string, stage?: string) =>
    (await api('POST', '/leads',
      { name, phone, company: `${name} Co`, category: 'QA', pipelineStage: stage })).body;

  setSection('The stages exist');
  const board = (await api('GET', '/pipeline')).body;
  const keys = Object.keys(board.stages ?? board.counts ?? {});
  check('the board knows every stage',
    ORDER.every((s) => keys.includes(s)), `board has: ${keys.join(', ')}`);

  setSection('A lead can be put in them');
  const a = await mk('Ice Man', '0400400001');
  const toIce = await api('PATCH', `/pipeline/${a.id}/stage`, { stage: 'on_ice' });
  eq('moving to On ice is accepted', toIce.status, 200);
  eq('and it sticks', (db.prepare(
    'SELECT pipeline_stage s FROM leads WHERE id = ?').get(a.id) as any).s, 'on_ice');

  const b = await mk('Neva Answers', '0400400002');
  const toNa = await api('PATCH', `/pipeline/${b.id}/stage`, { stage: 'no_answer' });
  eq('moving to No answer is accepted', toNa.status, 200);
  eq('and it sticks', (db.prepare(
    'SELECT pipeline_stage s FROM leads WHERE id = ?').get(b.id) as any).s, 'no_answer');

  eq('creating a lead straight into a new stage works',
    (await mk('Fresh Ice', '0400400003', 'on_ice')).pipelineStage, 'on_ice');
  eq('a stage that does not exist is still refused',
    (await api('PATCH', `/pipeline/${a.id}/stage`, { stage: 'frozen' })).status, 400);

  setSection('The move is on the timeline');
  const acts = db.prepare(
    "SELECT title FROM activities WHERE lead_id = ? AND type = 'stage_change'").all(a.id) as any[];
  check('a stage change is recorded', acts.length > 0, JSON.stringify(acts));

  setSection('Parked deals stay out of the numbers');
  // Give each parked lead a value, so leaking would be visible.
  for (const id of [a.id, b.id]) {
    db.prepare('UPDATE leads SET deal_value = 5000 WHERE id = ?').run(id);
  }
  const live = await mk('Real Deal', '0400400004', 'proposal');
  db.prepare('UPDATE leads SET deal_value = 1000 WHERE id = ?').run(live.id);

  const month = new Date().toISOString().slice(0, 7);
  const rep = (await api('GET', `/investor/report/${month}`)).body.report;
  eq('open pipeline counts only the live deal', rep.pipeline.openCount, 1);
  check('and On ice / No answer add nothing to its value',
    rep.pipeline.openPipelineOneOff + rep.pipeline.openPipelineMrr <= 1000,
    JSON.stringify(rep.pipeline));

  setSection('But they are still visible in reports');
  const reports = (await api('GET', '/reports')).body;
  const tiers = (reports.byTier ?? []).map((t: any) => t.tier);
  check('both new stages appear in the tier breakdown',
    tiers.includes('on_ice') && tiers.includes('no_answer'), tiers.join(', '));
  const iceBucket = (reports.byTier ?? []).find((t: any) => t.tier === 'on_ice');
  eq('with the leads that are actually in them', iceBucket?.count, 2);

  close();
  process.exit(report() === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
