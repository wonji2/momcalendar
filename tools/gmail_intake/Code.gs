/**
 * 지메일로 온 건의·오류·스토어 심사 메일을 맘캘린더 제보함(inquiries)에 자동으로 넣는다.
 *   사장님 2026-11-04 「지메일로 오는 건들도 … 내가 매번 안 시키고」
 *
 * 왜 구글 앱스 스크립트인가: 구글 서버에서 돌아 PC 가 꺼져도 멈추지 않고(규칙 0-Y-PC), 클로드·토큰을 쓰지 않는다.
 * 흐름: 10분마다 → 안 읽은 새 메일 중 「사람이 보낸 것」과 「앱 스토어 심사·정책 메일」만 골라
 *       Supabase 공개 함수 submit_inquiry 로 넣는다 → 이미 도는 클라우드 처리기(inquiry-cloud.yml, 10분)가 이어받는다
 *       (고칠 수 있는 건 고치고 닫고, 못 고치면 관리자 첫 화면 「확인 필요」).
 * 넣지 않는 것: 인증 코드·보안 경고·광고·자동 알림(noreply). 처리한 메일엔 라벨 mc-intake 를 붙여 두 번 안 넣는다. 메일은 읽음 처리·삭제하지 않는다.
 * 비밀값 없음: 아래 키는 사이트에 이미 공개된 anon 키다(손님 화면과 같다).
 *
 * 설치(처음 한 번, 2분): README.md
 */
var SB_URL = 'https://hycaqsqeogjtbscmzrtm.supabase.co/rest/v1/rpc/submit_inquiry';
var SB_KEY = 'sb_publishable_u4hR4mdNTSss3kdjFH6R5Q_iuJ2MuGE';
var LABEL = 'mc-intake';
// 우리 주소로 온 것만 본다(개인 메일을 읽지 않게)
var MY_ADDR = ['cs@momcalendar.com', 'app@momcalendar.com'];
// 자동 알림 보낸 사람 → 넣지 않는다(스토어 심사·정책 메일은 아래에서 따로 살린다)
var NOISE_FROM = /(no-?reply|donotreply|mailer-daemon|postmaster|notification|noti@|newsletter|marketing|ads?@)/i;
var NOISE_SUBJECT = /(인증 ?코드|확인 ?코드|verification code|보안 경고|security alert|비밀번호|password|로그인 ?시도|sign-?in|receipt|영수증|결제|invoice|unsubscribe)/i;
// 앱 스토어 심사·정책 메일은 noreply 여도 중요하다(앱 반려·정책 위반 경고)
var STORE_FROM = /(apple\.com|itunes|googleplay|google play|play-?console|androiddeveloper)/i;
var STORE_SUBJECT = /(review|심사|rejected|거부|반려|action required|조치|policy|정책|guideline|가이드라인|suspend|정지|violation|위반|removed|삭제|app store connect|testflight)/i;

function intake() {
  var label = GmailApp.getUserLabelByName(LABEL) || GmailApp.createLabel(LABEL);
  var q = '(' + MY_ADDR.map(function (a) { return 'to:' + a + ' OR deliveredto:' + a; }).join(' OR ') + ') newer_than:3d -label:' + LABEL;
  var threads = GmailApp.search(q, 0, 30);
  var sent = 0, skipped = 0, failed = 0;
  threads.forEach(function (th) {
    var msgs = th.getMessages();
    var last = msgs[msgs.length - 1];
    var from = last.getFrom() || '', subject = last.getSubject() || '';
    var store = STORE_FROM.test(from) && STORE_SUBJECT.test(subject);
    var noise = NOISE_FROM.test(from) || NOISE_SUBJECT.test(subject);
    if (!store && noise) { th.addLabel(label); skipped++; return; }
    if (!store && STORE_FROM.test(from)) { th.addLabel(label); skipped++; return; }   // 스토어 발신이어도 심사·정책 아닌 것(영수증 등)은 건너뜀
    var body = (last.getPlainBody() || '').replace(/\s+/g, ' ').trim();
    var head = (store ? '[스토어 메일] ' : '[지메일] ') + subject;
    var content = (head + ' / ' + body).slice(0, 1900);
    var ok = post_(content, from, last.getId());
    if (ok) { th.addLabel(label); sent++; } else { failed++; }
  });
  console.log('지메일 제보함: 넣음 ' + sent + ' · 건너뜀 ' + skipped + ' · 실패 ' + failed);
}

function post_(content, from, id) {
  try {
    var res = UrlFetchApp.fetch(SB_URL, {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY },
      payload: JSON.stringify({
        p_kind: 'etc', p_content: content, p_contact: String(from).slice(0, 120),
        p_device: 'gmail-' + id,            // 메일마다 따로(같은 기기 하루 5건 제한에 안 걸리게)
        p_page: 'gmail', p_token: null
      })
    });
    var j = JSON.parse(res.getContentText() || '{}');
    if (!(j && j.ok)) console.log('제보함 거절: ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 120));
    return !!(j && j.ok);
  } catch (e) { console.log('제보함 오류: ' + e); return false; }
}

// 처음 한 번만 실행: 10분마다 intake 를 돌리는 장치를 만든다(여러 번 실행해도 하나만 남는다)
function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'intake') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('intake').timeBased().everyMinutes(10).create();
  intake();
}
