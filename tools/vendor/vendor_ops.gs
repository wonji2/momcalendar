/**
 * ════════════════════════════════════════════════════════════════
 *  원츠비 벤더 운영판 — 공구일정 + 정산  (Google Apps Script)
 * ════════════════════════════════════════════════════════════════
 *  무엇을 : 공구 1건 = 한 줄. 일정·샘플·매출·정산·지급을 한 줄에서 끝낸다.
 *  누가 본다 :
 *    · 대표(사장님) → 「대표」   오늘 누구한테 얼마 줘야 하는지, 밀린 게 뭔지
 *    · 직원        → 「직원」   지금 할 일이 순서대로. 무엇을 하라고 글로 나온다
 *    · 둘 다       → 「간트」   일정 그림
 *  고치는 곳 : 「마스터」·「셀러원장」·「요율표」 세 장.
 *              「대표」·「직원」·「간트」는 비추기만 한다(거기서 고쳐도 저장 안 됨).
 *
 *  실행법 : 새 스프레드시트 → 확장 프로그램 > Apps Script → 이 파일 전체 붙여넣기
 *           → 저장 → setup() 실행 (첫 1회, 권한 승인) → 이후엔 메뉴 「벤더운영」
 *
 *  ⚠ rebuild() 는 마스터를 원본 시트에서 다시 만든다.
 *    손으로 넣은 총매출·단계·지급일·샘플은 셀러명+시작일을 열쇠로 되살린다(carryOver_).
 *
 *  ── 셀러 구분 (사장님 확정 2026-09-18) ────────────────────────
 *  스룩페이는 셀러를 구분하지 않는다(채널이 momcal 하나뿐, 주문 검색은 상품명·기간뿐).
 *  그래서 **스룩 상품명을 「셀러명x상품」 으로 등록**하고 그 링크를 셀러에게 준다.
 *    예) 맘캘린더x또또맘 · 워니맘x아무 킥보드가방
 *  정산 때 상품명만 보면 셀러가 갈린다. 마스터 C열이 그 이름을 만들어 준다.
 *
 *  ── 정산 규칙 (사장님 확정 2026-09-18) ────────────────────────
 *    · 정산예정일 = 공구종료일 + 14일 (영업일 아닌 달력일)
 *    · 공급가   = VAT제외면 총매출 ÷ 1.1, 아니면 총매출
 *    · 소득금액 = 내림10원( 공급가 × 정산비율 )
 *    · 개인       → 소득세 3% · 지방소득세 0.3% 떼고 지급 (각각 내림10원)
 *    · 일반과세자 → 세금계산서 받고 부가세 10% 더해 지급
 *    · 간이과세자·면세 → 소득금액 그대로 지급
 *    기존 「정산금액 계산 및 정리」 시트 14건으로 대조해 14건 전부 일치.
 *
 *  🔴 주민등록번호·계좌번호 전체는 이 파일에 넣지 않는다.
 *     그건 sellerdesk(암호화 보관)에만 둔다. 여기엔 유형과 계좌 끝 4자리까지만.
 *
 *  상품 원장 : 노션 「스룩페이 상품 조건표」
 *  매출 수집 : tools/vendor/srook_settlement.mjs
 * ════════════════════════════════════════════════════════════════
 */

// ── 1. 원본 일정 파일 ──────────────────────────────────────────
var SOURCES = [
  { id: '19-6tmvPDqC4BvPeqEBugJZC0PCFPoY4jKwLMPXC4EGQ',   // 또또맘_11월
    defaultProduct: '또또맘 인기 간식 모음전', tabs: 'ALL' },
  { id: '1wJCNXW_R9ie4ygopj4BluLc_m5-WSqQvt28uE4Jbz04',   // AMOO장난감정리함
    defaultProduct: 'Amoo 장난감 정리함 바구니', tabs: 'ALL' }
];

var SETTLE_DAYS = 14;        // 공구종료일 + N일 = 정산예정일

// ── 2. 상품 · 기본 정산비율 · 스룩 짧은이름 ────────────────────
//  노션 「스룩페이 상품 조건표」 2026-09-18 기준 셀러수수료.
//  짧은이름은 스룩 상품명을 「셀러명x짧은이름」 으로 만들 때 쓴다.
//  셀러별로 비율이 다르면(대행사 21% 등) 「요율표」에 셀러명을 적어 예외로 넣는다.
var PRODUCTS = [
  ['Amoo 보냉가방',                        0.15, '아무 보냉가방'],
  ['Amoo 식탁의자 방석',                    0.15, '아무 방석'],
  ['Amoo 장난감 정리함 바구니',              0.15, '아무 정리함'],
  ['Amoo 책차트 · 전면책장 · 학습 포스터차트', 0.15, '아무 책차트'],
  ['Amoo 킥보드가방',                      0.15, '아무 킥보드가방'],
  ['아이누오 모음전',                       0.10, '아이누오'],
  ['포렉스 발건강 소품',                     0.15, '포렉스 소품'],
  ['포렉스 성인 아치서포트 깔창',             0.15, '포렉스 성인깔창'],
  ['포렉스 키즈 깔창',                      0.15, '포렉스 키즈깔창'],
  ['아푸푸하우스 규조토 발매트',              0.16, '아푸푸 발매트'],
  ['아푸푸하우스 룸슈즈',                    0.16, '아푸푸 룸슈즈'],
  ['또또맘 인기 간식 모음전',                0.13, '또또맘'],
  ['리라그루브 연필/색연필',                 0.09, '리라'],
  ['엄마랑아기랑 세제 모음전',               0.15, '엄마랑아기랑']
];

var SELLER_TYPES = ['개인', '일반과세자', '간이과세자', '면세사업자'];
var STAGES       = ['매출확정', '증빙완료', '지급완료', '신고완료'];

// ── 3. 셀러명 괄호에서 상품 알아내기 ───────────────────────────
//  ⚠ 위에서부터 먼저 걸리는 것이 이긴다 — '자전거 바구니'와 '정리함 바구니'가
//    둘 다 "바구니" 라서, 킥보드/자전거를 반드시 먼저 둔다.
var PRODUCT_HINTS = [
  { re: /킥보드|자전거|3\s*way|반달/i,             product: 'Amoo 킥보드가방' },
  { re: /전면\s*차트|책\s*차트|포스터|전면\s*책장/, product: 'Amoo 책차트 · 전면책장 · 학습 포스터차트' },
  { re: /보냉|크로스백/,                           product: 'Amoo 보냉가방' },
  { re: /식탁의자|방석|트립트랩/,                   product: 'Amoo 식탁의자 방석' },
  { re: /바구니|정리함/,                           product: 'Amoo 장난감 정리함 바구니' },
  { re: /발매트|규조토/,                           product: '아푸푸하우스 규조토 발매트' },
  { re: /룸슈즈|실내화/,                           product: '아푸푸하우스 룸슈즈' },
  { re: /깔창|아치서포트/,                         product: '포렉스 성인 아치서포트 깔창' },
  { re: /연필|색연필|리라/,                        product: '리라그루브 연필/색연필' }
];

var OPTION_WORDS = /베이지|화이트|블랙|멀티|브라운|그레이|그레이지|핑크|네이비|아이보리|크림|차콜/;
var NOTE_WORDS   = /일부|제외|매출|스텝|전\s*라인|락토|예정|김\s*x/i;

// ── 4. 색 ─────────────────────────────────────────────────────
var C_PAID    = '#34a853';   // 지급완료        초록
var C_LATE    = '#ea4335';   // 지급일 지남     빨강
var C_DUE     = '#f9ab00';   // 곧 지급         주황
var C_RUNNING = '#1a73e8';   // 공구중          파랑
var C_READY   = '#a8c7fa';   // 예정            연파랑
var WEEKEND   = '#f1f3f4';
var TODAY_BG  = '#fce8e6';
var HEAD_BG   = '#e8eaed';

// ── 마스터 열 배치 ─────────────────────────────────────────────
//  수식에 열 문자를 직접 쓰므로, 순서를 바꾸면 수식도 같이 고쳐야 한다.
//   A 상품      B 셀러명   C 스룩상품명  D 시작일   E 종료일   F 정산예정일
//   G 샘플      H 총매출   I VAT제외     J 정산비율 K 유형
//   L 소득금액  M 소득세   N 지방소득세  O 부가세   P 최종지급액
//   Q 단계      R 지급일   S 할일        T 긴급     U 비고
//   V 연도추정  W 상품확인 X 원본탭      Y 원문
var COL = { 상품:1, 셀러명:2, 스룩상품명:3, 시작일:4, 종료일:5, 정산예정일:6,
            샘플:7, 총매출:8, VAT제외:9, 정산비율:10, 유형:11,
            소득금액:12, 소득세:13, 지방소득세:14, 부가세:15, 최종지급액:16,
            단계:17, 지급일:18, 할일:19, 긴급:20, 비고:21,
            연도추정:22, 상품확인:23, 원본탭:24, 원문:25 };
var COL_LAST = 25;
var M_ROWS   = 600;          // 수식을 미리 깔아둘 행 수

// ════════════════════════════════════════════════════════════════
function onOpen() {
  SpreadsheetApp.getUi().createMenu('벤더운영')
    .addItem('원본 시트에서 다시 불러오기', 'rebuild')
    .addItem('시트 처음 만들기(setup)', 'setup')
    .addToUi();
}

/** 첫 1회 — 시트를 만들고 원본을 불러온다 */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  writeRateTable_(ss);
  writeSellerBook_(ss);
  rebuild();
  ss.toast('시트를 만들었습니다. 「셀러원장」에 셀러 유형부터 채워 주세요.', '완료', 10);
}

/** 원본 일정 시트에서 마스터를 다시 만든다 (손으로 넣은 값은 되살린다) */
function rebuild() {
  var ss   = SpreadsheetApp.getActiveSpreadsheet();
  var keep = carryOver_(ss);
  var rows = [], log = [];

  SOURCES.forEach(function (src) {
    var book;
    try { book = SpreadsheetApp.openById(src.id); }
    catch (e) { log.push('🔴 열 수 없음: ' + src.id + ' — ' + e.message); return; }
    book.getSheets().forEach(function (sh) {
      var tab = sh.getName();
      if (src.tabs !== 'ALL' && src.tabs.indexOf(tab) === -1) return;
      var got = readSheet_(sh, src, tab, log, keep);
      rows = rows.concat(got);
      log.push('· ' + book.getName() + ' / ' + tab + ' → ' + got.length + '건');
    });
  });

  rows.sort(function (a, b) {
    if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
    return a[COL.시작일 - 1] - b[COL.시작일 - 1];
  });

  markOverlaps_(rows, log);
  writeMaster_(ss, rows);
  writeGantt_(ss, rows);
  writeBoss_(ss);
  writeStaff_(ss);

  log.push('');
  log.push('합계 ' + rows.length + '건');
  log.push('⚠ 연도추정 ' + rows.filter(function (r) { return r[COL.연도추정 - 1]; }).length +
           '건 · ⚠ 상품확인 ' + rows.filter(function (r) { return r[COL.상품확인 - 1]; }).length + '건');
  Logger.log(log.join('\n'));
  try { SpreadsheetApp.getUi().alert(log.join('\n')); } catch (e) {}
}

// ── 손으로 넣은 값 보관 (셀러명 + 시작일이 열쇠) ────────────────
function carryOver_(ss) {
  var sh = ss.getSheetByName('마스터'), keep = {};
  if (!sh || sh.getLastRow() < 2) return keep;
  var v = sh.getRange(2, 1, sh.getLastRow() - 1, COL.지급일).getValues();
  v.forEach(function (r) {
    var prod = r[COL.상품 - 1], name = r[COL.셀러명 - 1], st = r[COL.시작일 - 1];
    if (!name || !(st instanceof Date)) return;
    // 상품까지 열쇠에 넣어야 상품분할된 두 줄이 서로 값을 덮어쓰지 않는다
    keep[prod + '|' + name + '|' + Utilities.formatDate(st, 'Asia/Seoul', 'yyyy-MM-dd')] = {
      sample: r[COL.샘플 - 1] === true,
      sales:  r[COL.총매출 - 1],
      vat:    r[COL.VAT제외 - 1],
      stage:  r[COL.단계 - 1],
      paidAt: r[COL.지급일 - 1]
    };
  });
  return keep;
}

// ── 원본 시트 1장 읽기 ─────────────────────────────────────────
function readSheet_(sh, src, tab, log, keep) {
  var lastRow = sh.getLastRow();
  if (lastRow < 1) return [];

  var probe = sh.getRange(1, 1, Math.min(lastRow, 10), 3).getDisplayValues();
  var headRow = -1;
  for (var i = 0; i < probe.length; i++) {
    if (String(probe[i][0]).indexOf('시작') === 0) { headRow = i + 1; break; }
  }
  var first = headRow === -1 ? 1 : headRow + 1;
  if (headRow === -1) log.push('  (헤더 없음 → 1행부터 데이터: ' + tab + ')');

  var n = lastRow - first + 1;
  if (n < 1) return [];

  var vals = sh.getRange(first, 1, n, 3).getDisplayValues();
  var bgs  = sh.getRange(first, 3, n, 1).getBackgrounds();
  var out = [], yearHint = null;

  for (var r = 0; r < n; r++) {
    var rawS = vals[r][0], rawE = vals[r][1], rawN = vals[r][2];
    if (!String(rawN).trim() && !String(rawS).trim()) continue;

    var pe = parseDate_(rawE, yearHint);
    var ps = parseDate_(rawS, pe ? pe.d.getFullYear() : yearHint);
    if (ps && pe && ps.d > pe.d) {                    // 12/29 → 2026.1.1 연말 걸침
      if (ps.guessed)      ps.d.setFullYear(ps.d.getFullYear() - 1);
      else if (pe.guessed) pe.d.setFullYear(pe.d.getFullYear() + 1);
    }
    if (ps && !pe) pe = { d: new Date(ps.d), guessed: true };
    if (!ps && pe) ps = { d: new Date(pe.d), guessed: true };
    if (!ps) {
      log.push('  ⚠ 날짜 못 읽음 → 건너뜀: [' + tab + '] ' + rawS + ' / ' + rawE + ' / ' + rawN);
      continue;
    }
    yearHint = ps.d.getFullYear();

    var raw    = String(rawN).trim();
    var p      = splitName_(raw);
    var pr     = pickProduct_(raw, src.defaultProduct);
    var shaded = isShaded_(bgs[r][0]) || /샘플\s*완료/.test(raw);
    var day    = Utilities.formatDate(ps.d, 'Asia/Seoul', 'yyyy-MM-dd');

    // 상품이 여럿이면 상품마다 한 줄. 매출·정산도 상품별로 따로 잡힌다.
    pr.products.forEach(function (prod, idx) {
      var k = keep[prod + '|' + p.name + '|' + day] || {};
      var row = new Array(COL_LAST).fill('');
      row[COL.상품 - 1]     = prod;
      row[COL.셀러명 - 1]   = p.name;
      // C 스룩상품명 · F 정산예정일 · J~P 계산 · S 할일 · T 긴급 은 수식이라 비워 둔다
      row[COL.시작일 - 1]   = ps.d;
      row[COL.종료일 - 1]   = pe.d;
      row[COL.샘플 - 1]     = shaded || k.sample === true;
      row[COL.총매출 - 1]   = (k.sales === 0 || k.sales) ? k.sales : '';
      row[COL.VAT제외 - 1]  = k.vat === false ? false : true;      // 기본 켬
      row[COL.단계 - 1]     = k.stage || '';
      row[COL.지급일 - 1]   = k.paidAt || '';
      row[COL.비고 - 1]     = [p.note, p.round,
                              pr.products.length > 1
                                ? '상품분할 ' + (idx + 1) + '/' + pr.products.length : '']
                              .filter(String).join(' / ');
      row[COL.연도추정 - 1] = (ps.guessed || pe.guessed) ? '⚠ 연도추정' : '';
      row[COL.상품확인 - 1] = pr.uncertain ? '⚠ 상품확인' : '';
      row[COL.원본탭 - 1]   = tab;
      row[COL.원문 - 1]     = raw;
      out.push(row);
    });
  }
  return out;
}

// ── 같은 셀러가 같은 상품을 겹쳐 돈 경우만 표시 ────────────────
//  스룩 상품명을 「셀러명x상품」 으로 등록하면 셀러가 다르면 상품명도 달라 안 섞인다.
//  같은 셀러·같은 상품이 기간까지 겹치면 그건 상품명이 같아져 자동으로 못 가른다.
function markOverlaps_(rows, log) {
  var n = 0;
  for (var i = 0; i < rows.length; i++) {
    for (var j = i + 1; j < rows.length; j++) {
      if (rows[i][COL.상품 - 1]   !== rows[j][COL.상품 - 1])   continue;
      if (rows[i][COL.셀러명 - 1] !== rows[j][COL.셀러명 - 1]) continue;
      if (rows[i][COL.종료일 - 1] < rows[j][COL.시작일 - 1] ||
          rows[j][COL.종료일 - 1] < rows[i][COL.시작일 - 1]) continue;
      [i, j].forEach(function (x) {
        if (String(rows[x][COL.상품확인 - 1]).indexOf('매출수동배분') === -1) {
          rows[x][COL.상품확인 - 1] =
            (rows[x][COL.상품확인 - 1] ? rows[x][COL.상품확인 - 1] + ' / ' : '') + '⚠ 매출수동배분';
        }
      });
      n++;
    }
  }
  if (n) log.push('⚠ 같은 셀러·같은 상품 기간 겹침 ' + n + '쌍 — 스룩 상품명이 같아져 수동 배분 필요');
}

// ── 날짜 파싱 ──────────────────────────────────────────────────
//  2025-11-03 / 2025. 12. 8 / 2025/11/3 / 26/1/13 / 12/4 / 3/13
//  연도가 없으면 yearHint 로 채우고 guessed=true 로 표시한다 (추측을 감추지 않는다).
function parseDate_(v, yearHint) {
  var s = String(v == null ? '' : v).replace(/\s+/g, '').replace(/\.$/, '');
  if (!s) return null;
  var m;
  m = s.match(/^(\d{4})[-.\/](\d{1,2})[-.\/](\d{1,2})$/);
  if (m) return { d: new Date(+m[1], +m[2] - 1, +m[3]), guessed: false };
  m = s.match(/^(\d{2})[-.\/](\d{1,2})[-.\/](\d{1,2})$/);
  if (m) return { d: new Date(2000 + +m[1], +m[2] - 1, +m[3]), guessed: false };
  m = s.match(/^(\d{1,2})[-.\/](\d{1,2})$/);
  if (m && yearHint) {
    var mo = +m[1], dy = +m[2];
    if (mo >= 1 && mo <= 12 && dy >= 1 && dy <= 31) {
      return { d: new Date(yearHint, mo - 1, dy), guessed: true };
    }
  }
  return null;
}

// ── 상품 고르기 ────────────────────────────────────────────────
//  상품 힌트가 둘 이상 걸리면("오프유(킥보드가방+원형바구니)") 상품이 2개인 공구다.
//  하나로 뭉개지 않고 **상품마다 한 줄씩** 만든다 (사장님 지시 2026-09-18).
//  스룩 상품명도 「오프유x아무 킥보드가방」·「오프유x아무 정리함」 으로 갈리므로
//  매출도 각각 따로 잡힌다.
function pickProduct_(raw, fallback) {
  var hit = [];
  PRODUCT_HINTS.forEach(function (h) {
    if (h.re.test(raw) && hit.indexOf(h.product) === -1) hit.push(h.product);
  });
  if (hit.length) return { products: hit, uncertain: false };
  var m = raw.match(/[(\[（]([^)\]）]+)[)\]）]/);
  return { products: [fallback],
           uncertain: !!m && !OPTION_WORDS.test(m[1]) && !NOTE_WORDS.test(m[1]) };
}

// ── 셀러명 쪼개기 ──────────────────────────────────────────────
function splitName_(raw) {
  var s = raw, round = '', notes = [];
  s = s.replace(/샘플\s*완료/g, ' ');
  var rm = s.match(/(\d+\s*차|n\s*차)/i);
  if (rm) { round = rm[1].replace(/\s/g, ''); s = s.replace(rm[1], ' '); }
  s = s.replace(/[(\[（]([^)\]）]*)[)\]）]/g, function (_, inner) {
    if (inner.trim()) notes.push(inner.trim());
    return ' ';
  });
  var parts = s.split(/\s*[-–]\s*/);
  if (parts.length > 1) {
    s = parts.shift();
    parts.forEach(function (t) { if (t.trim()) notes.push(t.trim()); });
  }
  return { name: s.replace(/\s+/g, ' ').trim(), note: notes.join(' / '), round: round };
}

function isShaded_(bg) {
  var b = String(bg || '').toLowerCase();
  return b !== '' && b !== '#ffffff' && b !== 'white';
}

// ════════════════════════════════════════════════════════════════
//  요율표 — 상품 기본 비율 + 짧은이름 + 셀러별 예외
// ════════════════════════════════════════════════════════════════
function writeRateTable_(ss) {
  var sh = ss.getSheetByName('요율표') || ss.insertSheet('요율표');
  if (sh.getLastRow() > 1) return;              // 이미 채워져 있으면 건드리지 않는다
  sh.clear();
  sh.getRange(1, 1, 1, 5)
    .setValues([['상품', '셀러명(비우면 그 상품 전체)', '정산비율', '열쇠', '스룩 짧은이름']])
    .setFontWeight('bold').setBackground(HEAD_BG);

  var rows = PRODUCTS.map(function (p) { return [p[0], '', p[1]]; });
  sh.getRange(2, 1, rows.length, 3).setValues(rows);
  sh.getRange(2, 5, rows.length, 1)
    .setValues(PRODUCTS.map(function (p) { return [p[2]]; }));
  sh.getRange(2, 3, 400, 1).setNumberFormat('0.00%');
  sh.getRange(2, 4, 400, 1).setFormula('=IF($A2="","",$A2&"|"&$B2)');
  sh.getRange(2, 1, 400, 1).setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInList(PRODUCTS.map(function (p) { return p[0]; }), true)
      .setAllowInvalid(true).build());
  sh.setFrozenRows(1);
  [260, 210, 90, 280, 150].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.getRange(1, 7).setValue(
    '셀러별로 비율이 다르면 아래에 줄을 더한다.  예) 또또맘 인기 간식 모음전 / 이현찰퐁맘 / 21%\n' +
    '셀러명이 적힌 줄이 그 상품 기본값을 이긴다.  「스룩 짧은이름」은 셀러명이 빈 줄의 값만 쓴다.')
    .setFontColor('#666');
}

// ════════════════════════════════════════════════════════════════
//  셀러원장 — 유형·계좌. 🔴 주민번호·계좌 전체는 여기 넣지 않는다
// ════════════════════════════════════════════════════════════════
function writeSellerBook_(ss) {
  var sh = ss.getSheetByName('셀러원장') || ss.insertSheet('셀러원장');
  if (sh.getLastRow() > 1) return;
  sh.clear();
  var HEAD = ['셀러명', '유형', '은행', '계좌 끝4자리', '정산정보 접수', '담당', '비고'];
  sh.getRange(1, 1, 1, HEAD.length).setValues([HEAD]).setFontWeight('bold').setBackground(HEAD_BG);
  sh.getRange(2, 2, 500, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(SELLER_TYPES, true)
      .setAllowInvalid(false).build());
  sh.getRange(2, 5, 500, 1).insertCheckboxes();
  sh.setFrozenRows(1);
  [150, 110, 90, 110, 110, 90, 240].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.getRange(1, 9).setValue(
    '🔴 주민등록번호·계좌번호 전체는 여기에 적지 않는다. 그건 sellerdesk(암호화)에만 둔다.\n' +
    '   여기엔 유형과 끝 4자리까지만 — 이체할 때 맞는 계좌인지 확인하는 용도.')
    .setFontColor('#c5221f').setFontWeight('bold');
}

// ════════════════════════════════════════════════════════════════
//  마스터 — 공구 1건 = 한 줄
// ════════════════════════════════════════════════════════════════
function writeMaster_(ss, rows) {
  var sh = ss.getSheetByName('마스터') || ss.insertSheet('마스터', 0);
  sh.clear();
  sh.clearConditionalFormatRules();
  if (sh.getMaxRows() < M_ROWS + 1) sh.insertRowsAfter(sh.getMaxRows(), M_ROWS + 1 - sh.getMaxRows());
  if (sh.getMaxColumns() < COL_LAST) sh.insertColumnsAfter(sh.getMaxColumns(), COL_LAST - sh.getMaxColumns());

  var HEAD = ['상품', '셀러명', '스룩 상품명(이걸로 등록)', '시작일', '종료일', '정산예정일',
              '샘플', '총매출', 'VAT제외', '정산비율', '유형',
              '소득금액', '소득세', '지방소득세', '부가세', '최종지급액',
              '단계', '지급일', '할 일', '긴급', '비고',
              '연도추정', '상품확인', '원본탭', '원문'];
  sh.getRange(1, 1, 1, COL_LAST).setValues([HEAD])
    .setFontWeight('bold').setBackground(HEAD_BG).setHorizontalAlignment('center').setWrap(true);

  if (rows.length) sh.getRange(2, 1, rows.length, COL_LAST).setValues(rows);
  var n = M_ROWS;

  // ── 수식 ──
  //  C 스룩상품명 = 셀러명 x 짧은이름  (예: 맘캘린더x또또맘)
  sh.getRange(2, COL.스룩상품명, n, 1).setFormula(
    '=IF(OR($A2="",$B2=""),"",$B2&"x"&IFERROR(INDEX(요율표!$E:$E,MATCH($A2&"|",요율표!$D:$D,0)),$A2))');

  sh.getRange(2, COL.정산예정일, n, 1).setFormula(
    '=IF($E2="","",$E2+' + SETTLE_DAYS + ')');

  //  요율표에서 "상품|셀러" 를 먼저 찾고, 없으면 "상품|" (그 상품 기본값)
  sh.getRange(2, COL.정산비율, n, 1).setFormula(
    '=IF($A2="","",IFERROR(INDEX(요율표!$C:$C,MATCH($A2&"|"&$B2,요율표!$D:$D,0)),' +
    'IFERROR(INDEX(요율표!$C:$C,MATCH($A2&"|",요율표!$D:$D,0)),"")))');

  sh.getRange(2, COL.유형, n, 1).setFormula(
    '=IF($B2="","",IFERROR(VLOOKUP($B2,셀러원장!$A:$B,2,FALSE),"⚠미등록"))');

  //  소득금액 = 내림10원( (VAT제외면 총매출÷1.1) × 정산비율 )
  sh.getRange(2, COL.소득금액, n, 1).setFormula(
    '=IF(OR($H2="",$J2=""),"",FLOOR(IF($I2=TRUE,$H2/1.1,$H2)*$J2,10))');
  sh.getRange(2, COL.소득세, n, 1).setFormula(
    '=IF($L2="","",IF($K2="개인",FLOOR($L2*0.03,10),0))');
  sh.getRange(2, COL.지방소득세, n, 1).setFormula(
    '=IF($L2="","",IF($K2="개인",FLOOR($L2*0.003,10),0))');
  sh.getRange(2, COL.부가세, n, 1).setFormula(
    '=IF($L2="","",IF($K2="일반과세자",ROUND($L2*0.1),0))');
  sh.getRange(2, COL.최종지급액, n, 1).setFormula(
    '=IF($L2="","",$L2-$M2-$N2+$O2)');

  //  S 할 일 — 직원이 지금 무엇을 해야 하는지 한 줄로
  sh.getRange(2, COL.할일, n, 1).setFormula(
    '=IF($D2="","",' +
    'IF($Q2="신고완료","",' +
    'IF($K2="⚠미등록","① 셀러원장에 \'"&$B2&"\' 유형·계좌 등록",' +
    'IF($E2>TODAY(),IF($G2=TRUE,"","① 샘플 발송 ("&TEXT($D2,"m/d")&" 오픈)"),' +
    'IF($H2="","② 스룩 매출 입력  검색어: "&$C2,' +
    'IF($Q2="","③ 매출 확정 확인 (취소·반품 반영)",' +
    'IF(AND($K2="일반과세자",$Q2="매출확정"),"④ 세금계산서 받기",' +
    'IF($Q2<>"지급완료","⑤ "&TEXT($F2,"m/d")&" 지급  "&TEXT($P2,"#,##0")&"원",' +
    'IF($K2="개인","⑥ 원천세 신고 ("&TEXT(EOMONTH($R2,0)+10,"m/d")&"까지)","⑥ 신고완료 체크")' +
    '))))))))');

  //  T 긴급 — 대표·직원 화면 정렬의 기준
  sh.getRange(2, COL.긴급, n, 1).setFormula(
    '=IF($S2="","",' +
    'IF(AND($Q2<>"지급완료",$Q2<>"신고완료",$F2<>"",$F2<TODAY()),"🔴 지연",' +
    'IF(AND($Q2<>"지급완료",$Q2<>"신고완료",$F2<>"",$F2<=TODAY()+7),"🟠 이번주",' +
    'IF(AND($E2<TODAY(),$H2=""),"🟠 매출입력",""))))');

  // ── 서식 ──
  sh.getRange(2, COL.시작일, n, 3).setNumberFormat('yyyy-mm-dd');
  sh.getRange(2, COL.지급일, n, 1).setNumberFormat('yyyy-mm-dd');
  sh.getRange(2, COL.정산비율, n, 1).setNumberFormat('0.00%');
  sh.getRange(2, COL.총매출, n, 1).setNumberFormat('#,##0');
  sh.getRange(2, COL.소득금액, n, 5).setNumberFormat('#,##0');
  sh.getRange(2, COL.샘플, n, 1).insertCheckboxes();
  sh.getRange(2, COL.VAT제외, n, 1).insertCheckboxes();

  sh.getRange(2, COL.상품, n, 1).setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInList(PRODUCTS.map(function (p) { return p[0]; }), true)
      .setAllowInvalid(true).build());
  sh.getRange(2, COL.단계, n, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(STAGES, true)
      .setAllowInvalid(false).build());

  sh.setFrozenRows(1);
  sh.setFrozenColumns(3);
  [190, 120, 210, 90, 90, 96, 50, 105, 66, 78, 88,
   100, 84, 92, 84, 108, 92, 92, 250, 84, 140, 82, 150, 100, 190]
    .forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });

  var all = sh.getRange(2, 1, n, COL_LAST);
  sh.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule()          // 지연 — 줄 전체를 빨갛게
      .whenFormulaSatisfied('=$T2="🔴 지연"')
      .setBackground('#fce8e6').setRanges([all]).build(),
    SpreadsheetApp.newConditionalFormatRule()          // 확인 필요
      .whenFormulaSatisfied('=OR($V2<>"",$W2<>"")')
      .setBackground('#fff3cd').setRanges([all]).build(),
    SpreadsheetApp.newConditionalFormatRule()          // 지급완료
      .whenFormulaSatisfied('=OR($Q2="지급완료",$Q2="신고완료")')
      .setBackground('#e6f4ea').setRanges([all]).build()
  ]);
}

// ════════════════════════════════════════════════════════════════
//  간트 — 일정 그림
// ════════════════════════════════════════════════════════════════
function writeGantt_(ss, rows) {
  var sh = ss.getSheetByName('간트') || ss.insertSheet('간트', 1);
  sh.clear();
  sh.clearConditionalFormatRules();
  if (!rows.length) return;

  var min = rows[0][COL.시작일 - 1], max = rows[0][COL.종료일 - 1];
  rows.forEach(function (r) {
    if (r[COL.시작일 - 1] < min) min = r[COL.시작일 - 1];
    if (r[COL.종료일 - 1] > max) max = r[COL.종료일 - 1];
  });
  min = new Date(min.getFullYear(), min.getMonth(), 1);
  max = new Date(max.getFullYear(), max.getMonth() + 1, 0);
  max.setDate(max.getDate() + SETTLE_DAYS);          // 정산예정일까지 보이게
  var span = Math.round((max - min) / 86400000) + 1;

  var LEFT = 7;   // 상품 셀러 시작 종료 정산예정 단계 지급액
  if (sh.getMaxColumns() < LEFT + span) {
    sh.insertColumnsAfter(sh.getMaxColumns(), LEFT + span - sh.getMaxColumns());
  }
  var body = rows.length + 60;
  if (sh.getMaxRows() < body + 2) sh.insertRowsAfter(sh.getMaxRows(), body + 2 - sh.getMaxRows());

  sh.getRange(2, 1, 1, LEFT)
    .setValues([['상품', '셀러명', '시작일', '종료일', '정산예정일', '단계', '지급액']])
    .setFontWeight('bold').setBackground(HEAD_BG);

  var months = [], days = [], d = new Date(min);
  for (var i = 0; i < span; i++) {
    months.push(d.getDate() === 1 ? Utilities.formatDate(d, 'Asia/Seoul', "yy'.'M") : '');
    days.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  sh.getRange(1, LEFT + 1, 1, span).setValues([months])
    .setFontWeight('bold').setFontSize(8).setHorizontalAlignment('left');
  sh.getRange(2, LEFT + 1, 1, span).setValues([days])
    .setNumberFormat('d').setFontSize(7).setHorizontalAlignment('center').setBackground('#f8f9fa');

  //  마스터 A,B,D,E,F,Q,P → 상품·셀러·시작·종료·정산예정·단계·지급액
  sh.getRange(3, 1).setFormula(
    '=IFERROR(QUERY(마스터!A2:R,"select A,B,D,E,F,Q,P where D is not null order by A, D",0),"")');
  sh.getRange(3, 3, body, 3).setNumberFormat('yyyy-mm-dd');
  sh.getRange(3, 7, body, 1).setNumberFormat('#,##0');

  [190, 120, 90, 90, 96, 84, 100].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.setColumnWidths(LEFT + 1, span, 22);
  sh.setFrozenRows(2);
  sh.setFrozenColumns(LEFT);

  var area  = sh.getRange(3, LEFT + 1, body, span);
  var IN    = '$C3<>"", H$2>=$C3, H$2<=$D3';          // 공구 기간 안
  var rules = [];
  function bar(cond, color) {
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=AND(' + cond + ')')
      .setBackground(color).setFontColor(color).setRanges([area]).build());
  }

  // 정산예정일 한 칸 — 돈 나가는 날을 공구 바와 따로 찍는다
  bar('$E3<>"", H$2=$E3, OR($F3="지급완료",$F3="신고완료")', C_PAID);
  bar('$E3<>"", H$2=$E3, $E3<TODAY()',                      C_LATE);
  bar('$E3<>"", H$2=$E3',                                   C_DUE);
  // 공구 바
  bar(IN + ', OR($F3="지급완료",$F3="신고완료")',            C_PAID);
  bar(IN + ', $C3<=TODAY(), $D3>=TODAY()',                  C_RUNNING);
  bar(IN + ', $C3>TODAY()',                                 C_READY);
  bar(IN,                                                   C_RUNNING);

  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=H$2=TODAY()').setBackground(TODAY_BG).setRanges([area]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=WEEKDAY(H$2,2)>5').setBackground(WEEKEND).setRanges([area]).build());
  sh.setConditionalFormatRules(rules);

  sh.getRange(1, 1, 1, 5)
    .setValues([['■ 지급완료', '■ 미지급·지남', '■ 공구중', '■ 예정', '▮ 정산예정일(D+14)']])
    .setFontSize(9);
  [C_PAID, C_LATE, C_RUNNING, C_READY, C_DUE]
    .forEach(function (c, i) { sh.getRange(1, i + 1).setFontColor(c).setFontWeight('bold'); });
}

// ════════════════════════════════════════════════════════════════
//  대표 화면 — 오늘 누구한테 얼마
// ════════════════════════════════════════════════════════════════
function writeBoss_(ss) {
  var sh = ss.getSheetByName('대표') || ss.insertSheet('대표', 2);
  sh.clear();
  sh.clearConditionalFormatRules();

  sh.getRange(1, 1).setValue('오늘 기준 정산 현황').setFontSize(16).setFontWeight('bold');
  sh.getRange(1, 4).setFormula('=TEXT(TODAY(),"yyyy년 m월 d일 (aaa)")')
    .setFontSize(12).setFontColor('#666');

  //  ── 요약 4칸 ── (T=긴급, P=최종지급액, Q=단계)
  var cards = [
    ['🔴 지급 지연',   '=IFERROR(COUNTIF(마스터!$T:$T,"🔴 지연"),0)',
                      '=IFERROR(SUMIF(마스터!$T:$T,"🔴 지연",마스터!$P:$P),0)'],
    ['🟠 이번주 지급', '=IFERROR(COUNTIF(마스터!$T:$T,"🟠 이번주"),0)',
                      '=IFERROR(SUMIF(마스터!$T:$T,"🟠 이번주",마스터!$P:$P),0)'],
    ['미지급 전체',    '=IFERROR(COUNTIFS(마스터!$P:$P,">0",마스터!$Q:$Q,"<>지급완료",마스터!$Q:$Q,"<>신고완료"),0)',
                      '=IFERROR(SUMIFS(마스터!$P:$P,마스터!$P:$P,">0",마스터!$Q:$Q,"<>지급완료",마스터!$Q:$Q,"<>신고완료"),0)'],
    ['매출 입력 대기', '=IFERROR(COUNTIF(마스터!$T:$T,"🟠 매출입력"),0)', '']
  ];
  cards.forEach(function (c, i) {
    var col = 1 + i * 3;
    sh.getRange(3, col).setValue(c[0]).setFontWeight('bold').setFontSize(11);
    sh.getRange(4, col).setFormula(c[1]).setNumberFormat('0"건"').setFontSize(22).setFontWeight('bold');
    if (c[2]) sh.getRange(5, col).setFormula(c[2]).setNumberFormat('₩#,##0').setFontSize(12);
  });
  sh.getRange(4, 1).setFontColor(C_LATE);
  sh.getRange(4, 4).setFontColor(C_DUE);

  //  ── 지금 줘야 할 돈 ──
  sh.getRange(7, 1).setValue('▍지금 줘야 할 돈  (지연 + 앞으로 7일)').setFontSize(13).setFontWeight('bold');
  sh.getRange(8, 1, 1, 7)
    .setValues([['긴급', '정산예정일', '셀러명', '유형', '상품', '지급액', '계좌 끝4']])
    .setFontWeight('bold').setBackground(HEAD_BG);
  sh.getRange(9, 1).setFormula(
    '=IFERROR(SORT(FILTER({마스터!$T$2:$T,마스터!$F$2:$F,마스터!$B$2:$B,마스터!$K$2:$K,' +
    '마스터!$A$2:$A,마스터!$P$2:$P,' +
    'IFERROR(ARRAYFORMULA(VLOOKUP(마스터!$B$2:$B,셀러원장!$A:$D,4,FALSE)),"")},' +
    '(마스터!$T$2:$T="🔴 지연")+(마스터!$T$2:$T="🟠 이번주")),2,TRUE),"없음")');
  sh.getRange(9, 2, 200, 1).setNumberFormat('yyyy-mm-dd');
  sh.getRange(9, 6, 200, 1).setNumberFormat('₩#,##0');

  //  ── 유형별 (어떻게 줘야 하는지) ── K=유형, P=지급액, Q=단계, M=소득세, N=지방
  sh.getRange(7, 9).setValue('▍유형별 미지급').setFontSize(13).setFontWeight('bold');
  sh.getRange(8, 9, 1, 4).setValues([['유형', '건수', '지급액', '떼는 세금']])
    .setFontWeight('bold').setBackground(HEAD_BG);
  SELLER_TYPES.forEach(function (t, i) {
    var r = 9 + i;
    sh.getRange(r, 9).setValue(t);
    sh.getRange(r, 10).setFormula(
      '=IFERROR(COUNTIFS(마스터!$K:$K,$I' + r + ',마스터!$P:$P,">0",' +
      '마스터!$Q:$Q,"<>지급완료",마스터!$Q:$Q,"<>신고완료"),0)').setNumberFormat('0');
    sh.getRange(r, 11).setFormula(
      '=IFERROR(SUMIFS(마스터!$P:$P,마스터!$K:$K,$I' + r + ',마스터!$P:$P,">0",' +
      '마스터!$Q:$Q,"<>지급완료",마스터!$Q:$Q,"<>신고완료"),0)').setNumberFormat('₩#,##0');
    sh.getRange(r, 12).setFormula(
      '=IFERROR(SUMIFS(마스터!$M:$M,마스터!$K:$K,$I' + r + ',마스터!$P:$P,">0",마스터!$Q:$Q,"<>지급완료")' +
      '+SUMIFS(마스터!$N:$N,마스터!$K:$K,$I' + r + ',마스터!$P:$P,">0",마스터!$Q:$Q,"<>지급완료"),0)')
      .setNumberFormat('₩#,##0');
  });

  sh.getRange(14, 9).setValue('▍이번달 원천세 신고').setFontSize(13).setFontWeight('bold');
  sh.getRange(15, 9).setValue('지난달 지급분 (소득세+지방소득세)');
  sh.getRange(15, 12).setFormula(
    '=IFERROR(SUMIFS(마스터!$M:$M,마스터!$R:$R,">="&EOMONTH(TODAY(),-2)+1,마스터!$R:$R,"<="&EOMONTH(TODAY(),-1))' +
    '+SUMIFS(마스터!$N:$N,마스터!$R:$R,">="&EOMONTH(TODAY(),-2)+1,마스터!$R:$R,"<="&EOMONTH(TODAY(),-1)),0)')
    .setNumberFormat('₩#,##0').setFontWeight('bold');
  sh.getRange(16, 9).setFormula('="신고·납부 기한: "&TEXT(EOMONTH(TODAY(),-1)+10,"m월 d일")')
    .setFontColor('#c5221f').setFontWeight('bold');
  sh.getRange(17, 9).setValue('※ 세무 신고는 세무사 확인 후 진행하세요. 이 숫자는 참고용 합계입니다.')
    .setFontColor('#666').setFontSize(9);

  [80, 100, 130, 96, 190, 110, 90, 24, 200, 60, 110, 110]
    .forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.setHiddenGridlines(true);
}

// ════════════════════════════════════════════════════════════════
//  직원 화면 — 오늘 할 일이 순서대로
// ════════════════════════════════════════════════════════════════
function writeStaff_(ss) {
  var sh = ss.getSheetByName('직원') || ss.insertSheet('직원', 3);
  sh.clear();
  sh.clearConditionalFormatRules();

  sh.getRange(1, 1).setValue('오늘 할 일').setFontSize(16).setFontWeight('bold');
  sh.getRange(1, 3).setFormula('=TEXT(TODAY(),"yyyy년 m월 d일 (aaa)")')
    .setFontSize(12).setFontColor('#666');
  sh.getRange(2, 1).setValue(
    '고치는 곳은 「마스터」입니다. 여기는 보기만 하는 화면이라 여기서 고쳐도 저장되지 않습니다.')
    .setFontColor('#666').setFontSize(10);

  sh.getRange(4, 1, 1, 7)
    .setValues([['긴급', '할 일', '셀러명', '상품', '공구기간', '정산예정일', '지급액']])
    .setFontWeight('bold').setBackground(HEAD_BG);
  //  T=긴급 S=할일 B=셀러 A=상품 D~E=기간 F=정산예정 P=지급액
  sh.getRange(5, 1).setFormula(
    '=IFERROR(SORT(FILTER({마스터!$T$2:$T,마스터!$S$2:$S,마스터!$B$2:$B,마스터!$A$2:$A,' +
    'IFERROR(ARRAYFORMULA(IF(마스터!$D$2:$D="","",TEXT(마스터!$D$2:$D,"m/d")&"~"&TEXT(마스터!$E$2:$E,"m/d"))),""),' +
    '마스터!$F$2:$F,마스터!$P$2:$P},' +
    '마스터!$S$2:$S<>""),1,FALSE,6,TRUE),"할 일이 없습니다")');
  sh.getRange(5, 6, 300, 1).setNumberFormat('yyyy-mm-dd');
  sh.getRange(5, 7, 300, 1).setNumberFormat('₩#,##0');

  var area = sh.getRange(5, 1, 300, 7);
  sh.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$A5="🔴 지연"')
      .setBackground('#fce8e6').setRanges([area]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=LEFT($A5,1)="🟠"')
      .setBackground('#fef7e0').setRanges([area]).build()
  ]);

  // ── 일 처리 순서 (직원이 헷갈릴 때 보는 곳) ──
  var GUIDE = [
    ['단계', '무엇을', '어디서'],
    ['⓪ 상품 등록',
     '공구가 잡히면 스룩페이에 그 셀러 전용 상품을 만든다.\n상품명은 마스터 C열에 나온 「셀러명x상품」 그대로. 그 링크를 셀러에게 준다.\n이렇게 해야 정산 때 상품명만 보고 셀러가 갈린다.',
     'srookpay.com 상품관리'],
    ['① 샘플 발송', '공구 오픈 전에 샘플을 보내고 마스터 「샘플」 체크', '마스터 G열'],
    ['② 매출 입력',
     '공구 종료 후 스룩페이 주문검색에서 상품명(마스터 C열)과 기간으로 검색해\n매출 합계를 「총매출」에 입력',
     'srookpay.com/newsrp/Order/deal01'],
    ['③ 매출 확정', '취소·반품이 빠진 최종 매출인지 확인하고 단계를 「매출확정」으로', '마스터 Q열'],
    ['④ 증빙',
     '일반과세자 셀러면 세금계산서를 받는다(부가세 10% 더해 지급).\n개인이면 원천징수라 받을 서류 없음. 되면 단계를 「증빙완료」로',
     '마스터 Q열'],
    ['⑤ 지급',
     '정산예정일(공구종료+14일)에 「최종지급액」을 이체.\n계좌는 sellerdesk 에서 확인한다.\n이체 후 단계 「지급완료」 + 「지급일」 입력',
     'sellerdesk.html'],
    ['⑥ 신고',
     '개인 셀러에게서 뗀 소득세·지방소득세는 지급한 달의 다음달 10일까지 신고.\n「대표」 화면 우측 합계를 세무사에게 넘긴다',
     '대표 화면 우측'],
    ['', '', ''],
    ['⚠ 미등록', '셀러원장에 없는 셀러. 유형(개인/일반/간이)을 모르면 정산액이 아예 안 나온다', '셀러원장'],
    ['⚠ 상품확인', '원본 셀러명 괄호에 상품이 둘 들어 있던 건. 어느 상품인지 갈라 준다', '마스터 W열'],
    ['⚠ 연도추정', '원본에 연도 없이 "3/13" 처럼 적혀 있어 연도를 추측한 건. 맞는지 확인', '마스터 V열'],
    ['⚠ 매출수동배분', '같은 셀러가 같은 상품을 기간 겹쳐 돈 건. 상품명이 같아져 자동으로 못 가른다', '마스터 W열']
  ];
  sh.getRange(4, 9).setValue('▍일 처리 순서').setFontSize(13).setFontWeight('bold');
  sh.getRange(5, 9, GUIDE.length, 3).setValues(GUIDE).setWrap(true).setVerticalAlignment('top');
  sh.getRange(5, 9, 1, 3).setFontWeight('bold').setBackground(HEAD_BG);
  sh.getRange(14, 9, 4, 1).setFontColor('#c5221f').setFontWeight('bold');

  [80, 250, 120, 190, 110, 100, 100, 24, 130, 420, 250]
    .forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.setFrozenRows(4);
  sh.setHiddenGridlines(true);
}
