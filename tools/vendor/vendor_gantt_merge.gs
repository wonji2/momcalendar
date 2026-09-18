/**
 * ────────────────────────────────────────────────────────────────
 *  벤더 공구일정 통합 간트 (Google Apps Script)
 * ────────────────────────────────────────────────────────────────
 *  무엇을  : 상품별로 흩어진 구글시트를 읽어 한 파일에 합친다.
 *  보는 것 : 셀러명 · 일정 · 상품 · 샘플 유무 · 정산 유무  (사장님 지시 2026-09-18)
 *  흐름    : 원본 시트 → 「마스터」(세로 정규화) → 「간트」(조건부서식 자동 색칠)
 *
 *  실행법  : 새 스프레드시트 → 확장 프로그램 > Apps Script
 *            → 이 파일 전체 붙여넣기 → 저장 → buildAll() 실행
 *            → 첫 실행 때 권한 승인 1번 (원본 파일 읽기)
 *
 *  ⚠ buildAll() 은 「마스터」를 통째로 다시 씁니다.
 *    손으로 채운 샘플·정산 체크는 셀러명+시작일을 열쇠로 되살립니다(carryOver_).
 *    그래도 다시 돌리기 전에 사본을 떠 두시는 게 안전합니다.
 *
 *  상품 원장 : 노션 「스룩페이 상품 조건표」 (여기 PRODUCTS 는 그 사본)
 *              https://app.notion.com/p/ab6f7c8556fa47cd8488caaedf495256
 *  주기    : 수동. 원본을 고친 뒤 buildAll() 을 다시 누른다.
 *  안전    : 원본 파일은 읽기만 한다. 쓰기는 이 파일의 두 시트뿐.
 * ────────────────────────────────────────────────────────────────
 */

// ── 1. 원본 파일 ───────────────────────────────────────────────
//  파오리는 지금 취급하지 않아 뺐다 (2026-09-18). 다시 하게 되면 여기 한 줄 추가.
var SOURCES = [
  { id: '19-6tmvPDqC4BvPeqEBugJZC0PCFPoY4jKwLMPXC4EGQ',   // 또또맘_11월
    defaultProduct: '또또맘 인기 간식 모음전', tabs: 'ALL' },

  { id: '1wJCNXW_R9ie4ygopj4BluLc_m5-WSqQvt28uE4Jbz04',   // AMOO장난감정리함
    defaultProduct: 'Amoo 장난감 정리함 바구니', tabs: 'ALL' }
];

// ── 2. 상품 목록 (드롭다운) ────────────────────────────────────
//  노션 「스룩페이 상품 조건표」 2026-09-18 기준.
//  [지워도 됨 · 아이누오 모음전으로 통합] 6건은 뺐다.
var PRODUCTS = [
  'Amoo 보냉가방',
  'Amoo 식탁의자 방석',
  'Amoo 장난감 정리함 바구니',
  'Amoo 책차트 · 전면책장 · 학습 포스터차트',
  'Amoo 킥보드가방',
  '아이누오 모음전',
  '포렉스 발건강 소품',
  '포렉스 성인 아치서포트 깔창',
  '포렉스 키즈 깔창',
  '아푸푸하우스 규조토 발매트',
  '아푸푸하우스 룸슈즈',
  '또또맘 인기 간식 모음전',
  '리라그루브 연필/색연필',
  '엄마랑아기랑 세제 모음전'
];

// ── 3. 셀러명 괄호에서 상품 알아내기 ───────────────────────────
//  "건이맘(킥보드가방)" 처럼 한 파일에 여러 상품이 섞여 있다.
//  ⚠ 위에서부터 먼저 걸리는 것이 이긴다 — '자전거 바구니'와 '정리함 바구니'가
//    둘 다 "바구니" 라서, 킥보드/자전거를 반드시 먼저 둔다.
var PRODUCT_HINTS = [
  { re: /킥보드|자전거|3\s*way|반달/i,            product: 'Amoo 킥보드가방' },
  { re: /전면\s*차트|책\s*차트|포스터|전면\s*책장/, product: 'Amoo 책차트 · 전면책장 · 학습 포스터차트' },
  { re: /보냉|크로스백/,                          product: 'Amoo 보냉가방' },
  { re: /식탁의자|방석|트립트랩/,                  product: 'Amoo 식탁의자 방석' },
  { re: /바구니|정리함/,                          product: 'Amoo 장난감 정리함 바구니' },
  { re: /발매트|규조토/,                          product: '아푸푸하우스 규조토 발매트' },
  { re: /룸슈즈|실내화/,                          product: '아푸푸하우스 룸슈즈' },
  { re: /깔창|아치서포트/,                        product: '포렉스 성인 아치서포트 깔창' },
  { re: /연필|색연필|리라/,                       product: '리라그루브 연필/색연필' }
];

// ── 4. 색 ─────────────────────────────────────────────────────
var C_DONE    = '#34a853';   // 정산완료      초록
var C_UNPAID  = '#ea4335';   // 끝났는데 미정산 빨강  ← 돈 못 받은 것
var C_RUNNING = '#1a73e8';   // 진행중        파랑
var C_READY   = '#a8c7fa';   // 예정 · 샘플 감 연파랑
var C_NOSAMP  = '#f9ab00';   // 예정 · 샘플 아직 주황  ← 챙겨야 할 것
var WEEKEND   = '#f1f3f4';
var TODAY_BG  = '#fce8e6';

// ════════════════════════════════════════════════════════════════
function buildAll() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var keep  = carryOver_(ss);          // 손으로 채운 샘플·정산 체크 보관
  var rows  = [];
  var log   = [];

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
    if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;   // 상품
    return a[2] - b[2];                                // 시작일
  });

  writeMaster_(ss, rows);
  writeGantt_(ss, rows);

  var guessed = rows.filter(function (r) { return r[8]; }).length;
  var needChk = rows.filter(function (r) { return r[9]; }).length;
  log.push('');
  log.push('합계 ' + rows.length + '건');
  log.push('⚠ 연도추정 ' + guessed + '건 · ⚠ 상품확인필요 ' + needChk + '건 (마스터에서 노란 바탕)');
  log.push('정산 칸은 원본에 없던 정보라 전부 비어 있습니다 — 손으로 채워 주세요.');
  Logger.log(log.join('\n'));
  try { SpreadsheetApp.getUi().alert(log.join('\n')); } catch (e) {}
}

// ── 손으로 채운 체크 보관 (셀러명 + 시작일 이 열쇠) ─────────────
function carryOver_(ss) {
  var sh = ss.getSheetByName('마스터');
  var keep = {};
  if (!sh || sh.getLastRow() < 2) return keep;
  var v = sh.getRange(2, 1, sh.getLastRow() - 1, 6).getValues();
  v.forEach(function (r) {
    if (!r[1] || !(r[2] instanceof Date)) return;
    keep[r[1] + '|' + Utilities.formatDate(r[2], 'Asia/Seoul', 'yyyy-MM-dd')] =
      { sample: r[4] === true, paid: r[5] === true };
  });
  return keep;
}

// ── 원본 시트 1장 읽기 ─────────────────────────────────────────
function readSheet_(sh, src, tab, log, keep) {
  var lastRow = sh.getLastRow();
  if (lastRow < 1) return [];

  // 헤더 찾기 — 없는 파일(AMOO)도 있어서 1행부터 데이터로 본다
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
  var bgs  = sh.getRange(first, 3, n, 1).getBackgrounds();   // 셀러명 칸 음영 = 샘플완료

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
      log.push('  ⚠ 날짜 못 읽음 → 건너뜀: [' + tab + '] ' +
               rawS + ' / ' + rawE + ' / ' + rawN);
      continue;
    }
    yearHint = ps.d.getFullYear();

    var raw = String(rawN).trim();
    var p   = splitName_(raw);
    var pr  = pickProduct_(raw, src.defaultProduct);

    // 샘플: 셀 음영 또는 "샘플완료" 글자. 둘 다 없으면 '모름' 이지 '안 보냄' 이 아니다.
    var sample = isShaded_(bgs[r][0]) || /샘플\s*완료/.test(raw);

    var k = keep[p.name + '|' + Utilities.formatDate(ps.d, 'Asia/Seoul', 'yyyy-MM-dd')];
    var paid = k ? k.paid : false;
    if (k && k.sample) sample = true;

    out.push([
      pr.product,                                        // 0 상품
      p.name,                                            // 1 셀러명
      ps.d,                                              // 2 시작일
      pe.d,                                              // 3 종료일
      sample,                                            // 4 샘플 (체크박스)
      paid,                                              // 5 정산 (체크박스)
      [p.note, p.round].filter(String).join(' / '),      // 6 비고
      Math.round((pe.d - ps.d) / 86400000) + 1,          // 7 일수
      (ps.guessed || pe.guessed) ? '⚠ 연도추정' : '',    // 8
      pr.uncertain ? '⚠ 상품확인' : '',                  // 9
      tab,                                               // 10 원본 탭
      raw                                                // 11 원문
    ]);
  }
  return out;
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
//  괄호 안이 상품을 가리키는 경우가 있고(킥보드가방), 색상이나 메모인 경우가 있다(베이지 / 일부만).
//  색상·메모까지 "상품확인" 으로 띄우면 거의 모든 행에 경고가 켜져 경고가 쓸모없어진다.
var OPTION_WORDS = /베이지|화이트|블랙|멀티|브라운|그레이|그레이지|핑크|네이비|아이보리|크림|차콜/;
var NOTE_WORDS   = /일부|제외|매출|스텝|전\s*라인|락토|예정|김\s*x/i;

function pickProduct_(raw, fallback) {
  var hit = [];
  PRODUCT_HINTS.forEach(function (h) {
    if (h.re.test(raw) && hit.indexOf(h.product) === -1) hit.push(h.product);
  });

  // 상품 힌트가 둘 이상 = "킥보드가방+원형바구니" 처럼 한 행에 상품이 섞였다.
  // 첫 상품으로 두되 반드시 확인 표시를 남긴다 (조용히 하나로 뭉개지 않는다).
  if (hit.length > 1) return { product: hit[0], uncertain: true };
  if (hit.length === 1) return { product: hit[0], uncertain: false };

  // 힌트가 없으면 파일 기본 상품. 괄호가 색상·메모면 경고하지 않는다.
  var m = raw.match(/[(\[（]([^)\]）]+)[)\]）]/);
  var unknownParen = !!m && !OPTION_WORDS.test(m[1]) && !NOTE_WORDS.test(m[1]);
  return { product: fallback, uncertain: unknownParen };
}

// ── 셀러명 쪼개기 ──────────────────────────────────────────────
//  "소뮤맘(전면차트) 샘플완료" → name:소뮤맘 / note:전면차트
//  "쭈뱅부부 n차"             → name:쭈뱅부부 / round:n차
//  "윤이랜드-매출x"           → name:윤이랜드 / note:매출x
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

// ── 마스터 시트 ────────────────────────────────────────────────
function writeMaster_(ss, rows) {
  var sh = ss.getSheetByName('마스터') || ss.insertSheet('마스터', 0);
  sh.clear();
  sh.clearConditionalFormatRules();
  if (sh.getMaxRows() < rows.length + 200) {
    sh.insertRowsAfter(sh.getMaxRows(), rows.length + 200 - sh.getMaxRows());
  }

  var HEAD = ['상품', '셀러명', '시작일', '종료일', '샘플', '정산',
              '비고', '일수', '연도추정', '상품확인', '원본탭', '원문'];
  sh.getRange(1, 1, 1, HEAD.length).setValues([HEAD])
    .setFontWeight('bold').setBackground('#e8eaed').setHorizontalAlignment('center');

  if (rows.length) {
    sh.getRange(2, 1, rows.length, HEAD.length).setValues(rows);
    sh.getRange(2, 3, rows.length, 2).setNumberFormat('yyyy-mm-dd');
  }

  // 샘플·정산은 체크박스 — 클릭 한 번으로 바뀌고 간트 색이 따라 바뀐다
  var span = Math.max(rows.length, 300);
  sh.getRange(2, 5, span, 2).insertCheckboxes();

  // 상품은 드롭다운 — 오타로 상품이 갈라지는 것을 막는다
  sh.getRange(2, 1, span, 1).setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInList(PRODUCTS, true).setAllowInvalid(true).build());

  sh.setFrozenRows(1);
  [230, 140, 92, 92, 52, 52, 170, 48, 82, 76, 105, 230]
    .forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });

  // 확인이 필요한 행은 노란 바탕 — 눈에 걸리게 둔다
  sh.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=OR($I2<>"",$J2<>"")')
      .setBackground('#fff3cd')
      .setRanges([sh.getRange(2, 1, span, HEAD.length)])
      .build()
  ]);
}

// ── 간트 시트 ──────────────────────────────────────────────────
function writeGantt_(ss, rows) {
  var sh = ss.getSheetByName('간트') || ss.insertSheet('간트', 1);
  sh.clear();
  sh.clearConditionalFormatRules();
  if (!rows.length) return;

  var min = rows[0][2], max = rows[0][3];
  rows.forEach(function (r) { if (r[2] < min) min = r[2]; if (r[3] > max) max = r[3]; });
  min = new Date(min.getFullYear(), min.getMonth(), 1);
  max = new Date(max.getFullYear(), max.getMonth() + 1, 0);
  var span = Math.round((max - min) / 86400000) + 1;

  var LEFT = 6;                                   // 상품·셀러·시작·종료·샘플·정산
  var need = LEFT + span;
  if (sh.getMaxColumns() < need) sh.insertColumnsAfter(sh.getMaxColumns(), need - sh.getMaxColumns());
  var body = rows.length + 60;
  if (sh.getMaxRows() < body + 2) sh.insertRowsAfter(sh.getMaxRows(), body + 2 - sh.getMaxRows());

  sh.getRange(2, 1, 1, LEFT)
    .setValues([['상품', '셀러명', '시작일', '종료일', '샘플', '정산']])
    .setFontWeight('bold').setBackground('#e8eaed');

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

  // 왼쪽 6열은 마스터에서 끌어온다 — 마스터에 행을 더하면 간트도 같이 늘어난다
  sh.getRange(3, 1).setFormula(
    '=IFERROR(QUERY(마스터!A2:L, "select A,B,C,D,E,F where C is not null order by A, C", 0), "")');
  sh.getRange(3, 3, body, 2).setNumberFormat('yyyy-mm-dd');

  [230, 140, 92, 92, 52, 52].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.setColumnWidths(LEFT + 1, span, 22);
  sh.setFrozenRows(2);
  sh.setFrozenColumns(LEFT);

  // ── 조건부서식 (위에서부터 먼저 걸리는 것이 이긴다) ──
  var area  = sh.getRange(3, LEFT + 1, body, span);
  var IN    = '$C3<>"", G$2>=$C3, G$2<=$D3';      // 이 칸이 공구 기간 안인가
  var rules = [];

  function bar(cond, color) {
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=AND(' + cond + ')')
      .setBackground(color).setFontColor(color).setRanges([area]).build());
  }

  bar(IN + ', $F3=TRUE',                              C_DONE);    // 정산완료
  bar(IN + ', $D3<TODAY(), $F3<>TRUE',                C_UNPAID);  // 끝났는데 미정산
  bar(IN + ', $C3<=TODAY(), $D3>=TODAY()',            C_RUNNING); // 진행중
  bar(IN + ', $C3>TODAY(), $E3=TRUE',                 C_READY);   // 예정 · 샘플 감
  bar(IN + ', $C3>TODAY()',                           C_NOSAMP);  // 예정 · 샘플 아직
  bar(IN,                                             C_RUNNING); // 나머지

  rules.push(SpreadsheetApp.newConditionalFormatRule()   // 오늘
    .whenFormulaSatisfied('=G$2=TODAY()')
    .setBackground(TODAY_BG).setRanges([area]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule()   // 주말
    .whenFormulaSatisfied('=WEEKDAY(G$2,2)>5')
    .setBackground(WEEKEND).setRanges([area]).build());

  sh.setConditionalFormatRules(rules);

  // 범례
  var lg = [['■ 정산완료', '■ 미정산(끝남)', '■ 진행중', '■ 예정·샘플감', '■ 예정·샘플아직']];
  sh.getRange(1, 1, 1, 5).setValues(lg).setFontSize(9);
  [C_DONE, C_UNPAID, C_RUNNING, C_READY, C_NOSAMP]
    .forEach(function (c, i) { sh.getRange(1, i + 1).setFontColor(c).setFontWeight('bold'); });
}
