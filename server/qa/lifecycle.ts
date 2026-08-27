/**
 * The client lifecycle, end to end: a lead becomes a build, becomes an
 * active client, changes rate, and churns. Money must follow at every
 * step, because monthly revenue is the number that goes to shareholders.
 */
import { startHarness, check, eq, setSection, report, results } from './harness';

const today = () => new Date().toISOString().slice(0, 10);
const shift = (days: number) => {
  const d = new Date(); d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

(async () => {
  const ctx = await startHarness();
  const { api, db } = ctx;

  // Monthly revenue exactly as the report computes it.
  const reportMrr = async () => {
    const r = await api('GET', `/investor/report/${today().slice(0, 7)}`);
    return r.body?.report?.tiles?.liveMrr ?? null;
  };
  const leadRow = async (id: number) => {
    const r = await api('GET', '/leads');
    return (r.body as any[]).find((l) => l.id === id);
  };

  // ── a lead arrives ─────────────────────────────────────────────
  setSection('Lead becomes a client');
  const lead = (await api('POST', '/leads', {
    name: 'Sam Tester', company: 'Testco', phone: '0400000001', category: 'QA',
    email: 'sam@testco.example', pipelineStage: 'won',
  })).body;
  check('lead is created', !!lead.id, JSON.stringify(lead).slice(0, 120));
  eq('starts life as a lead', (await leadRow(lead.id))?.lifecycle, 'lead');

  const proj = (await api('POST', '/projects', {
    name: 'Build One', clientName: 'Testco', leadId: lead.id, monthlyRetainer: 1000,
  })).body;
  check('project is created', !!proj.id);
  eq('a build makes them in_build', (await leadRow(lead.id))?.lifecycle, 'in_build');
  eq('opening retainer is recorded', (await leadRow(lead.id))?.currentRetainer, 1000);

  await api('PATCH', `/projects/${proj.id}`, { status: 'live' });
  eq('going live makes them a client', (await leadRow(lead.id))?.lifecycle, 'client');
  eq('live client counts in monthly revenue', await reportMrr(), 1000);

  // ── the rate changes ───────────────────────────────────────────
  setSection('Rate changes');
  // The opening retainer is dated today, so a rise dated today has to
  // win on insertion order. That tie-break is worth asserting.
  await api('POST', `/leads/${lead.id}/retainers`, { monthlyAmount: 1500, effectiveFrom: today() });
  eq('a rise on the same day wins over the opening rate', await reportMrr(), 1500);

  const future = (await api('POST', `/leads/${lead.id}/retainers`,
    { monthlyAmount: 2500, effectiveFrom: shift(30) })).body;
  eq('a rise dated ahead does not', await reportMrr(), 1500);

  await api('PATCH', `/leads/${lead.id}/retainers/${future.id}`, { effectiveFrom: today() });
  eq('pulling that date forward applies it', await reportMrr(), 2500);
  await api('PATCH', `/leads/${lead.id}/retainers/${future.id}`, { effectiveFrom: shift(30) });
  eq('pushing it back out again removes it', await reportMrr(), 1500);

  // ── churn ──────────────────────────────────────────────────────
  setSection('Client churns');
  await api('PATCH', `/projects/${proj.id}`, { status: 'ended' });
  eq('ending the project moves them out of clients', (await leadRow(lead.id))?.lifecycle, 'lead');
  eq('a churned client stops counting in revenue', await reportMrr(), 0);
  eq('their retainer no longer shows on the lead', (await leadRow(lead.id))?.currentRetainer, 0);

  const histRes = await api('GET', `/leads/${lead.id}/retainers`);
  const hist = Array.isArray(histRes.body) ? histRes.body : (histRes.body as any)?.retainers ?? [];
  check('billing history is kept, not deleted',
    Array.isArray(hist) && hist.some((h: any) => h.monthlyAmount === 1500),
    `status ${histRes.status}, ${JSON.stringify(histRes.body).slice(0, 140)}`);

  // ── active to in-build ─────────────────────────────────────────
  setSection('Active client goes back into build');
  const l2 = (await api('POST', '/leads', {
    name: 'Pat Two', company: 'Twoco', phone: '0400000002', category: 'QA', pipelineStage: 'won',
  })).body;
  const p2 = (await api('POST', '/projects',
    { name: 'B2', clientName: 'Twoco', leadId: l2.id, monthlyRetainer: 800 })).body;
  await api('PATCH', `/projects/${p2.id}`, { status: 'live' });
  eq('billing while live', await reportMrr(), 800);  // Testco churned to 0
  await api('PATCH', `/projects/${p2.id}`, { status: 'building' });
  eq('back to in_build', (await leadRow(l2.id))?.lifecycle, 'in_build');
  eq('a client back in build is not billing yet', await reportMrr(), 0);

  // ── a second project must not churn a live client ──────────────
  setSection('Multiple projects');
  const l3 = (await api('POST', '/leads', {
    name: 'Alex Three', company: 'Threeco', phone: '0400000003', category: 'QA', pipelineStage: 'won',
  })).body;
  const p3a = (await api('POST', '/projects',
    { name: 'Main', clientName: 'Threeco', leadId: l3.id, monthlyRetainer: 1200 })).body;
  const p3b = (await api('POST', '/projects',
    { name: 'Extra', clientName: 'Threeco', leadId: l3.id })).body;
  await api('PATCH', `/projects/${p3a.id}`, { status: 'live' });
  eq('client is live', (await leadRow(l3.id))?.lifecycle, 'client');
  await api('PATCH', `/projects/${p3b.id}`, { status: 'ended' });
  eq('ending a side project keeps them a client', (await leadRow(l3.id))?.lifecycle, 'client');
  eq('and keeps them billing', await reportMrr(), 1200);  // Twoco is in build, Testco churned

  ctx.close();
  process.exit(report() === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
