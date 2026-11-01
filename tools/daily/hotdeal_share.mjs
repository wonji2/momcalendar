// 핫딜 목록을 **카톡방에 붙여넣을 형태**로 뽑는다 (사장님 지시 2026-10-05
//   "핫딜은 핫딜카드 상품명이랑 내 수익링크까지 쫙 다 뽑아줄 수 있나 카톡방 공유하게")
//
// 왜 필요한가
//   daily/hotdeal.txt(카드 캡션)에는 **링크가 없다** — 카드 그림과 같이 쓰라고 만든 것이라
//   "프로필 링크에서 보세요" 로 끝난다. 카톡방에 그대로 올리면 손님이 상품을 못 찾는다.
//   그래서 상품명·정가→판매가·할인율·**우리 수익링크**를 한 줄씩 붙여 내보낸다.
//
// 실행
//   node tools/daily/hotdeal_share.mjs              오늘 뜬 것만 (기본)
//   node tools/daily/hotdeal_share.mjs --all        지금 노출 중인 것 전부
//   node tools/daily/hotdeal_share.mjs --top=20     할인율 높은 순 20건
//   node tools/daily/hotdeal_share.mjs --mall=토스쇼핑
// 산출물: scratchpad/hotdeal_share.txt (화면에도 그대로 찍는다)
//
// 🔴 링크는 **DB 에 저장된 우리 수익링크 그대로** 쓴다. 조립·수정하지 않는다.
//   남의 어필리에이트 링크는 애초에 등록되지 않는다(verify_revenue.sh 가 거른다).
// 🔴 수수료 고지 한 줄을 맨 위에 붙인다 — 제휴 링크를 직접 공유하는 자리라 고지 의무가 있다.
//   (사이트 카드 글과 다르다. 스레드 핫딜 글은 링크를 안 붙여서 고지가 없다 — CLAUDE.md 스레드 규칙 2)
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { sbArgs, parseRows } from './sb_query.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = process.env.SUPABASE_CLI || 'C:/Users/FAMILY/supabase-cli/supabase.exe';
const SQLF = join(ROOT, 'scratchpad', '_hotdeal_share.sql');
const OUT = join(ROOT, 'scratchpad', 'hotdeal_share.txt');
const NL = String.fromCharCode(10);

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const argv = (k, d) => { const a = args.find((x) => x.startsWith(k + '=')); return a ? a.slice(k.length + 1) : d; };
const top = Number(argv('--top', '0')) || 0;
const mall = argv('--mall', '');
const kst = new Date(Date.now() + 9 * 3600e3);
const won = (n) => (n == null ? '' : Number(n).toLocaleString('ko-KR') + '원');

const q = (sql) => {
  writeFileSync(SQLF, sql, 'utf8');
  const r = parseRows(execFileSync(CLI, sbArgs(SQLF), { encoding: 'utf8', timeout: 120000, cwd: ROOT }));
  if (!r.ok) throw new Error('DB 조회 실패 — ' + r.why);
  return r.rows;
};

const where = [
  '(expires_at is null or expires_at > now())',
  "coalesce(link,'') <> ''",
  has('--all') || top ? null : "deal_day = (now() at time zone 'Asia/Seoul')::date",
  mall ? `mall = '${mall.split("'").join("''")}'` : null,
].filter(Boolean).join(' and ');

const rows = q(`select title, price, price_before, discount_rate, mall, link
  from public.hotdeals where ${where}
 order by discount_rate desc nulls last, id desc ${top ? 'limit ' + top : ''};`);

if (!rows.length) { console.log('내보낼 핫딜이 없다'); process.exit(0); }

// 몰 이름을 손님이 읽는 말로 (카드와 같은 표기)
const MALL = { 토스쇼핑: '토스', 오늘의집: '오늘의집', 쿠팡: '쿠팡', 지마켓: '지마켓', '11번가': '11번가', 네이버: '네이버', 옥션: '옥션', 롯데온: '롯데온' };

const head = `📢 제휴 링크가 포함돼 있어요 (구매 시 일정액의 수수료를 받습니다)${NL}${NL}` +
  `🔥 ${kst.getMonth() + 1}/${kst.getDate()} ${has('--all') || top ? '맘캘린더 핫딜' : '오늘 뜬 핫딜'} ${rows.length}건${NL}`;

const body = rows.map((r) => {
  const price = won(r.price);
  const before = r.price_before && Number(r.price_before) > Number(r.price) ? won(r.price_before) + ' → ' : '';
  const rate = r.discount_rate ? ` (${r.discount_rate}%↓)` : '';
  const m = MALL[r.mall] || r.mall || '';
  return `${NL}▪ ${r.title}${NL}💰 ${before}${price}${rate}${m ? ' · ' + m : ''}${NL}${r.link}`;
}).join(NL);

const tail = `${NL}${NL}더 많은 핫딜은 momcalendar.com 핫딜 탭에서 볼 수 있어요`;
const out = head + body + tail;

writeFileSync(OUT, out, 'utf8');
console.log(out);
console.log(`${NL}──────── ${rows.length}건 · ${OUT}`);
