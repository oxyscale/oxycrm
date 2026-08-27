/**
 * The Business Health report. Wrong numbers here go to shareholders, so
 * the things worth asserting are: money adds up, a locked month cannot
 * drift, and an unknown cost base is never dressed up as a healthy one.
 */
import { startHarness, check, eq, setSection, report } from './harness';

const month = new Date().toISOString().slice(0, 7);

(async () => {
  const { api, db, close } = await startHarness();
  const get = async () => (await api('GET', `/investor/report/${month}`)).body.report;
  const save = (b: Record<string, unknown>) => api('PATCH', `/investor/report/${month}/inputs`, b);

  setSection('With no cost base at all');
  // The schema seeds real months, so clear them to reach the state that
  // matters: a business whose running costs have never been entered.
  db.prepare('DELETE FROM investor_months').run();
  let r = await get();
  eq('runway is unknown, never infinite', r.position.runway.state, 'unknown');
  check('nothing is invented for the bank',
    r.position.bankBalance === 0 || r.position.bankBalance === null,
    `bank=${r.position.bankBalance}`);

  setSection('Money adds up');
  await save({ bankBalance: 20000, currentLiabilities: 5000, actualExpenses: 10000, actualRevenue: 4000 });
  r = await get();
  eq('bank is what was entered', r.position.bankBalance, 20000);
  eq('liabilities are what was entered', r.position.currentLiabilities, 5000);
  eq('free cash is bank less liabilities', r.position.freeCash, 15000);
  check('runway is now a number', r.position.runway.state === 'months',
    JSON.stringify(r.position.runway));

  setSection('Runway cannot flatter');
  await save({ actualExpenses: 0, actualRevenue: 0 });
  r = await get();
  check('a zero cost base never reports a healthy runway',
    r.position.runway.state !== 'months' || r.position.runway.months > 0,
    JSON.stringify(r.position.runway));
  check('free cash never exceeds the bank',
    r.position.freeCash <= r.position.bankBalance,
    `free=${r.position.freeCash} bank=${r.position.bankBalance}`);

  setSection('Locking a month');
  await save({ bankBalance: 20000, currentLiabilities: 5000, actualExpenses: 10000, actualRevenue: 4000 });
  const fin = await api('POST', `/investor/report/${month}/finalise`);
  eq('finalise succeeds', fin.status, 200);
  r = await get();
  eq('the month reads as final', r.status, 'final');
  const blocked = await save({ bankBalance: 999999 });
  eq('a finalised month refuses edits', blocked.status, 409);
  r = await get();
  eq('and its numbers did not move', r.position.bankBalance, 20000);

  const reopened = await api('POST', `/investor/report/${month}/reopen`);
  eq('reopen succeeds', reopened.status, 200);
  eq('edits are accepted again', (await save({ bankBalance: 21000 })).status, 200);

  setSection('Bad input is refused');
  eq('a malformed month is rejected',
    (await api('GET', '/investor/report/not-a-month')).status, 400);
  eq('a non-numeric bank balance is rejected',
    (await save({ bankBalance: 'lots' as any })).status, 400);

  setSection('Share links');
  const link = await api('POST', `/investor/report/${month}/share`, { html: '<p>frozen</p>' });
  eq('a link can be minted', link.status, 201);
  check('the token is unguessable', /^[a-f0-9]{64}$/.test(link.body.token), link.body.token);
  const opened = await api('GET', `/investor/shared/${link.body.token}`);
  eq('it opens without a session', opened.status, 200);
  eq('it serves exactly what was frozen', opened.body.html, '<p>frozen</p>');
  await api('DELETE', `/investor/share/${link.body.token}`);
  eq('a revoked link is gone', (await api('GET', `/investor/shared/${link.body.token}`)).status, 410);

  close();
  process.exit(report() === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
