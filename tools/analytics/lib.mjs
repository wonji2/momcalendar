// 통합 지표 수집 — 공용 도우미 (2026-11-23, orders/ORDER_UNIFIED_ANALYTICS_2026-11-23.md §6)
//   의존성 0: node: 내장 모듈 + 전역 fetch(Node 20+). npm install 을 하지 않는다.
//   키 값은 어디에도 찍지 않는다 — 있음/없음만. 예외 글은 redact() 를 거친다.
import crypto from 'node:crypto';

export const SB_URL = (process.env.SB_URL || 'https://hycaqsqeogjtbscmzrtm.supabase.co').replace(/\/+$/, '');
export const SB_KEY = process.env.SUPABASE_SERVICE_KEY || '';
export const APP_ID = '6826126083';
export const PKG = 'com.wantsb.momcalendar';

export const kstDay = (offsetDays = 0) => new Date(Date.now() + 9 * 3600e3 + offsetDays * 86400e3).toISOString().slice(0, 10);
export const has = (k) => !!(process.env[k] && String(process.env[k]).trim());
export const redact = (s) => String(s || '').replace(/eyJ[A-Za-z0-9._-]{20,}/g, '<jwt>')
  .replace(/-----BEGIN[\s\S]*?-----END[^-]*/g, '<key>').replace(/[A-Za-z0-9_-]{40,}/g, '<token>');
export const errText = (e) => redact(e && e.message ? e.message : e).replace(/\s+/g, ' ').slice(0, 300);

const sbHeaders = (extra = {}) => ({ apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', ...extra });

/** PostgREST upsert. 500행씩 나눈다. 서비스 키가 없으면 아무것도 쓰지 않고 false. */
export async function sbUpsert(table, conflict, rows) {
  if (!SB_KEY || !rows.length) return false;
  for (let i = 0; i < rows.length; i += 500) {
    const r = await fetch(`${SB_URL}/rest/v1/${table}?on_conflict=${conflict}`, {
      method: 'POST', headers: sbHeaders({ Prefer: 'resolution=merge-duplicates,return=minimal' }), body: JSON.stringify(rows.slice(i, i + 500)),
    });
    if (!r.ok) throw new Error(`${table} 저장 실패 HTTP ${r.status} ${(await r.text()).slice(0, 160)}`);
  }
  return true;
}
export async function sbGet(pathAndQuery) {
  if (!SB_KEY) return null;
  const r = await fetch(`${SB_URL}/rest/v1/${pathAndQuery}`, { headers: sbHeaders() });
  if (!r.ok) throw new Error(`읽기 실패 HTTP ${r.status}`);
  return r.json();
}

/** 소스 상태 한 줄. ok 일 때만 last_ok_at 을 바꾼다(미설정·오류가 마지막 성공 시각을 지우지 않게). */
export async function setMeta(source, status, note, detail) {
  const now = new Date().toISOString();
  const row = { source, status, note: String(note || '').slice(0, 300), last_try_at: now };
  if (status === 'ok') row.last_ok_at = now;
  if (detail) row.detail = detail;
  try { await sbUpsert('analytics_meta', 'source', [row]); } catch (e) { console.log(`   (상태 기록 실패: ${errText(e)})`); }
}

/** 지표 행 묶음 저장. 같은 (day,source,metric,dim) 은 한 줄로 합친다(뒤엣것이 이긴다). */
export async function saveDaily(source, rows) {
  const m = new Map();
  const at = new Date().toISOString();
  for (const r of rows) {
    if (!r || !/^\d{4}-\d{2}-\d{2}$/.test(r.day) || r.value == null || !isFinite(r.value)) continue;
    m.set(`${r.day}|${r.metric}|${r.dim || ''}`, { day: r.day, source, metric: r.metric, dim: r.dim || '', value: Number(r.value), updated_at: at });
  }
  const out = [...m.values()];
  await sbUpsert('analytics_daily', 'day,source,metric,dim', out);
  return out.length;
}

/** 서비스 계정 키: base64 로 넣었든 JSON 원문으로 넣었든 받는다. 못 읽으면 null. */
export function readServiceAccount() {
  const raw = String(process.env.GA4_SA_KEY || '').trim();
  if (!raw) return null;
  let decoded = '';
  try { decoded = Buffer.from(raw, 'base64').toString('utf8'); } catch {}
  for (const t of [raw, decoded]) {
    try { const j = JSON.parse(t); if (j && j.client_email && j.private_key) return j; } catch {}
  }
  return null;
}

let _gTok = null;
/** 구글 액세스 토큰(GA4 읽기 + Storage 읽기 범위를 한 토큰에). GA4·Play 가 같이 쓴다. */
export async function googleToken() {
  if (_gTok && _gTok.exp > Date.now() + 60e3) return _gTok.token;
  const sa = readServiceAccount();
  if (!sa) throw new Error('GA4_SA_KEY 를 서비스 계정 JSON 으로 읽지 못함');
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = b64({ alg: 'RS256', typ: 'JWT' }) + '.' + b64({
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/analytics.readonly https://www.googleapis.com/auth/devstorage.read_only',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 });
  const sig = crypto.createSign('RSA-SHA256').update(unsigned).sign(sa.private_key, 'base64url');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${unsigned}.${sig}`,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`구글 토큰 교환 실패 HTTP ${r.status} ${j.error || ''} ${j.error_description || ''}`);
  _gTok = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return _gTok.token;
}

/** 따옴표를 처리하는 구분자 파서(쉼표·탭). 빈 줄은 버린다. */
export function parseDelimited(text, sep = ',') {
  const rows = []; let row = [], cur = '', q = false;
  const s = String(text || '').replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; continue; }
    if (c === '"' && cur === '') { q = true; continue; }
    if (c === sep) { row.push(cur); cur = ''; continue; }
    if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.some((x) => x !== '')) rows.push(row);
      row = []; continue;
    }
    cur += c;
  }
  row.push(cur); if (row.some((x) => x !== '')) rows.push(row);
  return rows;
}
export const num = (v) => {
  const t = String(v == null ? '' : v).replace(/,/g, '').trim();
  if (t === '') return null;
  const n = Number(t); return isFinite(n) ? n : null;
};
