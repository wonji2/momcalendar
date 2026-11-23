// Play 벌크 CSV 파서 시험 (오더 §10 V6) —  node --test tools/analytics/test_play_parse.mjs
//   fixtures/installs_overview_utf16.csv : 실제 파일과 같은 UTF-16LE + BOM, 칸 순서를 일부러 섞고 쉼표 든 숫자("1,234")를 넣었다.
//   fixtures/installs_country_utf16.csv  : 차원(country) 파일 — 같은 날짜 여러 줄을 더해야 한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeCsv, parseInstallsCsv } from './play.mjs';
import { parseDelimited, redact } from './lib.mjs';

const F = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const get = (rows, day, metric) => (rows.find((r) => r.day === day && r.metric === metric) || {}).value;

test('overview: UTF-16 + BOM, 칸 순서가 달라도 이름으로 읽는다', () => {
  const buf = fs.readFileSync(path.join(F, 'installs_overview_utf16.csv'));
  assert.equal(buf[0], 0xff); assert.equal(buf[1], 0xfe);
  const p = parseInstallsCsv(decodeCsv(buf));
  assert.equal(p.days, 3);
  assert.equal(get(p.rows, '2026-10-01', 'device_installs'), 31);
  assert.equal(get(p.rows, '2026-10-02', 'device_installs'), 1234);       // "1,234"
  assert.equal(get(p.rows, '2026-10-03', 'device_installs'), 0);          // 0 은 0 이다(빈칸과 다름)
  assert.equal(get(p.rows, '2026-10-01', 'device_uninstalls'), 4);
  assert.equal(get(p.rows, '2026-10-03', 'active_device_installs'), 790);
  assert.equal(get(p.rows, '2026-10-02', 'user_installs'), 28);
  assert.deepEqual(p.missing, []);
});

test('country: 같은 날짜 여러 나라를 더한다 · 없는 칸은 건너뛰고 알린다', () => {
  const p = parseInstallsCsv(decodeCsv(fs.readFileSync(path.join(F, 'installs_country_utf16.csv'))));
  assert.equal(get(p.rows, '2026-10-01', 'device_installs'), 33);         // KR 30 + US 3
  assert.equal(get(p.rows, '2026-10-02', 'device_installs'), 20);         // 빈칸인 JP 줄은 더하지 않는다
  assert.ok(p.missing.includes('Total User Installs'));
  assert.equal(get(p.rows, '2026-10-01', 'total_user_installs'), undefined);
});

test('빈 파일·머리줄만 있는 파일은 0행', () => {
  assert.equal(parseInstallsCsv('').rows.length, 0);
  assert.equal(parseInstallsCsv('Date,Package Name,Daily Device Installs\n').rows.length, 0);
});

test('구분자 파서: 따옴표 안 쉼표·줄바꿈·겹따옴표', () => {
  assert.deepEqual(parseDelimited('a,"b,1","c ""x"""\r\n1,2,3\n'), [['a', 'b,1', 'c "x"'], ['1', '2', '3']]);
  assert.deepEqual(parseDelimited('Date\tCounts\n2026-11-01\t5\n', '\t'), [['Date', 'Counts'], ['2026-11-01', '5']]);
});

test('로그 가림: 토큰·키가 글에 남지 않는다', () => {
  const s = redact('실패 eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.abcdefghijklmnop -----BEGIN PRIVATE KEY-----\nMIIabc\n-----END PRIVATE KEY----- ya29.A0AfH6SMBxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
  assert.ok(!/eyJ|MIIabc|A0AfH6/.test(s));
});
