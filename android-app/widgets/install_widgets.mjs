// 위젯을 Bubblewrap 이 만든 안드로이드 프로젝트에 넣는다 (깃허브 빌드에서 `bubblewrap update` 바로 뒤에 돈다)
//   node android-app/widgets/install_widgets.mjs   (작업 폴더 = android-app)
//   1) java/*.java → app/src/main/java/com/wantsb/momcalendar/widget/
//   2) 레이아웃·모양·위젯 정보 XML 을 여기서 만들어 app/src/main/res/ 에
//   3) AndroidManifest.xml 의 </application> 앞에 위젯 리시버 5개
// 디자인 값(색·글자·간격·모서리)은 아래 T 한 곳 — references/THREADS_REFERENCES.md 디자인 원칙(값 단계화)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '..', 'app', 'src', 'main');
if (!fs.existsSync(APP)) { console.error('🔴 app/src/main 없음 — bubblewrap update 를 먼저'); process.exit(1); }
const W = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };

// 1) 자바
const jdir = path.join(APP, 'java', 'com', 'wantsb', 'momcalendar', 'widget');
for (const f of fs.readdirSync(path.join(HERE, 'java'))) W(path.join(jdir, f), fs.readFileSync(path.join(HERE, 'java', f)));

// 2) 리소스
const T = { paper: '#F6F0E8', pink: '#F7E6EC', ink: '#2E2A27', ink2: '#6F6760', ink3: '#A79F97', acc: '#E58FA6', grn: '#B9D3A1',
  chipB: '#EFE7DC', chipP: '#F0D9E2', track: '#EAD9CF', trackP: '#F1C3CF',
  tab: { pink: '#F2C9CF', yel: '#F3E3A8', sky: '#CFDDE8', mint: '#D5E4C8', sand: '#E9DCC6' } };
const R = (n, s) => W(path.join(APP, 'res', n), `<?xml version="1.0" encoding="utf-8"?>\n${s}\n`);
const A = 'xmlns:android="http://schemas.android.com/apk/res/android"';
const shape = (color, r, extra = '') => `<shape ${A} android:shape="rectangle"><solid android:color="${color}"/><corners android:radius="${r}dp"/>${extra}</shape>`;
R('drawable/w_bg_beige.xml', shape(T.paper, 24));
R('drawable/w_bg_pink.xml', shape(T.pink, 24));
R('drawable/w_panel.xml', shape('#8CFFFFFF', 14));
R('drawable/w_try.xml', shape('#0A000000', 14));
R('drawable/w_chip_b.xml', shape(T.chipB, 20));
R('drawable/w_chip_p.xml', shape(T.chipP, 20));
R('drawable/w_box.xml', shape('#99FFFFFF', 14, `<stroke android:width="1dp" android:color="#14000000"/>`));
R('drawable/w_ck.xml', `<shape ${A} android:shape="oval"><stroke android:width="1.6dp" android:color="#B9AFA6"/><size android:width="17dp" android:height="17dp"/></shape>`);
R('drawable/w_ck_on.xml', `<shape ${A} android:shape="oval"><solid android:color="${T.grn}"/><size android:width="17dp" android:height="17dp"/></shape>`);
for (const [k, c] of Object.entries(T.tab)) R(`drawable/w_tab_${k}.xml`, `<shape ${A} android:shape="rectangle"><solid android:color="${c}"/><corners android:topLeftRadius="10dp" android:bottomLeftRadius="10dp" android:topRightRadius="2dp" android:bottomRightRadius="2dp"/></shape>`);
const prog = (track) => `<layer-list ${A}><item android:id="@android:id/background"><shape><corners android:radius="2dp"/><solid android:color="${track}"/></shape></item><item android:id="@android:id/progress"><clip><shape><corners android:radius="2dp"/><solid android:color="${T.grn}"/></shape></clip></item></layer-list>`;
R('drawable/w_prog_b.xml', prog(T.track));
R('drawable/w_prog_p.xml', prog(T.trackP));

const tv = (id, size, color, extra = '') => `<TextView android:id="@+id/${id}" android:layout_width="wrap_content" android:layout_height="wrap_content" android:textSize="${size}sp" android:textColor="${color}" android:maxLines="1" android:ellipsize="end" ${extra}/>`;
const progBar = (bg) => `<ProgressBar android:id="@+id/w_prog" style="@android:style/Widget.ProgressBar.Horizontal" android:layout_width="match_parent" android:layout_height="3dp" android:layout_marginTop="8dp" android:layout_marginBottom="6dp" android:max="100" android:progress="30" android:progressDrawable="@drawable/w_prog_${bg}"/>`;
const header = (title, bg) => `<LinearLayout android:id="@+id/w_head" android:layout_width="match_parent" android:layout_height="wrap_content" android:orientation="horizontal" android:gravity="center_vertical">
  ${tv('w_dot', 9, T.acc, 'android:text="●" android:layout_marginEnd="6dp"')}
  ${tv('w_title', 14, T.ink, `android:text="${title}" android:textStyle="bold"`)}
  <View android:layout_width="0dp" android:layout_height="1dp" android:layout_weight="1"/>
  ${tv('w_cnt', 12, T.ink3, 'android:textStyle="bold"')}
</LinearLayout>${progBar(bg)}`;

// 한 줄(종 / 동그라미)
const rowXml = (lead) => `<LinearLayout ${A} android:id="@+id/w_row" android:layout_width="match_parent" android:layout_height="wrap_content" android:orientation="horizontal" android:gravity="center_vertical" android:paddingTop="4dp" android:paddingBottom="4dp">
  ${lead}
  <LinearLayout android:layout_width="0dp" android:layout_height="wrap_content" android:layout_weight="1" android:orientation="vertical" android:layout_marginStart="9dp">
    ${tv('w_meta', 10.5, T.ink3)}
    ${tv('w_name', 14, T.ink, 'android:textStyle="bold"')}
  </LinearLayout>
  ${tv('w_dd', 12, T.acc, 'android:textStyle="bold" android:layout_marginStart="6dp"')}
</LinearLayout>`;
R('layout/w_row_bell.xml', rowXml(`<TextView android:layout_width="wrap_content" android:layout_height="wrap_content" android:text="🔔" android:textSize="11sp" android:alpha="0.6"/>`));
R('layout/w_row_check.xml', rowXml(`<TextView android:id="@+id/w_ck" android:layout_width="18dp" android:layout_height="18dp" android:background="@drawable/w_ck"/>`));
R('layout/w_sec.xml', `<TextView ${A} android:id="@+id/w_sec" android:layout_width="wrap_content" android:layout_height="wrap_content" android:textSize="10.5sp" android:textColor="${T.ink3}" android:textStyle="bold" android:layout_marginTop="6dp"/>`);
R('layout/w_lk.xml', `<LinearLayout ${A} android:id="@+id/w_row" android:layout_width="match_parent" android:layout_height="wrap_content" android:orientation="horizontal" android:gravity="center_vertical" android:paddingTop="5dp" android:paddingBottom="5dp">
  <LinearLayout android:layout_width="0dp" android:layout_height="wrap_content" android:layout_weight="1" android:orientation="vertical">
    ${tv('w_meta', 10.5, T.ink3)}
    ${tv('w_name', 13, T.ink, 'android:textStyle="bold"')}
  </LinearLayout>
  ${tv('w_dd', 11.5, T.ink3, 'android:textStyle="bold" android:layout_marginStart="6dp" android:maxWidth="90dp"')}
</LinearLayout>`);

const rows = `<LinearLayout android:id="@+id/w_rows" android:layout_width="match_parent" android:layout_height="wrap_content" android:orientation="vertical"/>`;
R('layout/w_upnext_a.xml', `<LinearLayout ${A} android:id="@+id/w_root" android:layout_width="match_parent" android:layout_height="match_parent" android:orientation="vertical" android:background="@drawable/w_bg_beige" android:padding="14dp">
${header('다음 오픈', 'b')}
${rows}
</LinearLayout>`);
R('layout/w_upnext_b.xml', `<LinearLayout ${A} android:id="@+id/w_root" android:layout_width="match_parent" android:layout_height="match_parent" android:orientation="horizontal" android:background="@drawable/w_bg_pink" android:padding="14dp">
 <LinearLayout android:layout_width="0dp" android:layout_height="match_parent" android:layout_weight="1" android:orientation="vertical">
  ${header('다음 오픈', 'p')}
  ${rows}
 </LinearLayout>
 <LinearLayout android:id="@+id/w_box" android:layout_width="wrap_content" android:layout_height="match_parent" android:orientation="vertical" android:gravity="center" android:layout_marginStart="12dp">
  <FrameLayout android:layout_width="74dp" android:layout_height="74dp" android:background="@drawable/w_box"><ImageView android:layout_width="44dp" android:layout_height="44dp" android:layout_gravity="center" android:src="@mipmap/ic_launcher"/></FrameLayout>
  ${tv('w_big', 22, T.acc, 'android:textStyle="bold" android:layout_marginTop="6dp"')}
 </LinearLayout>
</LinearLayout>`);
const chips = (bg) => `<LinearLayout android:layout_width="match_parent" android:layout_height="wrap_content" android:orientation="horizontal" android:layout_marginBottom="2dp">
  ${['w_chip1', 'w_chip2', 'w_chip3'].map((id) => tv(id, 11.5, T.ink2, `android:textStyle="bold" android:background="@drawable/w_chip_${bg}" android:paddingStart="9dp" android:paddingEnd="9dp" android:paddingTop="3dp" android:paddingBottom="3dp" android:layout_marginEnd="6dp"`)).join('\n  ')}
</LinearLayout>`;
R('layout/w_upnext_c.xml', `<LinearLayout ${A} android:id="@+id/w_root" android:layout_width="match_parent" android:layout_height="match_parent" android:orientation="vertical" android:background="@drawable/w_bg_beige" android:padding="15dp">
${header('다음 오픈 · 맘캘린더', 'b')}
${chips('b')}
${rows}
</LinearLayout>`);
const tabsXml = (bg, chip, prg) => `<LinearLayout ${A} android:id="@+id/w_root" android:layout_width="match_parent" android:layout_height="match_parent" android:orientation="horizontal" android:background="@drawable/w_bg_${bg}" android:paddingTop="10dp" android:paddingBottom="10dp" android:paddingStart="6dp" android:paddingEnd="9dp">
 <LinearLayout android:layout_width="34dp" android:layout_height="match_parent" android:orientation="vertical">
  ${[['w_t0', '📅\n공\n구', 'pink'], ['w_t1', '💜\n찜', 'yel'], ['w_t2', '🔥\n핫\n딜', 'sky'], ['w_t3', '🛍\n세\n일', 'mint'], ['w_t4', '✅\n출\n석', 'sand']].map(([id, t, c]) =>
    `<TextView android:id="@+id/${id}" android:layout_width="match_parent" android:layout_height="0dp" android:layout_weight="1" android:layout_marginBottom="4dp" android:background="@drawable/w_tab_${c}" android:gravity="center" android:text="${t}" android:textSize="10.5sp" android:textStyle="bold" android:lineSpacingMultiplier="0.92" android:textColor="${T.ink}"/>`).join('\n  ')}
 </LinearLayout>
 <View android:id="@+id/w_edge" android:layout_width="3dp" android:layout_height="match_parent" android:background="@drawable/w_tab_pink"/>
 <LinearLayout android:layout_width="0dp" android:layout_height="match_parent" android:layout_weight="1" android:orientation="vertical" android:background="@drawable/w_panel" android:padding="11dp">
  <LinearLayout android:layout_width="match_parent" android:layout_height="wrap_content" android:orientation="vertical" android:background="@drawable/w_try" android:paddingStart="11dp" android:paddingEnd="11dp" android:paddingTop="9dp" android:paddingBottom="4dp">
   ${header('오늘 열린 공구', prg)}
  </LinearLayout>
  <View android:layout_width="1dp" android:layout_height="8dp"/>
  ${chips(chip)}
  ${tv('w_secl', 10.5, T.ink3, 'android:textStyle="bold" android:layout_marginTop="6dp"')}
  ${rows}
 </LinearLayout>
</LinearLayout>`;
R('layout/w_tabs_beige.xml', tabsXml('beige', 'b', 'b'));
R('layout/w_tabs_pink.xml', tabsXml('pink', 'p', 'p'));

const info = (layout, w, h, cw, ch, desc) => `<appwidget-provider ${A} android:minWidth="${w}dp" android:minHeight="${h}dp" android:targetCellWidth="${cw}" android:targetCellHeight="${ch}" android:updatePeriodMillis="1800000" android:initialLayout="@layout/${layout}" android:previewLayout="@layout/${layout}" android:resizeMode="horizontal|vertical" android:widgetCategory="home_screen" android:description="@string/${desc}"/>`;
const WIDGETS = [
  ['UpNextA', 'w_upnext_a', 250, 110, 4, 2, '맘캘 다음 오픈 A (베이지)'],
  ['UpNextB', 'w_upnext_b', 250, 110, 4, 2, '맘캘 다음 오픈 B (분홍)'],
  ['UpNextC', 'w_upnext_c', 250, 250, 4, 4, '맘캘 다음 오픈 C (크게)'],
  ['SideTabsBeige', 'w_tabs_beige', 250, 250, 4, 4, '맘캘 옆 탭 (베이지)'],
  ['SideTabsPink', 'w_tabs_pink', 250, 250, 4, 4, '맘캘 옆 탭 (분홍)'],
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
if (!m.includes('widget.UpNextA')) {
  const recv = WIDGETS.map(([cls]) => `
        <receiver android:name="com.wantsb.momcalendar.widget.${cls}" android:exported="true" android:label="@string/w_label_${cls.toLowerCase()}">
            <intent-filter>
                <action android:name="android.appwidget.action.APPWIDGET_UPDATE"/>
            </intent-filter>
            <meta-data android:name="android.appwidget.provider" android:resource="@xml/w_info_${cls.toLowerCase()}"/>
        </receiver>`).join('');
  const i = m.lastIndexOf('</application>');
  if (i < 0) { console.error('🔴 </application> 못 찾음'); process.exit(1); }
  m = m.slice(0, i) + recv + '\n    ' + m.slice(i);
  if (!m.includes('android.permission.INTERNET')) m = m.replace(/<application/, '<uses-permission android:name="android.permission.INTERNET"/>\n    <application');
  fs.writeFileSync(mf, m);
}
console.log('✔ 위젯 5개 설치:', WIDGETS.map((w) => w[0]).join(', '));
