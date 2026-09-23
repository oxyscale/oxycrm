/**
 * The retainer a client is on must be the one in force in Melbourne, not
 * in UTC. For the first ten hours of every Melbourne working day the two
 * disagree about what day it is, and the app was answering with UTC —
 * so a rate entered in the morning did not appear until the evening.
 */
import { startHarness, check, eq, setSection, report } from './harness';

const melbourneToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Melbourne' }).format(new Date());

(async () => {
  const { api, db, close } = await startHarness();

  setSection('The server agrees with Melbourne about today');
  const row = db.prepare(
    "SELECT DATE('now') AS utc, DATE('now','localtime') AS local").get() as any;
  eq('SQLite local date is the Melbourne date', row.local, melbourneToday());
  check('and it can differ from UTC, which is the whole problem',
    true, `utc=${row.utc} melbourne=${row.local}`);

  setSection('A rate entered today applies today');
  const lead = (await api('POST', '/leads', {
    name: 'Tz Test', company: 'Tzco', phone: '0400800001', category: 'QA' })).body;
  const proj = (await api('POST', '/projects',
    { name: 'Build', clientName: 'Tzco', leadId: lead.id })).body;

  const res = await api('POST', `/leads/${lead.id}/retainers`,
    { monthlyAmount: 3000, effectiveFrom: melbourneToday() });
  eq('the rate is accepted', res.status, 201);
  eq('stamped with the Melbourne date', res.body.effectiveFrom, melbourneToday());

  // Every surface that reports a retainer must show it straight away.
  const viaView = db.prepare(
    'SELECT monthly_amount AS m FROM current_retainers WHERE lead_id = ?').get(lead.id) as any;
  eq('the shared view sees it', viaView?.m, 3000);

  const project = (await api('GET', `/projects/${proj.id}`)).body;
  eq('the project page sees it', project.currentRetainer, 3000);

  const leadRow = ((await api('GET', '/leads')).body as any[]).find((l) => l.id === lead.id);
  eq('the leads list sees it', leadRow?.currentRetainer, 3000);

  const month = melbourneToday().slice(0, 7);
  await api('PATCH', `/projects/${proj.id}`, { status: 'live' });
  await api('PATCH', `/leads/${lead.id}`, { pipelineStage: 'won' });
  const rep = (await api('GET', `/investor/report/${month}`)).body.report;
  eq('and Business Health counts it', rep.tiles.liveMrr, 3000);

  setSection('A rate dated tomorrow still waits');
  const t = new Date(); t.setDate(t.getDate() + 1);
  const tomorrow = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Melbourne' }).format(t);
  await api('POST', `/leads/${lead.id}/retainers`, { monthlyAmount: 9999, effectiveFrom: tomorrow });
  const stillToday = db.prepare(
    'SELECT monthly_amount AS m FROM current_retainers WHERE lead_id = ?').get(lead.id) as any;
  eq('a future rate does not take effect early', stillToday?.m, 3000);

  close();
  process.exit(report() === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
