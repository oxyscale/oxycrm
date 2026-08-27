/**
 * Merging duplicates. The risk here is silent loss: a merge that drops
 * call history, queued drafts or billing history takes information that
 * cannot be reconstructed.
 */
import { startHarness, check, eq, setSection, report } from './harness';

(async () => {
  const { api, db, close } = await startHarness();
  const mk = async (name: string, phone: string, email?: string) =>
    (await api('POST', '/leads', { name, phone, company: 'Dupeco', category: 'QA', email })).body;
  const count = (t: string, id: number) =>
    (db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE lead_id = ?`).get(id) as any).n;

  setSection('Fold one lead into another');
  const keep = await mk('Real Person', '0400200001', 'real@dupeco.example');
  const dupe = await mk('Reel Persen', '0400200002');

  // Give the duplicate a full history worth losing.
  await api('POST', `/leads/${dupe.id}/disposition`,
    { leadId: dupe.id, disposition: 'no_answer', callDuration: 30, transcript: 'a call on the dupe' });
  await api('POST', '/notes', { leadId: dupe.id, content: 'note on the dupe' });
  await api('POST', `/leads/${dupe.id}/retainers`, { monthlyAmount: 900 });
  await api('POST', '/projects', { name: 'Dupe build', clientName: 'Dupeco', leadId: dupe.id });

  const before = {
    calls: count('call_logs', dupe.id), notes: count('notes', dupe.id),
    retainers: count('client_retainers', dupe.id), projects: count('projects', dupe.id),
    activities: count('activities', dupe.id),
  };
  check('the duplicate has history to lose',
    before.calls > 0 && before.notes > 0 && before.retainers > 0 && before.projects > 0,
    JSON.stringify(before));

  const res = await api('POST', `/leads/${dupe.id}/fold-into/${keep.id}`);
  eq('fold succeeds', res.status, 200);

  const after = {
    calls: count('call_logs', keep.id), notes: count('notes', keep.id),
    retainers: count('client_retainers', keep.id), projects: count('projects', keep.id),
    activities: count('activities', keep.id),
  };
  check('calls moved across', after.calls >= before.calls, JSON.stringify(after));
  check('notes moved across', after.notes >= before.notes, JSON.stringify(after));
  check('billing history moved across', after.retainers >= before.retainers, JSON.stringify(after));
  check('projects moved across', after.projects >= before.projects, JSON.stringify(after));
  check('timeline moved across', after.activities >= before.activities, JSON.stringify(after));
  check('the duplicate row is gone',
    !db.prepare('SELECT id FROM leads WHERE id = ?').get(dupe.id));

  setSection('Nothing is orphaned');
  const orphans: Record<string, number> = {};
  for (const t of ['call_logs', 'notes', 'activities', 'emails_sent', 'callbacks',
                   'projects', 'tasks', 'email_drafts', 'client_retainers']) {
    orphans[t] = (db.prepare(
      `SELECT COUNT(*) n FROM ${t} WHERE lead_id IS NOT NULL
        AND lead_id NOT IN (SELECT id FROM leads)`).get() as any).n;
  }
  const total = Object.values(orphans).reduce((a, b) => a + b, 0);
  check('no rows point at a lead that no longer exists', total === 0, JSON.stringify(orphans));

  const flagOrphans = (db.prepare(
    `SELECT COUNT(*) n FROM duplicate_flags
      WHERE suspect_lead_id NOT IN (SELECT id FROM leads)
         OR target_lead_id NOT IN (SELECT id FROM leads)`).get() as any).n;
  eq('no duplicate flags left pointing at deleted leads', flagOrphans, 0);

  setSection('Merge cannot be misused');
  eq('folding a lead into itself is refused',
    (await api('POST', `/leads/${keep.id}/fold-into/${keep.id}`)).status, 400);
  eq('folding into a lead that does not exist is refused',
    (await api('POST', `/leads/${keep.id}/fold-into/999999`)).status, 404);

  setSection('Foreign keys are actually enforced');
  const fk = db.pragma('foreign_keys', { simple: true });
  eq('foreign_keys pragma is on', fk, 1);

  close();
  process.exit(report() === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
