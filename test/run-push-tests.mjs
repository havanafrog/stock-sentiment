// push.mjs 검사. 암호문이 표준과 한 바이트라도 다르면 폰은 조용히 버린다 —
// 오류도 안 온다. 그래서 RFC 가 준 값으로 똑같이 나오는지 본다.
import { createECDH, createPublicKey, verify, hkdfSync, createDecipheriv } from 'node:crypto';
import { createServer } from 'node:http';
import { encrypt, makeVapid, vapidAuth, send, gate, pushHostOk } from '../push.mjs';

// 가짜 푸시 서버는 http 다. 운영에선 막히고 이 변수가 있을 때만 열린다.
process.env.PUSH_ALLOW_HTTP = '1';

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}  ${extra}`); }
};
const u = s => Buffer.from(s, 'base64url');

console.log('\n── A. RFC 8291 부록 A ──');
{
  const V = {
    plain: 'When I grow up, I want to be a watermelon',
    asPriv: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
    uaPub: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
    auth: 'BTBZMqHH6r4Tts7J_aSIgg',
    salt: 'DGv6ra1nlYgDCS1FRnbzlw',
    body: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
  };
  const got = encrypt(V.plain, { p256dh: V.uaPub, auth: V.auth }, { salt: u(V.salt), asPriv: u(V.asPriv) });
  ok('부록 A 암호문과 같다', got.toString('base64url') === V.body, got.toString('base64url'));
}

/** 받는 쪽(폰) 흉내 — 받은 본문을 풀어 본다. */
function decrypt(body, uaPriv, auth) {
  const salt = body.subarray(0, 16), idlen = body[20], asPub = body.subarray(21, 21 + idlen);
  const ua = createECDH('prime256v1'); ua.setPrivateKey(uaPriv);
  const ikm = Buffer.from(hkdfSync('sha256', ua.computeSecret(asPub), auth,
    Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPub]), 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const ct = body.subarray(21 + idlen);
  const d = createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(ct.subarray(-16));
  const p = Buffer.concat([d.update(ct.subarray(0, -16)), d.final()]);
  return p.subarray(0, p.lastIndexOf(2)).toString();
}

console.log('\n── B. VAPID ──');
{
  const v = makeVapid();
  const h = vapidAuth('https://fcm.googleapis.com/fcm/send/abc', v, 'https://example.com', 1_700_000_000_000);
  const [, jwt, k] = h.match(/^vapid t=([^,]+), k=(.+)$/) ?? [];
  const [head, body, sig] = jwt.split('.');
  const claims = JSON.parse(u(body).toString());
  ok('aud 는 endpoint 의 origin', claims.aud === 'https://fcm.googleapis.com', claims.aud);
  ok('exp 는 12시간 뒤', claims.exp === 1_700_000_000 + 12 * 3600, claims.exp);
  ok('k 는 공개키', k === v.pub);
  const p = u(v.pub);
  const pub = createPublicKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256',
    x: p.subarray(1, 33).toString('base64url'), y: p.subarray(33).toString('base64url') } });
  ok('ES256 서명이 공개키로 풀린다', verify('sha256', Buffer.from(`${head}.${body}`),
    { key: pub, dsaEncoding: 'ieee-p1363' }, u(sig)));
}

console.log('\n── C. 가짜 푸시 서버로 보내기 ──');
{
  const ua = createECDH('prime256v1'); ua.generateKeys();
  const auth = Buffer.from('0123456789abcdef');
  let seen = null;
  const srv = createServer((req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => { seen = { h: req.headers, body: Buffer.concat(chunks) }; res.writeHead(201).end(); });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const sub = { endpoint: `http://127.0.0.1:${srv.address().port}/push/xyz`,
    keys: { p256dh: ua.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } };
  const code = await send(sub, { t: 'SNDK', wail: 93 }, makeVapid(), { subject: 'https://example.com', topic: 'wail-SNDK' });
  ok('201 을 돌려준다', code === 201, code);
  ok('TTL 1800', seen?.h.ttl === '1800', seen?.h.ttl);
  ok('Content-Encoding aes128gcm', seen?.h['content-encoding'] === 'aes128gcm');
  ok('Urgency high', seen?.h.urgency === 'high');
  ok('Topic 이 붙는다', seen?.h.topic === 'wail-SNDK');
  ok('Authorization 은 vapid', /^vapid t=.+, k=.+/.test(seen?.h.authorization ?? ''));
  const back = JSON.parse(decrypt(seen.body, ua.getPrivateKey(), auth));
  ok('받은 쪽이 풀면 보낸 내용', back.t === 'SNDK' && back.wail === 93, JSON.stringify(back));
  srv.close();
  const dead = await send({ ...sub, endpoint: 'http://127.0.0.1:1/x' }, {}, makeVapid(), { subject: 'x' });
  ok('못 닿으면 0', dead === 0, dead);
}

console.log('\n── E. 받는 주소 제한 (SSRF) ──');
{
  const good = ['https://fcm.googleapis.com/fcm/send/abc', 'https://updates.push.services.mozilla.com/wpush/v2/x',
    'https://web.push.apple.com/QK', 'https://api.push.apple.com/x', 'https://wns2-par02p.notify.windows.com/w/?token=1'];
  const bad = ['https://192.168.0.1/push', 'https://localhost/x', 'https://127.0.0.1/x', 'http://fcm.googleapis.com/x',
    'https://fcm.googleapis.com:8443/x', 'https://fcm.googleapis.com.evil.com/x', 'https://evilpush.apple.com.evil.com/x',
    'https://fcm.googleapis.com@192.168.0.1/x', 'https://x:y@fcm.googleapis.com/x', '아무거나'];
  ok('푸시 서비스 주소는 받는다', good.every(pushHostOk), good.filter(e => !pushHostOk(e)).join(' '));
  ok('내부망·다른 호스트·다른 포트는 막는다', !bad.some(pushHostOk), bad.filter(pushHostOk).join(' '));
  let hit = false;
  const srv = createServer((q, r) => { hit = true; r.end(); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const ua = createECDH('prime256v1'); ua.generateKeys();
  const keys = { p256dh: ua.getPublicKey().toString('base64url'), auth: 'MDEyMzQ1Njc4OWFiY2RlZg' };
  const code = await send({ endpoint: `https://127.0.0.1:${srv.address().port}/x`, keys }, {}, makeVapid(), { subject: 'x' });
  ok('허용 밖 주소로는 보내지도 않는다', code === 0 && !hit, code);
  delete process.env.PUSH_ALLOW_HTTP;
  const code2 = await send({ endpoint: `http://127.0.0.1:${srv.address().port}/x`, keys }, {}, makeVapid(), { subject: 'x' });
  ok('시험 변수가 없으면 http 도 막힌다', code2 === 0 && !hit, code2);
  process.env.PUSH_ALLOW_HTTP = '1';
  srv.close();
}

console.log('\n── D. 경보 판정 ──');
{
  const M = 60_000;
  const run = (seq, st = {}) => seq.map(([t, w]) => gate(st, w, t * M) ? 1 : 0).join('');
  ok('넘는 순간 한 번, 위에 머물면 안 울린다', run([[0, 85], [1, 91], [2, 95], [3, 99]]) === '0100');
  ok('89·91 을 오가도 한 번', run([[0, 85], [1, 91], [2, 89], [40, 92], [80, 88], [120, 91]]) === '010000');
  ok('80 밑으로 내려갔다 다시 넘으면 또', run([[0, 91], [10, 79], [40, 91]]) === '101');
  ok('쿨다운 안에 다시 넘으면 기다렸다 보낸다', run([[0, 91], [10, 79], [20, 91], [31, 92]]) === '1001');
  ok('값이 없으면 안 울린다', run([[0, null], [1, undefined]]) === '00');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
