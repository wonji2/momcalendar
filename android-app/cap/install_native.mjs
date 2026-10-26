// `npx cap add android` 로 새로 만든 안드로이드 프로젝트에 맘캘린더 것을 끼운다 (2026-10-26, CI 에서 매번)
//   node install_native.mjs   (작업 폴더 = android-app/cap)
//   환경변수: VERSION_CODE(정수) · GOOGLE_SERVICES_JSON(있으면 알림 켬) · E2E=1(시험용: 웹뷰 원격 디버깅 켬)
// 하는 일
//   1) native/*.java → 앱 패키지 폴더 (MainActivity 덮어씀)
//   2) 홈화면 위젯(../widgets) — TWA 판과 같은 코드, 여는 화면만 MainActivity
//   3) AndroidManifest: <queries>(안드로이드 11+ 다른 앱 확인 — 토스페이먼츠 dev-4) · momcalendar.com 앱 링크(카카오 로그인 뒤 돌아오기) · 알림 아이콘
//   4) build.gradle: Custom Tabs 라이브러리 · 버전 · 서명(시크릿 → 환경변수)
//   5) 아이콘·스플래시(맘캘 아이콘, 보라 바탕) — ImageMagick
// 실패하면 exit 1 — 앵커를 못 찾았는데 그냥 넘어가면 「됐다고 보이는데 안 들어간」 앱이 나온다
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const AND = path.join(HERE, 'android');
const MAIN = path.join(AND, 'app', 'src', 'main');
const PKG_DIR = path.join(MAIN, 'java', 'com', 'wantsb', 'momcalendar');
const die = (m) => { console.error('🔴 ' + m); process.exit(1); };
if (!fs.existsSync(PKG_DIR)) die('앱 패키지 폴더 없음 — npx cap add android 먼저: ' + PKG_DIR);
const once = (s, a, b, name) => { const c = s.split(a).length - 1; if (c !== 1) die(`${name} 앵커 ${c}개`); return s.replace(a, () => b); };

// 1) 자바
for (const f of fs.readdirSync(path.join(HERE, 'native'))) fs.copyFileSync(path.join(HERE, 'native', f), path.join(PKG_DIR, f));
console.log('✔ 자바', fs.readdirSync(path.join(HERE, 'native')).join(', '));

// 2) 위젯 — TWA 설치기를 그대로 쓰되 경로·여는 화면만 바꾼다
execFileSync(process.execPath, [path.join(HERE, '..', 'widgets', 'install_widgets.mjs')], { stdio: 'inherit', env: { ...process.env, WIDGET_APP_MAIN: MAIN } });
{
  const wa = path.join(PKG_DIR, 'widget', 'WidgetAction.java');
  let s = fs.readFileSync(wa, 'utf8');
  s = once(s, '"com.wantsb.momcalendar.LauncherActivity"', '"com.wantsb.momcalendar.MainActivity"', '위젯 여는 화면');
  fs.writeFileSync(wa, s);
}

// 3) 매니페스트
const mfp = path.join(MAIN, 'AndroidManifest.xml');
let mf = fs.readFileSync(mfp, 'utf8');
const pk = (p) => `        <package android:name="${p}" />`;
const queries = `
    <queries>
${['com.nhn.android.search', 'com.nhn.android.navercafe', 'com.kakao.talk', 'com.instagram.android', 'com.coupang.mobile', 'viva.republica.toss', 'com.android.chrome', 'com.sec.android.app.sbrowser', 'com.microsoft.emmx', 'com.naver.whale', 'com.android.vending'].map(pk).join('\n')}
        <intent>
            <action android:name="android.intent.action.VIEW" />
            <category android:name="android.intent.category.BROWSABLE" />
            <data android:scheme="https" />
        </intent>
        <intent>
            <action android:name="android.support.customtabs.action.CustomTabsService" />
        </intent>
        <intent>
            <action android:name="android.intent.action.SEND" />
            <data android:mimeType="*/*" />
        </intent>
        <intent>
            <action android:name="android.intent.action.VIEW" />
            <data android:mimeType="text/calendar" />
        </intent>
    </queries>
`;
mf = once(mf, '<application', queries + '\n    <application', 'application');
// 앱 링크 — TWA(Bubblewrap)도 같은 것을 넣었다. .well-known/assetlinks.json 의 서명 지문으로 확인된다
const applink = `
            <intent-filter android:autoVerify="true">
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="https" android:host="momcalendar.com" />
            </intent-filter>
`;
mf = once(mf, '                <category android:name="android.intent.category.LAUNCHER" />\n            </intent-filter>\n',
  '                <category android:name="android.intent.category.LAUNCHER" />\n            </intent-filter>\n' + applink, '런처 필터');
mf = once(mf, '    </application>', `        <meta-data android:name="com.google.firebase.messaging.default_notification_icon" android:resource="@drawable/push_icon" />
        <meta-data android:name="com.google.firebase.messaging.default_notification_color" android:resource="@color/momcal_brand" />
    </application>`, '알림 아이콘');
fs.writeFileSync(mfp, mf);
console.log('✔ 매니페스트');

// 4) build.gradle
const bgp = path.join(AND, 'app', 'build.gradle');
let bg = fs.readFileSync(bgp, 'utf8');
const vc = String(process.env.VERSION_CODE || '');
if (!/^[1-9][0-9]*$/.test(vc)) die('VERSION_CODE 는 1 이상의 정수: ' + vc);
bg = bg.replace(/versionCode \d+/, `versionCode ${vc}`).replace(/versionName "[^"]*"/, `versionName "2.0.${vc}"`);
if (!bg.includes(`versionCode ${vc}`)) die('versionCode 못 바꿈');
bg = once(bg, '    implementation project(\':capacitor-android\')', '    implementation project(\':capacitor-android\')\n    implementation "androidx.browser:browser:1.8.0"', '의존성');
bg += `
// 서명 — 업로드 키(TWA 와 같은 키, 같은 패키지라 깔린 앱 위에 업데이트로 깔린다). 값은 CI 시크릿 → 환경변수
android {
    signingConfigs {
        release {
            storeFile file(System.getenv("KS_PATH") ?: "missing.p12")
            storePassword System.getenv("KS_PASS")
            keyAlias System.getenv("KS_ALIAS") ?: "momcal"
            keyPassword System.getenv("KEY_PASS")
            storeType "pkcs12"
        }
    }
    buildTypes { release { signingConfig signingConfigs.release } }
}
`;
fs.writeFileSync(bgp, bg);
console.log('✔ build.gradle versionCode', vc);

// 색
fs.writeFileSync(path.join(MAIN, 'res', 'values', 'momcal_colors.xml'), '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="momcal_brand">#602090</color>\n</resources>\n');
{
  const bgx = path.join(MAIN, 'res', 'values', 'ic_launcher_background.xml');
  if (fs.existsSync(bgx)) fs.writeFileSync(bgx, '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#602090</color>\n</resources>\n');
}

// 5) 아이콘·스플래시·알림 아이콘
const ROOT = path.resolve(HERE, '..', '..');
const ICON = path.join(ROOT, 'momcal-appicon.png'), BADGE = path.join(ROOT, 'momcal-badge.png');
if (!fs.existsSync(ICON) || !fs.existsSync(BADGE)) die('아이콘 원본 없음');
const im = (...a) => execFileSync('convert', a, { stdio: 'inherit' });
const D = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [d, k] of Object.entries(D)) {
  const dir = path.join(MAIN, 'res', 'mipmap-' + d);
  fs.mkdirSync(dir, { recursive: true });
  const n = Math.round(48 * k), fg = Math.round(108 * k);
  im(ICON, '-resize', `${n}x${n}`, path.join(dir, 'ic_launcher.png'));
  im(ICON, '-resize', `${n}x${n}`, path.join(dir, 'ic_launcher_round.png'));
  im(ICON, '-resize', `${fg}x${fg}`, path.join(dir, 'ic_launcher_foreground.png'));
  const dd = path.join(MAIN, 'res', 'drawable-' + d);
  fs.mkdirSync(dd, { recursive: true });
  im(BADGE, '-resize', `${Math.round(24 * k)}x${Math.round(24 * k)}`, path.join(dd, 'push_icon.png'));
}
// 스플래시: 보라 바탕 가운데 아이콘(템플릿의 Capacitor 로고 그림을 전부 바꾼다)
let nSplash = 0;
for (const dir of fs.readdirSync(path.join(MAIN, 'res'))) {
  const f = path.join(MAIN, 'res', dir, 'splash.png');
  if (!fs.existsSync(f)) continue;
  const [w, h] = execFileSync('identify', ['-format', '%w %h', f]).toString().trim().split(' ').map(Number);
  const s = Math.round(Math.min(w, h) * 0.28);
  im('-size', `${w}x${h}`, 'xc:#602090', '(', ICON, '-resize', `${s}x${s}`, ')', '-gravity', 'center', '-composite', f);
  nSplash++;
}
console.log('✔ 아이콘 · 스플래시', nSplash, '장');

// 6) 알림 설정 파일
if ((process.env.GOOGLE_SERVICES_JSON || '').trim()) {
  fs.writeFileSync(path.join(AND, 'app', 'google-services.json'), process.env.GOOGLE_SERVICES_JSON);
  console.log('✔ google-services.json (알림 켬)');
} else console.log('⚠ google-services.json 없음 — 알림은 꺼진 채로 빌드(앱이 pushReady=false 로 알려 사이트가 켜기를 부르지 않는다)');

// 7) 시험용 빌드: 웹뷰 원격 디버깅(에뮬레이터 자동 시험이 화면 속 자바스크립트를 부른다). 출시판에는 넣지 않는다
const cfgp = path.join(MAIN, 'assets', 'capacitor.config.json');
if (!fs.existsSync(cfgp)) die('assets/capacitor.config.json 없음 — npx cap sync 먼저');
const cfg = JSON.parse(fs.readFileSync(cfgp, 'utf8'));
cfg.android = { ...(cfg.android || {}), webContentsDebuggingEnabled: process.env.E2E === '1' };
// 시험용은 test.html 을 띄운다 — 라이브(index.html)에 올리기 전에 앱에서 먼저 굴려 본다(규칙 0-A)
if (process.env.E2E === '1' && process.env.E2E_URL) cfg.server = { ...(cfg.server || {}), url: process.env.E2E_URL };
fs.writeFileSync(cfgp, JSON.stringify(cfg, null, 2));
console.log('✔ 웹뷰 디버깅', cfg.android.webContentsDebuggingEnabled, '· 띄울 주소', cfg.server && cfg.server.url);
