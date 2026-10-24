// 위젯 v5(나만의 캘린더)를 Bubblewrap 이 만든 안드로이드 프로젝트에 넣는다 (깃허브 빌드에서 `bubblewrap update` 바로 뒤에 돈다)
//   node android-app/widgets/install_widgets.mjs   (작업 폴더 = android-app)
//   1) java/*.java → app/src/main/java/com/wantsb/momcalendar/widget/
//   2) 레이아웃·모양·위젯 정보 XML 을 여기서 만들어 app/src/main/res/ 에
//   3) AndroidManifest.xml 의 </application> 앞에 위젯 2개(크게·중간) + 목록 서비스 + 누르기 받는 투명 화면
// 디자인 값(색·글자·간격·모서리)은 아래 T 한 곳 — references/THREADS_REFERENCES.md 디자인 원칙(값 단계화)
// 시안: scratchpad/mockups/widget_v5_tabs.html (사장님 2026-10-24 — 옆 탭 유지·나만의 캘린더·내 찜/전체 토글)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '..', 'app', 'src', 'main');
if (!fs.existsSync(APP)) { console.error('🔴 app/src/main 없음 — bubblewrap update 를 먼저'); process.exit(1); }
const W = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };

// 1) 자바
const jdir = path.join(APP, 'java', 'com', 'wantsb', 'momcalendar', 'widget');
fs.rmSync(jdir, { recursive: true, force: true });   // 옛 위젯(v3) 클래스가 남지 않게
for (const f of fs.readdirSync(path.join(HERE, 'java'))) W(path.join(jdir, f), fs.readFileSync(path.join(HERE, 'java', f)));

// 2) 리소스
const T = { paper: '#F6F0E8', ink: '#2E2A27', ink2: '#6F6760', ink3: '#A79F97', grn: '#B9D3A1',
  tab: { sand: '#E9DCC6', pink: '#F2C9CF', peach: '#F6D9BF', sky: '#CFDDE8', mint: '#D5E4C8' },
  tag: { op: '#F8DCD8', en: '#F5E9C4', ing: '#DCEBD5', up: '#F8E1CF' } };
const R = (n, s) => W(path.join(APP, 'res', n), `<?xml version="1.0" encoding="utf-8"?>\n${s}\n`);
const A = 'xmlns:android="http://schemas.android.com/apk/res/android"';
const shape = (color, r, extra = '') => `<shape ${A} android:shape="rectangle"><solid android:color="${color}"/><corners android:radius="${r}dp"/>${extra}</shape>`;
R('drawable/w_bg_beige.xml', shape(T.paper, 24));
R('drawable/w_panel.xml', shape('#8CFFFFFF', 14));
R('drawable/w_seg_bg.xml', shape('#0F000000', 20));
R('drawable/w_seg_on.xml', shape('#FFFFFF', 20));
for (const [k, c] of Object.entries(T.tag)) R(`drawable/w_tag_${k}.xml`, shape(c, 20));
R('drawable/w_ck.xml', `<shape ${A} android:shape="oval"><stroke android:width="1.6dp" android:color="#B9AFA6"/><size android:width="17dp" android:height="17dp"/></shape>`);
R('drawable/w_ck_on.xml', `<shape ${A} android:shape="oval"><solid android:color="${T.grn}"/><size android:width="17dp" android:height="17dp"/></shape>`);
for (const [k, c] of Object.entries(T.tab)) R(`drawable/w_tab_${k}.xml`, `<shape ${A} android:shape="rectangle"><solid android:color="${c}"/><corners android:topLeftRadius="10dp" android:bottomLeftRadius="10dp" android:topRightRadius="2dp" android:bottomRightRadius="2dp"/></shape>`);

const tv = (id, size, color, extra = '') => `<TextView android:id="@+id/${id}" android:layout_width="wrap_content" android:layout_height="wrap_content" android:textSize="${size}sp" android:textColor="${color}" android:maxLines="1" android:ellipsize="end" ${extra}/>`;

// 한 줄: [동그라미] [색 점] 이름/작은 줄 [표시]
R('layout/w_item.xml', `<LinearLayout ${A} android:id="@+id/w_row" android:layout_width="match_parent" android:layout_height="wrap_content" android:orientation="horizontal" android:gravity="center_vertical" android:paddingTop="4dp" android:paddingBottom="4dp">
  <TextView android:id="@+id/w_ck" android:layout_width="18dp" android:layout_height="18dp" android:layout_marginEnd="8dp" android:background="@drawable/w_ck" android:visibility="gone"/>
  ${tv('w_dot', 8, T.ink3, 'android:text="●" android:layout_marginEnd="6dp" android:visibility="gone"')}
  <LinearLayout android:layout_width="0dp" android:layout_height="wrap_content" android:layout_weight="1" android:orientation="vertical">
    ${tv('w_name', 13, T.ink, 'android:textStyle="bold"')}
    ${tv('w_meta', 10.5, T.ink3)}
  </LinearLayout>
  ${tv('w_tag', 10.5, T.ink2, 'android:textStyle="bold" android:layout_marginStart="6dp" android:paddingStart="7dp" android:paddingEnd="7dp" android:paddingTop="2dp" android:paddingBottom="2dp" android:visibility="gone"')}
</LinearLayout>`);
R('layout/w_grp.xml', `<TextView ${A} android:id="@+id/w_grp" android:layout_width="match_parent" android:layout_height="wrap_content" android:textSize="10.5sp" android:textColor="${T.ink2}" android:textStyle="bold" android:paddingTop="7dp" android:paddingBottom="1dp"/>`);

// 머리: 제목(누르면 이번 주 ↔ 이번 달) + 내 찜 / 전체
const head = `<LinearLayout android:layout_width="match_parent" android:layout_height="wrap_content" android:orientation="horizontal" android:gravity="center_vertical">
   ${tv('w_title', 14, T.ink, 'android:textStyle="bold" android:text="이번 주 일정"')}
   <View android:layout_width="0dp" android:layout_height="1dp" android:layout_weight="1"/>
   <LinearLayout android:layout_width="wrap_content" android:layout_height="wrap_content" android:orientation="horizontal" android:background="@drawable/w_seg_bg" android:padding="2dp">
    ${tv('w_seg_mine', 11, T.ink, 'android:text="내 찜" android:textStyle="bold" android:paddingStart="9dp" android:paddingEnd="9dp" android:paddingTop="3dp" android:paddingBottom="3dp"')}
    ${tv('w_seg_all', 11, T.ink3, 'android:text="전체" android:textStyle="bold" android:paddingStart="9dp" android:paddingEnd="9dp" android:paddingTop="3dp" android:paddingBottom="3dp"')}
   </LinearLayout>
  </LinearLayout>`;
// 옆 탭 — 사장님 2026-10-24 "옆에 이건 꼭 살려야지 트레이드마큰데". 세일 아이콘은 🛍️(VS16 붙여야 컬러로 나온다)
//   줄바꿈은 XML 속성 안에서 공백으로 바뀌므로 글자 그대로의 \n(역슬래시+n)을 써 넣는다 — 안드로이드가 줄바꿈으로 읽는다
const NL = '\\n';
const TABS = [['w_t0', '📋', '전' + NL + '체', 'sand'], ['w_t1', '💗', '공' + NL + '구', 'pink'], ['w_t2', '🔥', '핫' + NL + '딜', 'peach'], ['w_t3', '📺', '라' + NL + '방', 'sky'], ['w_t4', '🛍️', '세' + NL + '일', 'mint']];
const side = (iconOnly) => `<LinearLayout android:layout_width="${iconOnly ? 28 : 34}dp" android:layout_height="match_parent" android:orientation="vertical">
  ${TABS.map(([id, e, t, c]) => `<TextView android:id="@+id/${id}" android:layout_width="match_parent" android:layout_height="0dp" android:layout_weight="1" android:layout_marginBottom="4dp" android:background="@drawable/w_tab_${c}" android:gravity="center" android:text="${iconOnly ? e : e + NL + t}" android:textSize="${iconOnly ? 11 : 10.5}sp" android:textStyle="bold" android:lineSpacingMultiplier="0.92" android:textColor="${T.ink}"/>`).join('\n  ')}
 </LinearLayout>
 <View android:id="@+id/w_edge" android:layout_width="3dp" android:layout_height="match_parent" android:background="@drawable/w_tab_sand"/>`;
const frame = (iconOnly, body) => `<LinearLayout ${A} android:id="@+id/w_root" android:layout_width="match_parent" android:layout_height="match_parent" android:orientation="horizontal" android:background="@drawable/w_bg_beige" android:paddingTop="10dp" android:paddingBottom="10dp" android:paddingStart="6dp" android:paddingEnd="9dp">
 ${side(iconOnly)}
 <LinearLayout android:layout_width="0dp" android:layout_height="match_parent" android:layout_weight="1" android:orientation="vertical" android:background="@drawable/w_panel" android:padding="11dp">
  ${head}
  ${body}
 </LinearLayout>
</LinearLayout>`;
R('layout/w_cal_l.xml', frame(false, `<FrameLayout android:layout_width="match_parent" android:layout_height="0dp" android:layout_weight="1" android:layout_marginTop="4dp">
   <ListView android:id="@+id/w_list" android:layout_width="match_parent" android:layout_height="match_parent" android:divider="@null" android:dividerHeight="0dp" android:scrollbarSize="3dp" android:fadingEdgeLength="24dp" android:requiresFadingEdge="vertical"/>
   ${tv('w_empty', 12, T.ink3, 'android:layout_gravity="center" android:text="불러오는 중…"')}
  </FrameLayout>`));
R('layout/w_cal_m.xml', frame(true, `<LinearLayout android:id="@+id/w_rows" android:layout_width="match_parent" android:layout_height="wrap_content" android:orientation="vertical" android:layout_marginTop="4dp"/>`));

const info = (layout, w, h, cw, ch, desc) => `<appwidget-provider ${A} android:minWidth="${w}dp" android:minHeight="${h}dp" android:targetCellWidth="${cw}" android:targetCellHeight="${ch}" android:updatePeriodMillis="1800000" android:initialLayout="@layout/${layout}" android:previewLayout="@layout/${layout}" android:resizeMode="horizontal|vertical" android:widgetCategory="home_screen" android:description="@string/${desc}"/>`;
const WIDGETS = [
  ['CalLarge', 'w_cal_l', 250, 250, 4, 4, '맘캘 나만의 캘린더 (크게)'],
  ['CalMedium', 'w_cal_m', 250, 110, 4, 2, '맘캘 나만의 캘린더 (중간)'],
];
const strings = [];
for (const [cls, layout, w, h, cw, ch, label] of WIDGETS) {
  const k = 'w_desc_' + cls.toLowerCase();
  R(`xml/w_info_${cls.toLowerCase()}.xml`, info(layout, w, h, cw, ch, k));
  strings.push(`<string name="${k}">${label}</string>`, `<string name="w_label_${cls.toLowerCase()}">${label}</string>`);
}
R('values/w_strings.xml', `<resources>\n${strings.join('\n')}\n</resources>`);

// 3) 매니페스트
const mf = path.join(APP, 'AndroidManifest.xml');
let m = fs.readFileSync(mf, 'utf8');
if (!m.includes('widget.CalLarge')) {
  const recv = WIDGETS.map(([cls]) => `
        <receiver android:name="com.wantsb.momcalendar.widget.${cls}" android:exported="true" android:label="@string/w_label_${cls.toLowerCase()}">
            <intent-filter>
                <action android:name="android.appwidget.action.APPWIDGET_UPDATE"/>
            </intent-filter>
            <meta-data android:name="android.appwidget.provider" android:resource="@xml/w_info_${cls.toLowerCase()}"/>
        </receiver>`).join('') + `
        <service android:name="com.wantsb.momcalendar.widget.CalListService" android:permission="android.permission.BIND_REMOTEVIEWS" android:exported="false"/>
        <activity android:name="com.wantsb.momcalendar.widget.WidgetAction" android:exported="false" android:theme="@android:style/Theme.Translucent.NoTitleBar" android:excludeFromRecents="true" android:noHistory="true" android:taskAffinity="" android:launchMode="singleInstance"/>`;
  const i = m.lastIndexOf('</application>');
  if (i < 0) { console.error('🔴 </application> 못 찾음'); process.exit(1); }
  m = m.slice(0, i) + recv + '\n    ' + m.slice(i);
  if (!m.includes('android.permission.INTERNET')) m = m.replace(/<application/, '<uses-permission android:name="android.permission.INTERNET"/>\n    <application');
  fs.writeFileSync(mf, m);
}
console.log('✔ 위젯 설치:', WIDGETS.map((w) => w[0]).join(', '), '+ CalListService + WidgetAction');
