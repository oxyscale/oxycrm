import { startHarness } from './harness';
(async () => {
  const { api, db, close } = await startHarness();
  const lead = await api('POST', '/leads', {
    name: 'Sam Tester', company: 'Testco', phone: '0400000001', pipelineStage: 'won' });
  console.log('POST /leads ->', lead.status, JSON.stringify(lead.body).slice(0, 220));
  const list = await api('GET', '/leads');
  console.log('GET /leads ->', list.status, Array.isArray(list.body) ? `${list.body.length} rows` : JSON.stringify(list.body).slice(0,160));
  if (Array.isArray(list.body) && list.body[0]) {
    console.log('  first row keys:', Object.keys(list.body[0]).join(','));
    console.log('  lifecycle:', list.body[0].lifecycle, ' retainer:', list.body[0].currentRetainer);
  }
  const month = new Date().toISOString().slice(0, 7);
  const rep = await api('GET', `/investor/report/${month}`);
  console.log('GET report ->', rep.status, JSON.stringify(rep.body).slice(0, 200));
  close();
})();
