#!/usr/bin/env python3
"""App Store Connect 스토어 등록 정보 읽기·수정 (2026-11-02, 사장님 「스토어 문구·사진·연락처 다 바꿔놔」)
  show                      수정 가능한 버전의 설명·키워드·사진·심사 연락처를 출력(읽기만)
  apply <plan.json>         plan 대로 수정 — 심사 제출은 절대 하지 않는다(준비 상태로만 둔다)
환경변수: asc.py 와 같다(APPLE_API_KEY_ID · APPLE_API_ISSUER_ID · APPLE_API_KEY_PATH)
"""
import hashlib, json, os, sys, urllib.request
sys.path.insert(0, os.path.dirname(__file__))
import asc
BUNDLE = 'com.wontsbe.momcalendar'
EDITABLE = ('PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED', 'METADATA_REJECTED', 'WAITING_FOR_REVIEW', 'INVALID_BINARY')


def app_id():
    return asc.call('GET', '/apps?filter[bundleId]=' + BUNDLE)['data'][0]['id']


def versions(aid):
    return asc.call('GET', '/apps/%s/appStoreVersions?limit=10' % aid)['data']


def show():
    aid = app_id(); print('app', aid)
    vs = versions(aid)
    for v in vs:
        print('version', v['id'], v['attributes']['versionString'], v['attributes']['appStoreState'])
    for v in vs:
        vid = v['id']; st = v['attributes']['appStoreState']
        print('\n=== 버전', v['attributes']['versionString'], st, vid)
        for L in asc.call('GET', '/appStoreVersions/%s/appStoreVersionLocalizations' % vid)['data']:
            a = L['attributes']; print('-- 지역', a['locale'], L['id'])
            for k in ('description', 'keywords', 'promotionalText', 'whatsNew', 'marketingUrl', 'supportUrl'):
                print('  [%s]' % k, (a.get(k) or '').replace('\n', ' ⏎ ')[:900])
            for S in asc.call('GET', '/appStoreVersionLocalizations/%s/appScreenshotSets' % L['id'])['data']:
                n = asc.call('GET', '/appScreenshotSets/%s/appScreenshots' % S['id'])['data']
                print('  사진묶음', S['attributes']['screenshotDisplayType'], S['id'], len(n), '장', [x['attributes']['fileName'] for x in n])
        try:
            r = asc.call('GET', '/appStoreVersions/%s/appStoreReviewDetail' % vid)['data']['attributes']
            print('  심사연락처', {k: r.get(k) for k in ('contactFirstName', 'contactLastName', 'contactPhone', 'contactEmail', 'demoAccountRequired')})
        except SystemExit:
            print('  심사연락처 없음')
    for I in asc.call('GET', '/apps/%s/appInfos' % aid)['data']:
        print('\n=== appInfo', I['id'], I['attributes'].get('appStoreState'))
        for L in asc.call('GET', '/appInfos/%s/appInfoLocalizations' % I['id'])['data']:
            a = L['attributes']; print('  ', a['locale'], L['id'], '이름:', a.get('name'), '/ 부제:', a.get('subtitle'), '/ 개인정보URL:', a.get('privacyPolicyUrl'))


def apply(plan):
    aid = app_id(); P = json.load(open(plan, encoding='utf-8'))
    vs = [v for v in versions(aid) if v['attributes']['appStoreState'] in EDITABLE]
    if not vs:
        print('🔴 수정 가능한 버전이 없다'); sys.exit(1)
    v = vs[0]; vid = v['id']; print('수정 대상 버전', v['attributes']['versionString'], v['attributes']['appStoreState'], vid)
    loc = asc.call('GET', '/appStoreVersions/%s/appStoreVersionLocalizations' % vid)['data']
    ko = next((x for x in loc if x['attributes']['locale'].startswith('ko')), loc[0])
    if P.get('version_loc'):
        asc.call('PATCH', '/appStoreVersionLocalizations/' + ko['id'], {'data': {'type': 'appStoreVersionLocalizations', 'id': ko['id'], 'attributes': P['version_loc']}})
        print('버전 문구 수정:', list(P['version_loc']))
    if P.get('app_info_loc'):
        for I in asc.call('GET', '/apps/%s/appInfos' % aid)['data']:
            for L in asc.call('GET', '/appInfos/%s/appInfoLocalizations' % I['id'])['data']:
                if L['attributes']['locale'].startswith('ko'):
                    asc.call('PATCH', '/appInfoLocalizations/' + L['id'], {'data': {'type': 'appInfoLocalizations', 'id': L['id'], 'attributes': P['app_info_loc']}})
                    print('앱 정보 수정:', list(P['app_info_loc']), I['attributes'].get('appStoreState'))
    if P.get('review'):
        rid = asc.call('GET', '/appStoreVersions/%s/appStoreReviewDetail' % vid)['data']['id']
        asc.call('PATCH', '/appStoreReviewDetails/' + rid, {'data': {'type': 'appStoreReviewDetails', 'id': rid, 'attributes': P['review']}})
        print('심사 연락처 수정:', list(P['review']))
    for spec in P.get('screenshots', []):   # {display: APP_IPHONE_67, files:[경로…]} — 그 묶음의 기존 사진을 지우고 새로 올린다
        sets = asc.call('GET', '/appStoreVersionLocalizations/%s/appScreenshotSets' % ko['id'])['data']
        S = next((x for x in sets if x['attributes']['screenshotDisplayType'] == spec['display']), None)
        if not S:
            S = asc.call('POST', '/appScreenshotSets', {'data': {'type': 'appScreenshotSets', 'attributes': {'screenshotDisplayType': spec['display']},
                 'relationships': {'appStoreVersionLocalization': {'data': {'type': 'appStoreVersionLocalizations', 'id': ko['id']}}}}})['data']
        for old in asc.call('GET', '/appScreenshotSets/%s/appScreenshots' % S['id'])['data']:
            asc.call('DELETE', '/appScreenshots/' + old['id'])
        for path in spec['files']:
            data = open(path, 'rb').read()
            res = asc.call('POST', '/appScreenshots', {'data': {'type': 'appScreenshots', 'attributes': {'fileName': os.path.basename(path), 'fileSize': len(data)},
                 'relationships': {'appScreenshotSet': {'data': {'type': 'appScreenshotSets', 'id': S['id']}}}}})
            sid = res['data']['id']
            for op in res['data']['attributes']['uploadOperations']:
                req = urllib.request.Request(op['url'], data=data[op['offset']:op['offset'] + op['length']], method=op['method'],
                                             headers={h['name']: h['value'] for h in op.get('requestHeaders', [])})
                urllib.request.urlopen(req).read()
            asc.call('PATCH', '/appScreenshots/' + sid, {'data': {'type': 'appScreenshots', 'id': sid, 'attributes': {'uploaded': True, 'sourceFileChecksum': hashlib.md5(data).hexdigest()}}})
        print('사진 교체', spec['display'], len(spec['files']), '장')
    print('✅ 끝 — 심사 제출은 하지 않았다')


if __name__ == '__main__':
    if sys.argv[1] == 'show':
        show()
    elif sys.argv[1] == 'apply':
        apply(sys.argv[2])
    else:
        print(__doc__)
