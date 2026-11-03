#!/usr/bin/env python3
"""애플 심사 상태 감시 — 메일 대신 App Store Connect API 로 본다 (2026-11-03 사장님 「애플 메일 귀찮게 하지 말고 알아서 봐」)
애플 메일은 카카오메일로만 와서 지메일 커넥터로 못 읽는다 → 상태가 바뀌면 health_alerts(kind 'ios-review')에 한 줄 남긴다(ops.html·admin 홈).
실행: ios-review-watch.yml(3시간마다, PC 와 무관). 환경: APPLE_API_* + SB_SERVICE_KEY. 상태가 같으면 아무것도 안 쓴다.
한계: 반려 사유 원문은 API 로 못 읽는다(App Review 화면에만 있다) — 상태가 REJECTED/UNRESOLVED_ISSUES 면 사장님·내가 화면에서 본다."""
import json, os, sys, urllib.request
sys.path.insert(0, os.path.dirname(__file__))
import asc

SB = 'https://hycaqsqeogjtbscmzrtm.supabase.co/rest/v1/health_alerts'
KEY = os.environ.get('SB_SERVICE_KEY', '')
H = {'apikey': KEY, 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json'}


def sb(method, path='', body=None):
    req = urllib.request.Request(SB + path, method=method, headers={**H, 'Prefer': 'return=minimal'},
                                 data=json.dumps(body).encode() if body is not None else None)
    with urllib.request.urlopen(req) as r:
        raw = r.read()
        return json.loads(raw) if raw and method == 'GET' else None


def main():
    aid = asc.call('GET', '/apps?filter[bundleId]=com.wontsbe.momcalendar')['data'][0]['id']
    vs = asc.call('GET', '/apps/%s/appStoreVersions?limit=5' % aid)['data']
    parts = ['%s %s' % (v['attributes']['versionString'], v['attributes']['appStoreState']) for v in vs]
    subs = asc.call('GET', '/apps/%s/reviewSubmissions?filter[platform]=IOS&limit=5' % aid)['data']
    parts += ['제출 %s' % s['attributes'].get('state') for s in subs if s['attributes'].get('state') not in ('COMPLETE',)]
    now = ' · '.join(parts)
    print('현재:', now)
    if not KEY:
        print('SB_SERVICE_KEY 없음 — 기록 생략'); return
    last = sb('GET', "?kind=eq.ios-review&order=id.desc&limit=1&select=detail")
    if last and last[0]['detail'] == now:
        print('바뀐 것 없음'); return
    sb('POST', '', {'kind': 'ios-review', 'detail': now})
    print('🔔 상태 바뀜 → health_alerts 기록')


if __name__ == '__main__':
    main()
