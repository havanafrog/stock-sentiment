// 곡소리 경보를 폰으로 보내는 Web Push.
//
// 라이브러리 없이 node:crypto 로 두 표준을 그대로 짠다.
//   RFC 8291  본문 암호화(aes128gcm) — 푸시 서버(FCM·APNs)는 내용을 못 본다
//   RFC 8292  VAPID — "이 사이트가 보낸 것" 을 ES256 서명으로 밝힌다
// 이 저장소는 package.json 조차 없다. 의존성 하나 들이려고 그걸 깨지 않는다.
import { createECDH, createPrivateKey, sign, hkdfSync, createCipheriv, randomBytes } from 'node:crypto';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';

const b64u = b => Buffer.from(b).toString('base64url');
const unb64u = s => Buffer.from(s, 'base64url');

/** 새 VAPID 키 한 쌍. 공개키는 65바이트 비압축 점이다(브라우저가 그 꼴을 원한다). */
export function makeVapid() {
  const e = createECDH('prime256v1');
  e.generateKeys();
  return { pub: b64u(e.getPublicKey()), priv: b64u(e.getPrivateKey()) };
}

function signingKey(v) {
  const p = unb64u(v.pub);
  return createPrivateKey({ format: 'jwk', key: {
    kty: 'EC', crv: 'P-256', d: v.priv, x: b64u(p.subarray(1, 33)), y: b64u(p.subarray(33, 65)) } });
}

/** Authorization 헤더. 받는 쪽은 endpoint 의 origin 이다. 유효기간은 12시간(최대 24). */
export function vapidAuth(endpoint, v, subject, now = Date.now()) {
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const body = b64u(JSON.stringify({ aud: new URL(endpoint).origin,
    exp: Math.floor(now / 1000) + 12 * 3600, sub: subject }));
  const sig = sign('sha256', Buffer.from(`${head}.${body}`), { key: signingKey(v), dsaEncoding: 'ieee-p1363' });
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${v.pub}`;
}

/**
 * RFC 8291 본문. keys = 구독의 { p256dh, auth }.
 * salt·보내는 쪽 개인키는 시험에서 RFC 부록 A 값을 넣으려고 받는다. 평소엔 매번 새로.
 */
export function encrypt(payload, keys, { salt = randomBytes(16), asPriv = null } = {}) {
  const ua = unb64u(keys.p256dh), auth = unb64u(keys.auth);
  const as = createECDH('prime256v1');
  if (asPriv) as.setPrivateKey(asPriv); else as.generateKeys();
  const asPub = as.getPublicKey();
  const shared = as.computeSecret(ua);
  const ikm = Buffer.from(hkdfSync('sha256', shared, auth,
    Buffer.concat([Buffer.from('WebPush: info\0'), ua, asPub]), 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const c = createCipheriv('aes-128-gcm', cek, nonce);
  // 마지막 레코드 표시 0x02. 레코드는 하나뿐이다 — 알림 글은 4KB 에 한참 못 미친다.
  const ct = Buffer.concat([c.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), c.final(), c.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPub.length]), asPub, ct]);
}

/**
 * 한 구독에 보낸다. 돌려주는 건 HTTP 상태. 404·410 이면 구독이 죽은 것이다.
 * 망이 끊기거나 10초를 넘기면 0.
 */
export function send(sub, payload, v, { subject, ttl = 1800, urgency = 'high', topic } = {}) {
  const body = encrypt(JSON.stringify(payload), sub.keys);
  const u = new URL(sub.endpoint);
  const req = u.protocol === 'http:' ? httpRequest : httpsRequest;   // http 는 시험용 가짜 서버뿐
  return new Promise(done => {
    const r = req(u, { method: 'POST', timeout: 10_000, headers: {
      TTL: String(ttl), Urgency: urgency, 'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream', 'Content-Length': body.length,
      Authorization: vapidAuth(sub.endpoint, v, subject),
      ...(topic ? { Topic: topic } : {}) } }, res => { res.resume(); done(res.statusCode); });
    r.on('timeout', () => r.destroy());
    r.on('error', () => done(0));
    r.end(body);
  });
}

/**
 * 경보를 보낼 때인가. st = 종목 하나의 { armed, last }, 고치면서 판단한다.
 *   넘는 순간만: 90 미만 → 90 이상. 계속 위에 있으면 또 안 보낸다.
 *   다시 무장: 80 밑으로 한 번 내려가야 한다. 89·91 을 오가도 한 번만 울린다.
 *   쿨다운: 같은 종목은 30분에 한 번. 그 안에 넘으면 무장은 남아 쿨다운이 끝날 때 보낸다.
 * 모든 구독에 한꺼번에 보내므로 종목별 쿨다운이 곧 구독별 쿨다운이다.
 */
export function gate(st, wail, now, { on = 90, rearm = 80, coolMs = 30 * 60_000 } = {}) {
  if (wail === null || wail === undefined) return false;
  st.armed ??= true;
  if (wail < rearm) { st.armed = true; return false; }
  if (wail >= on && st.armed && now - (st.last ?? -Infinity) >= coolMs) {
    st.armed = false; st.last = now;
    return true;
  }
  return false;
}
