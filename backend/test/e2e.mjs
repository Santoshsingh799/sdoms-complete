import fs from 'fs';
import { execSync } from 'child_process';
const B = 'http://localhost:5000/api';
const LOG = '/tmp/server.log';
let pass = 0, fail = 0, logPos = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log(`${c ? '  PASS' : '  FAIL'}  ${m}`); };
const api = async (method, path, body, token) => {
  const r = await fetch(B + path, { method, headers: { 'content-type': 'application/json', ...(token && { authorization: 'Bearer ' + token }) }, body: body ? JSON.stringify(body) : undefined });
  const ct = r.headers.get('content-type') || '';
  return { status: r.status, body: ct.includes('json') ? await r.json() : await r.text(), ct };
};
const login = async (id, pw) => (await api('POST', '/auth/login', { loginId: id, password: pw })).body.token;
// read new SMS lines from server log -> [{mobile, token}]
const newLinks = async () => { await new Promise((r) => setTimeout(r, 300)); const t = fs.readFileSync(LOG, 'utf8').slice(logPos); logPos += t.length; return [...t.matchAll(/SIMULATED SMS -> (\d+)\]\n[^\n]*\/g\/([\w-]+)/g)].map((m) => ({ mobile: m[1], token: m[2] })); };
const psql = (q) => execSync('psql -h localhost -U postgres -d sdoms -tA', { input: q, env: { ...process.env, PGPASSWORD: 'password' } }).toString().trim();
const inFuture = (h) => new Date(Date.now() + h * 3600e3).toISOString();

const admin = await login('admin', 'Admin@123'), mentor = await login('mentor1', 'Mentor@123'), guard = await login('guard1', 'Guard@123'), stu = await login('A12345', 'Student@123');
await newLinks();

console.log('\n[1] Security basics');
ok((await api('GET', '/admin/stats')).status === 401, 'no token -> 401');
ok((await api('GET', '/admin/stats', null, stu)).status === 403, 'student cannot open admin API -> 403');
ok((await api('POST', '/auth/login', { loginId: 'A12345', password: 'wrongpass' })).status === 401, 'wrong password -> 401');

console.log('\n[2] Guardian verification');
const g = await api('GET', '/outpass/guardians', null, stu); const father = g.body[0];
const add = async (n, m) => (await api('POST', '/outpass/guardians', { name: n, mobile: m, relation: 'Other Guardian' }, stu));
const a2 = await add('Fake Uncle', '9111111111'); const a3 = await add('Mother Demo', '9222222222'); const a4 = await add('Brother Demo', '9333333333');
ok(a2.status === 201, 'student can add guardian (unverified)');
const body = (ids) => ({ destination: 'Gwalior Fort', reason: 'Family function', leaveTime: inFuture(0.5), returnTime: inFuture(6), emergencyMobile: '9000000002', guardianLinkIds: ids });
ok((await api('POST', '/outpass', body([father.id, a2.body.id]), stu)).status === 400, 'request with UNVERIFIED guardian is blocked');
for (const a of [a3, a4]) await api('PATCH', `/admin/guardian-links/${a.body.id}/verify`, { verified: true }, admin);
ok((await api('POST', '/outpass', { ...body([father.id]), leaveTime: new Date(Date.now() - 3600e3).toISOString() }, stu)).status === 400, 'past leaving time rejected');

console.log('\n[3] Happy path: 3 guardians, simultaneous clicks, mentor, QR');
const r1 = await api('POST', '/outpass', body([father.id, a3.body.id, a4.body.id]), stu);
ok(r1.status === 201, 'request created'); const id1 = r1.body.id;
ok((await api('POST', '/outpass', body([father.id]), stu)).status === 409, 'second active request blocked');
const links = await newLinks(); ok(links.length === 3, `SMS sent to all 3 guardians (got ${links.length})`);
const race = await Promise.all([api('POST', `/g/${links[0].token}`, { decision: 'APPROVE' }), api('POST', `/g/${links[1].token}`, { decision: 'REJECT' }), api('POST', `/g/${links[2].token}`, { decision: 'APPROVE' })]);
const wins = race.filter((x) => x.status === 200).length;
ok(wins === 1, `simultaneous clicks: exactly 1 accepted (accepted=${wins}, statuses=${race.map((x) => x.status)})`);
const st1 = (await api('GET', `/outpass/${id1}`, null, stu)).body.status;
ok(['PENDING_MENTOR', 'GUARDIAN_REJECTED'].includes(st1), 'final status consistent: ' + st1);
ok((await api('GET', `/g/${links[0].token}`)).body.state !== 'OPEN', 'other links no longer OPEN');
if (st1 === 'GUARDIAN_REJECTED') { console.log('  (race was won by REJECT; re-running happy path)'); await api('POST', `/outpass/${id1}/cancel`, null, stu); }
ok((await api('POST', '/mentor/requests/' + id1 + '/decision', { decision: 'APPROVE' }, mentor)).status === (st1 === 'PENDING_MENTOR' ? 200 : 409), 'mentor approval accepted only after guardian approval');
let happyId = id1;
if (st1 !== 'PENDING_MENTOR') {
  const r = await api('POST', '/outpass', body([father.id]), stu); happyId = r.body.id; const l = await newLinks();
  await api('POST', `/g/${l[0].token}`, { decision: 'APPROVE' });
  ok((await api('POST', `/mentor/requests/${happyId}/decision`, { decision: 'APPROVE' }, mentor)).status === 200, 'mentor approves');
}
const passRes = await api('GET', `/outpass/${happyId}/pass`, null, stu);
ok(passRes.status === 200 && passRes.body.qr.startsWith('data:image/png'), 'student gets pass with QR image');
const pdf = await api('GET', `/outpass/${happyId}/pass.pdf`, null, stu); ok(pdf.ct.includes('pdf') && pdf.body.startsWith('%PDF'), 'PDF download works');
const row = psql(`select "verifyId"||'.'||signature from "DigitalOutpass" d join "OutpassRequest" r on r.id=d."requestId" where r.id='${happyId}'`);
const scan = (code) => api('POST', '/guard/scan', { code }, guard);

console.log('\n[4] Gate: scan / exit / return');
const s1 = await scan(row); ok(s1.body.result === 'VALID' && s1.body.next === 'EXIT', 'scan -> VALID (next: EXIT)');
ok(!JSON.stringify(s1.body).includes('mobile'), 'scan response exposes no mobile numbers');
ok((await scan(row.slice(0, -2) + 'xx')).body.result === 'INVALID', 'tampered QR -> INVALID');
ok((await scan('garbage-code')).body.result === 'INVALID', 'random text -> INVALID');
ok((await api('POST', '/guard/return', { code: row }, guard)).status === 409, 'cannot RETURN before EXIT');
ok((await api('POST', '/guard/exit', { code: row }, guard)).status === 200, 'MARK EXITED');
ok((await api('POST', '/guard/exit', { code: row }, guard)).status === 409, 'duplicate EXIT blocked');
ok((await scan(row)).body.next === 'RETURN', 'scan after exit -> next: RETURN');
ok((await api('POST', '/guard/return', { code: row }, guard)).status === 200, 'MARK RETURNED');
ok((await scan(row)).body.result === 'ALREADY_USED', 'scan after return -> ALREADY_USED');
ok((await api('POST', '/guard/exit', { code: row }, stu)).status === 403, 'student cannot use guard API');

console.log('\n[5] Guardian rejects');
const r2 = await api('POST', '/outpass', body([father.id, a3.body.id]), stu); const l2 = await newLinks();
ok((await api('POST', `/g/${l2[0].token}`, { decision: 'REJECT' })).status === 200, 'guardian rejects');
ok((await api('GET', `/outpass/${r2.body.id}`, null, stu)).body.status === 'GUARDIAN_REJECTED', 'status GUARDIAN_REJECTED');
ok((await api('GET', `/g/${l2[1].token}`)).body.state !== 'OPEN', 'other guardian link closed');
ok(psql(`select count(*) from "DigitalOutpass" where "requestId"='${r2.body.id}'`) === '0', 'no pass generated');
ok((await api('POST', `/mentor/requests/${r2.body.id}/decision`, { decision: 'APPROVE' }, mentor)).status === 409, 'mentor cannot approve a guardian-rejected request');

console.log('\n[6] Mentor rejects');
const r3 = await api('POST', '/outpass', body([father.id]), stu); const l3 = await newLinks();
await api('POST', `/g/${l3[0].token}`, { decision: 'APPROVE' });
ok((await api('POST', `/mentor/requests/${r3.body.id}/decision`, { decision: 'REJECT', remark: 'Exam week' }, mentor)).status === 200, 'mentor rejects with remark');
ok(psql(`select status from "OutpassRequest" where id='${r3.body.id}'`) === 'MENTOR_REJECTED' && psql(`select count(*) from "DigitalOutpass" where "requestId"='${r3.body.id}'`) === '0', 'MENTOR_REJECTED, no QR pass');

console.log('\n[7] No response / resend / invalid link');
const r4 = await api('POST', '/outpass', body([father.id]), stu); const l4 = await newLinks();
ok((await api('GET', `/outpass/${r4.body.id}`, null, stu)).body.status === 'PENDING_GUARDIAN', 'stays PENDING_GUARDIAN with no response');
ok((await api('POST', `/outpass/${r4.body.id}/resend`, null, stu)).status === 200, 'resend works'); const l4b = await newLinks();
ok((await api('GET', `/g/${l4[0].token}`)).status === 404, 'old link dead after resend');
ok((await api('GET', `/g/${l4b[0].token}`)).body.state === 'OPEN', 'new link works');
ok((await api('GET', '/g/not-a-real-token')).status === 404, 'random token -> 404');
psql(`update "GuardianApproval" set "expiresAt"=now()-interval '1 hour' where "requestId"='${r4.body.id}'`);
ok((await api('POST', `/g/${l4b[0].token}`, { decision: 'APPROVE' })).status === 409, 'expired link cannot approve');
await api('POST', `/outpass/${r4.body.id}/cancel`, null, stu);

console.log('\n[8] Expired & cancelled QR');
const r5 = await api('POST', '/outpass', body([father.id]), stu); const l5 = await newLinks();
await api('POST', `/g/${l5[0].token}`, { decision: 'APPROVE' }); await api('POST', `/mentor/requests/${r5.body.id}/decision`, { decision: 'APPROVE' }, mentor);
const code5 = psql(`select "verifyId"||'.'||signature from "DigitalOutpass" where "requestId"='${r5.body.id}'`);
psql(`update "DigitalOutpass" set "validFrom"=now()+interval '3 hours' where "requestId"='${r5.body.id}'`);
ok((await scan(code5)).body.result === 'INVALID', 'pass used before its time window -> INVALID');
psql(`update "DigitalOutpass" set "validUntil"=now()-interval '1 hour', "validFrom"=now()-interval '5 hours' where "requestId"='${r5.body.id}'`);
ok((await scan(code5)).body.result === 'EXPIRED', 'old pass -> EXPIRED');
psql(`update "DigitalOutpass" set "validUntil"=now()+interval '5 hours' where "requestId"='${r5.body.id}'`);
ok((await scan(code5)).body.result === 'VALID', 'inside validity window -> VALID');
await api('POST', `/outpass/${r5.body.id}/cancel`, null, stu);
ok((await scan(code5)).body.result === 'CANCELLED', 'student cancels -> CANCELLED');

console.log('\n[9] Admin');
const rep = await api('GET', '/admin/reports/requests.csv?status=RETURNED', null, admin);
ok(rep.status === 200 && rep.body.includes('A12345'), 'CSV report export');
ok((await api('GET', '/admin/reports/requests.pdf', null, admin)).body.startsWith('%PDF'), 'PDF report export');
const stats = (await api('GET', '/admin/stats', null, admin)).body; ok(stats.students >= 1, 'dashboard stats: ' + JSON.stringify(stats.byStatus));
ok(+psql(`select count(*) from "AuditLog"`) > 15 && +psql(`select count(*) from "Notification"`) > 10, 'audit log + notifications recorded');

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
