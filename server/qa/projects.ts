/**
 * The fields typed on a project page and what the report does with
 * them: build fee, how much of it is invoiced, and when revenue starts.
 */
import { startHarness, check, eq, setSection, report } from './harness';

const month = new Date().toISOString().slice(0, 7);
const shift = (d: number) => {
  const x = new Date(); x.setDate(x.getDate() + d); return x.toISOString().slice(0, 10);
};

(async () => {
  const { api, db, close } = await startHarness();
  const rep = async () => (await api('GET', `/investor/report/${month}`)).body.report;

  const lead = (await api('POST', '/leads', {
    name: 'Bill Fee', company: 'Feeco', phone: '0400300001',
    category: 'QA', pipelineStage: 'won' })).body;
  const proj = (await api('POST', '/projects',
    { name: 'Big Build', clientName: 'Feeco', leadId: lead.id })).body;

  setSection('Build fees');
  await api('PATCH', `/projects/${proj.id}`, { buildFee: 45000, buildFeePaid: 22500 });
  let r = await rep();
  const outstanding = r.buildFees?.outstanding
    ?? r.buildFees?.total - (r.buildFees?.paid ?? 0);
  eq('the outstanding half is tracked', outstanding, 22500);
  eq('an unpaid fee with no due date is not yet overdue', r.buildFees.overdue, 0);
  eq('it sits in what is still to come', r.buildFees.dueLater, 22500);

  await api('PATCH', `/projects/${proj.id}`, { buildFeePaid: 45000 });
  r = await rep();
  const stillOwed = r.buildFees?.outstanding
    ?? r.buildFees?.total - (r.buildFees?.paid ?? 0);
  eq('paying it in full clears the balance', stillOwed, 0);

  setSection('Revenue start date');
  await api('POST', `/leads/${lead.id}/retainers`, { monthlyAmount: 2000, effectiveFrom: shift(-1) });
  await api('PATCH', `/projects/${proj.id}`, { status: 'building', liveFrom: shift(30) });
  r = await rep();
  eq('a build not yet live is not in live revenue', r.tiles.liveMrr, 0);
  check('but it is counted as committed', r.tiles.notYetLiveMrr > 0,
    `notYetLive=${r.tiles.notYetLiveMrr}`);

  await api('PATCH', `/projects/${proj.id}`, { status: 'live', liveFrom: shift(-1) });
  r = await rep();
  eq('going live moves it into live revenue', r.tiles.liveMrr, 2000);
  eq('and out of committed', r.tiles.notYetLiveMrr, 0);

  setSection('Deleting a project');
  const gone = await api('DELETE', `/projects/${proj.id}`);
  check('a project can be deleted', gone.status === 200 || gone.status === 204, `${gone.status}`);
  eq('its rows are gone', (db.prepare(
    'SELECT COUNT(*) n FROM projects WHERE id = ?').get(proj.id) as any).n, 0);
  check('but the client and their billing history remain',
    !!db.prepare('SELECT id FROM leads WHERE id = ?').get(lead.id)
    && (db.prepare('SELECT COUNT(*) n FROM client_retainers WHERE lead_id = ?')
        .get(lead.id) as any).n > 0);

  setSection('Bad input is refused');
  eq('a negative build fee is rejected',
    (await api('PATCH', `/projects/${proj.id}`, { buildFee: -1 })).status, 400);
  eq('an unknown status is rejected',
    (await api('PATCH', `/projects/${proj.id}`, { status: 'paused' })).status, 400);
  eq('a malformed go-live date is rejected',
    (await api('PATCH', `/projects/${proj.id}`, { liveFrom: '30-09-2026' })).status, 400);

  close();
  process.exit(report() === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
