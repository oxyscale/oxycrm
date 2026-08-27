/**
 * The call loop: dispositions, the unanswered threshold, the voicemail
 * flag, and the promise that notes and transcripts are never lost.
 */
import { startHarness, check, eq, setSection, report } from './harness';

(async () => {
  const { api, db, close } = await startHarness();
  const mk = async (name: string, phone: string) =>
    (await api('POST', '/leads', { name, phone, company: `${name} Pty`, category: 'QA' })).body;

  const row = (id: number) => db.prepare('SELECT * FROM leads WHERE id = ?').get(id) as any;
  const dispose = (leadId: number, disposition: string, extra: Record<string, unknown> = {}) =>
    api('POST', `/leads/${leadId}/disposition`,
      { leadId, disposition, callDuration: 60, transcript: `talked about ${disposition}`, ...extra });

  // ── no answer ──────────────────────────────────────────────────
  setSection('Didn\'t answer');
  const a = await mk('Ann Answer', '0400100001');
  eq('starts on zero unanswered', row(a.id).unanswered_calls, 0);
  const d1 = await dispose(a.id, 'no_answer');
  eq('disposition is accepted', d1.status, 200);
  eq('the attempt is counted', row(a.id).unanswered_calls, 1);
  eq('lead survives a no-answer', !!row(a.id), true);

  // ── the threshold ──────────────────────────────────────────────
  setSection('Unanswered threshold');
  const t = await mk('Terry Threshold', '0400100002');
  for (let i = 0; i < 5; i++) await dispose(t.id, 'no_answer');
  const after = row(t.id);
  eq('five attempts are all counted', after.unanswered_calls, 5);
  check('hitting the threshold takes them out of the queue',
    after.status !== 'not_called' || after.pipeline_stage === 'lost',
    `status=${after.status} stage=${after.pipeline_stage} queue=${after.queue_position}`);

  // ── voicemail ──────────────────────────────────────────────────
  setSection('Voicemail');
  const v = await mk('Vic Voicemail', '0400100003');
  await dispose(v.id, 'voicemail');
  eq('voicemail flag is set', row(v.id).voicemail_left, 1);
  check('and dated so it can be shown on redial', !!row(v.id).voicemail_date, `${row(v.id).voicemail_date}`);
  eq('voicemail also counts as an attempt', row(v.id).unanswered_calls, 1);

  // ── transcripts are kept ───────────────────────────────────────
  setSection('Nothing is lost');
  const k = await mk('Kim Keep', '0400100004');
  await dispose(k.id, 'no_answer');
  await dispose(k.id, 'voicemail');
  await dispose(k.id, 'not_interested');
  const logs = db.prepare('SELECT * FROM call_logs WHERE lead_id = ? ORDER BY id').all(k.id) as any[];
  eq('every call is logged, none overwritten', logs.length, 3);
  check('each transcript is kept verbatim',
    logs.every((l) => typeof l.transcript === 'string' && l.transcript.includes('talked about')),
    JSON.stringify(logs.map((l) => l.transcript)));

  const n1 = await api('POST', '/notes', { leadId: k.id, content: 'First note' });
  const n2 = await api('POST', '/notes', { leadId: k.id, content: 'Second note' });
  eq('notes are accepted', [n1.status, n2.status], [201, 201]);
  const notes = (await api('GET', `/notes/lead/${k.id}`)).body as any[];
  check('both notes are there — appended, not replaced',
    Array.isArray(notes) && notes.length >= 2, `${JSON.stringify(notes).slice(0, 160)}`);

  // ── not interested / wrong number ──────────────────────────────
  setSection('Closing dispositions');
  const ni = await mk('Nina NotInterested', '0400100005');
  await dispose(ni.id, 'not_interested');
  const niRow = row(ni.id);
  check('not-interested is closed out', niRow && niRow.pipeline_stage === 'lost',
    `stage=${niRow?.pipeline_stage}`);
  check('but the record and its transcript are kept',
    (db.prepare('SELECT COUNT(*) n FROM call_logs WHERE lead_id = ?').get(ni.id) as any).n === 1);

  const wn = await mk('Walter WrongNumber', '0400100006');
  await dispose(wn.id, 'wrong_number');
  check('wrong number removes the lead', !row(wn.id), 'lead row still present');

  // ── validation ─────────────────────────────────────────────────
  setSection('Bad input is refused');
  eq('unknown disposition rejected',
    (await api('POST', `/leads/${a.id}/disposition`,
      { leadId: a.id, disposition: 'maybe', callDuration: 1, transcript: '' })).status, 400);
  eq('negative duration rejected',
    (await api('POST', `/leads/${a.id}/disposition`,
      { leadId: a.id, disposition: 'no_answer', callDuration: -5, transcript: '' })).status, 400);
  eq('missing lead rejected',
    (await api('POST', '/leads/999999/disposition',
      { leadId: 999999, disposition: 'no_answer', callDuration: 1, transcript: '' })).status, 404);

  close();
  process.exit(report() === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
