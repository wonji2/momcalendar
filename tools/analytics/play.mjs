// 안드로이드(Google Play) 수집 — 벌크 리포트 CSV (오더 §4-2 · §6-4)
//   🔴 playdeveloperreporting API 로 짜지 않는다 — 그 API 는 크래시·ANR 같은 vitals 만 주고 설치 수가 없다.
//   설치 수는 Play Console 의 월별 CSV(비공개 GCS 버킷 pubsite_prod_rev_…)에만 있다. UTF-16, 월 마감 +3~7일 뒤 올라온다.
//   필요한 것: GA4_SA_KEY(같은 서비스 계정) · PLAY_BUCKET(버킷 이름만) · Play Console 에 서비스 계정 초대(앱 정보 보기)
import { googleToken, saveDaily, setMeta, has, errText, parseDelimited, num, PKG, readServiceAccount } from './lib.mjs';

/** UTF-16(LE, BOM 있음/없음) 또는 UTF-8 로 온 CSV 바이트 → 글자 */
export function decodeCsv(buf) {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.slice(2).toString('utf16le');
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return Buffer.from(buf.slice(2)).swap16().toString('utf16le');
  if (buf.length >= 4 && buf[1] === 0 && buf[3] === 0) return buf.toString('utf16le');   // BOM 없는 UTF-16LE
  return buf.toString('utf8').replace(/^﻿/, '');
}

// 헤더 이름 → 우리 지표 이름. 순서를 가정하지 않고 이름으로 찾는다(구글이 칸을 바꿀 수 있다).
const COLS = [
  ['device_installs', ['Daily Device Installs']],
  ['device_uninstalls', ['Daily Device Uninstalls']],
  ['active_device_installs', ['Installs on active devices', 'Active Device Installs']],
  ['current_device_installs', ['Current Device Installs']],
  ['user_installs', ['Daily User Installs']],
  ['total_user_installs', ['Total User Installs']],
];

/** 설치 CSV 글자 → { rows:[{day,metric,value}], missing:[없는 헤더], dims:차원 칸이 있으면 그 이름 }.
 *  차원 파일(country 등)이면 날짜별로 더한다. overview 면 날짜당 한 줄이다. */
export function parseInstallsCsv(text) {
  const t = parseDelimited(text, ',');
  if (t.length < 2) return { rows: [], missing: [], days: 0 };
  const head = t[0].map((h) => h.trim());
  const idx = (names) => { for (const n of names) { const i = head.findIndex((h) => h.toLowerCase() === n.toLowerCase()); if (i >= 0) return i; } return -1; };
  const di = idx(['Date']);
  if (di < 0) return { rows: [], missing: ['Date'], days: 0 };
  const map = COLS.map(([metric, names]) => ({ metric, i: idx(names), names }));
  const missing = map.filter((m) => m.i < 0).map((m) => m.names[0]);
  const acc = new Map();
  for (const r of t.slice(1)) {
    const day = String(r[di] || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    for (const m of map) {
      if (m.i < 0) continue;
      const v = num(r[m.i]); if (v == null) continue;
      const k = day + '|' + m.metric; acc.set(k, (acc.get(k) || 0) + v);
    }
  }
  const rows = [...acc.entries()].map(([k, value]) => { const [day, metric] = k.split('|'); return { day, metric, value }; });
  return { rows, missing, days: new Set(rows.map((r) => r.day)).size };
}

export function playCheck() {
  const b = String(process.env.PLAY_BUCKET || '').trim();
  return { key: has('GA4_SA_KEY'), keyReadable: !!readServiceAccount(), bucket: !!b, bucketOk: /^[a-z0-9][a-z0-9._-]{2,220}$/.test(b), bucketHasScheme: /^gs:\/\//i.test(b) || b.includes('/') };
}

export async function collectPlay() {
  const c = playCheck();
  const stop = async (status, note, detail) => { await setMeta('play', status, note, detail); return { status, note, rows: 0 }; };
  if (!c.key) return stop('미설정', 'GA4_SA_KEY 없음(서비스 계정 키 — GA4 와 같이 씀)');
  if (!c.bucket) return stop('미설정', 'PLAY_BUCKET 없음');
  if (!c.keyReadable) return stop('오류', 'GA4_SA_KEY 를 서비스 계정 JSON 으로 읽지 못함');
  if (!c.bucketOk) return stop('오류', c.bucketHasScheme ? 'PLAY_BUCKET 에 gs:// 나 경로가 들어 있음 — 버킷 이름만 넣어야 함' : 'PLAY_BUCKET 형식이 버킷 이름이 아님');
  try {
    const token = await googleToken();
    const bucket = String(process.env.PLAY_BUCKET).trim();
    const auth = { Authorization: `Bearer ${token}` };
    // ① stats/ 아래 목록(쪽 넘김 포함)
    const items = []; let page = '';
    for (let n = 0; n < 20; n++) {
      const u = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o?prefix=stats/&fields=items(name,updated),nextPageToken&maxResults=1000${page ? '&pageToken=' + encodeURIComponent(page) : ''}`;
      const r = await fetch(u, { headers: auth });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(`${r.status} ${(j.error && j.error.message) || ''}${r.status === 403 ? ' — Play Console 사용자 및 권한에 서비스 계정 초대(앱 정보 보기) 필요' : r.status === 404 ? ' — 버킷 이름 확인 필요' : ''}`);
      items.push(...(j.items || [])); page = j.nextPageToken || ''; if (!page) break;
    }
    const folders = [...new Set(items.map((x) => x.name.split('/').slice(0, 2).join('/')))].sort();
    console.log('   stats/ 아래 폴더: ' + (folders.join(' · ') || '(없음)'));
    // ② 설치 파일: 최근 2개월, overview 우선(없으면 country 한 차원만 — 차원 파일을 여러 개 더하면 두 배가 된다)
    const pick = (folder, prefix) => {
      const re = new RegExp('^' + folder + '/' + prefix + '_' + PKG.replace(/\./g, '\\.') + '_(\\d{6})_([a-z_]+)\\.csv$');
      const byMonth = new Map();
      for (const it of items) { const m = it.name.match(re); if (!m) continue; (byMonth.get(m[1]) || byMonth.set(m[1], {}).get(m[1]))[m[2]] = it.name; }
      const months = [...byMonth.keys()].sort().slice(-2);
      return months.map((mo) => ({ month: mo, name: byMonth.get(mo).overview || byMonth.get(mo).country || null, kinds: Object.keys(byMonth.get(mo)) }));
    };
    const download = async (name) => {
      const r = await fetch(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(name)}?alt=media`, { headers: auth });
      if (!r.ok) throw new Error(`${name} 내려받기 실패 HTTP ${r.status}`);
      return decodeCsv(Buffer.from(await r.arrayBuffer()));
    };
    const out = []; const used = []; const missing = new Set();
    for (const f of pick('stats/installs', 'installs')) {
      if (!f.name) { console.log(`   ${f.month}: overview·country 파일 없음(있는 것: ${f.kinds.join(',')})`); continue; }
      const p = parseInstallsCsv(await download(f.name));
      p.missing.forEach((h) => missing.add(h)); out.push(...p.rows); used.push(`${f.month}:${p.days}일`);
    }
    if (missing.size) console.log('   CSV 에 없는 칸(건너뜀): ' + [...missing].join(', '));
    // ③ 설치 유지(있을 때만)
    if (folders.includes('stats/retained_installers')) {
      for (const f of pick('stats/retained_installers', 'retained_installers')) {
        if (!f.name) continue;
        const t = parseDelimited(await download(f.name), ',');
        const head = (t[0] || []).map((h) => h.trim().toLowerCase());
        const di = head.indexOf('date'); const ri = head.findIndex((h) => h === 'retained installers' || h === 'installers');
        if (di < 0 || ri < 0) { console.log('   retained_installers 칸 이름이 달라 건너뜀: ' + head.join('|').slice(0, 160)); continue; }
        const acc = new Map();
        for (const r of t.slice(1)) { const day = String(r[di] || '').trim(); const v = num(r[ri]); if (/^\d{4}-\d{2}-\d{2}$/.test(day) && v != null) acc.set(day, (acc.get(day) || 0) + v); }
        for (const [day, value] of acc) out.push({ day, metric: 'retained_installers', value });
      }
    } else console.log('   stats/retained_installers 없음 — 만들지 않고 넘어감');
    const n = await saveDaily('play', out);
    const last = out.map((r) => r.day).sort().pop() || null;
    const note = n ? `${n}행 · ${used.join(' ')} · 마지막 ${last}` : (folders.includes('stats/installs') ? '0행(신규 데이터 없음)' : '0행 — stats/installs 폴더가 아직 없음(월 마감 뒤 올라옴)');
    await setMeta('play', 'ok', note, { folders, used, last_day: last, missing: [...missing] });
    return { status: 'ok', note, rows: n };
  } catch (e) {
    return stop('오류', errText(e));
  }
}
