import { startHarness } from './harness';
(async () => {
  const { api, db, close } = await startHarness();
  const lead = (await api('POST', '/leads',
    { name: 'Obra Test', company: 'Obra', phone: '0400700001', category: 'QA' })).body;

  // A note and a call, each of which also writes a timeline entry.
  await api('POST', '/notes', { leadId: lead.id, content: 'A note worth keeping' });
  await api('POST', `/leads/${lead.id}/disposition`,
    { leadId: lead.id, disposition: 'no_answer', callDuration: 30, transcript: 'a call' });
  db.prepare(`INSERT INTO activities (lead_id, type, title, description)
              VALUES (?, 'stage_change', 'Converted to project', 'Analytics Platform')`).run(lead.id);

  const before = (await api('GET', `/activities/lead/${lead.id}`)).body;
  const list = Array.isArray(before) ? before : before.activities;
  const target = list.find((a: any) => a.title === 'Converted to project');

  const del = await api('DELETE', `/activities/${target.id}`);
  const afterRes = (await api('GET', `/activities/lead/${lead.id}`)).body;
  const after = Array.isArray(afterRes) ? afterRes : afterRes.activities;

  const notes = (await api('GET', `/notes/lead/${lead.id}`)).body;
  const calls = (db.prepare('SELECT COUNT(*) n FROM call_logs WHERE lead_id = ?').get(lead.id) as any).n;

  const checks: [string, boolean][] = [
    ['the entry is removed', del.status === 200],
    ['it is gone from the timeline', !after.some((a: any) => a.title === 'Converted to project')],
    ['other entries survive', after.length === list.length - 1],
    ['the note itself is untouched', Array.isArray(notes) && notes.length === 1],
    ['the call log is untouched', calls === 1],
    ['the lead is untouched', !!db.prepare('SELECT id FROM leads WHERE id = ?').get(lead.id)],
    ['deleting it again is refused', (await api('DELETE', `/activities/${target.id}`)).status === 404],
    ['a nonsense id is refused', (await api('DELETE', '/activities/abc')).status === 400],
  ];
  console.log();
  for (const [l, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${l}`);
  close();
  process.exit(checks.every(([, ok]) => ok) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
