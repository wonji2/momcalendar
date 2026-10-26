# App Review 회신을 App Store Connect API 로 (웹 로그인 없이) — 2026-10-26
#   python review_reply.py notes <버전id> <메모.txt>      앱 심사 정보 > 메모(notes) 를 바꾼다
#   python review_reply.py attach <버전id> <영상.mp4>     앱 심사 정보에 첨부 파일(화면 녹화)을 올린다
#   python review_reply.py build <버전id> <빌드번호>       그 버전에 쓸 빌드를 바꾼다(VALID 인 것만)
#   python review_reply.py submit <앱id>                   심사에 다시 낸다(기존 제출을 다시 submitted 로)
#   python review_reply.py cancel <앱id>                   심사 대기 중인 제출 취소(빌드 바꾸기 전)
#   python review_reply.py resubmit <앱id> <버전id>        취소 뒤 새 제출 만들어 내기
#   ⚠ 2026-10-26 실측: 반려(UNRESOLVED_ISSUES) 제출은 빌드를 바꾸면 API 로 다시 못 낸다(「Version is not ready」).
#     → 새 reviewSubmission 을 만들고, 옛 제출을 canceled:true 로 닫은 뒤(20초쯤 걸림), 새 제출에 버전을 넣고 submitted:true. 그렇게 해서 WAITING_FOR_REVIEW 가 됐다.
#   환경변수: APPLE_API_KEY_ID · APPLE_API_ISSUER_ID · APPLE_API_KEY_PATH (asc.py 와 같다)
import hashlib, json, os, sys, urllib.request
sys.path.insert(0, os.path.dirname(__file__))
import asc

def review_detail(ver):
    r = asc.call('GET', f'/appStoreVersions/{ver}/appStoreReviewDetail')
    return r['data']['id'], r['data']['attributes']

cmd, a = sys.argv[1], sys.argv[2:]
if cmd == 'notes':
    rid, at = review_detail(a[0])
    notes = open(a[1], encoding='utf-8').read().strip()
    asc.call('PATCH', f'/appStoreReviewDetails/{rid}', {'data': {'type': 'appStoreReviewDetails', 'id': rid, 'attributes': {'notes': notes}}})
    print('notes ok', len(notes), 'chars')
elif cmd == 'attach':
    rid, _ = review_detail(a[0])
    path = a[1]; data = open(path, 'rb').read()
    res = asc.call('POST', '/appStoreReviewAttachments', {'data': {'type': 'appStoreReviewAttachments',
        'attributes': {'fileName': os.path.basename(path), 'fileSize': len(data)},
        'relationships': {'appStoreReviewDetail': {'data': {'type': 'appStoreReviewDetails', 'id': rid}}}}})
    att = res['data']['id']
    for op in res['data']['attributes']['uploadOperations']:
        chunk = data[op['offset']:op['offset'] + op['length']]
        req = urllib.request.Request(op['url'], data=chunk, method=op['method'],
                                     headers={h['name']: h['value'] for h in op.get('requestHeaders', [])})
        with urllib.request.urlopen(req) as r: pass
    asc.call('PATCH', f'/appStoreReviewAttachments/{att}', {'data': {'type': 'appStoreReviewAttachments', 'id': att,
        'attributes': {'uploaded': True, 'sourceFileChecksum': hashlib.md5(data).hexdigest()}}})
    st = asc.call('GET', f'/appStoreReviewAttachments/{att}')['data']['attributes']
    print('attach', att, st.get('assetDeliveryState'))
elif cmd == 'build':
    ver, num = a
    app = asc.call('GET', f'/appStoreVersions/{ver}?include=app')['data']['relationships']['app']['data']['id']
    b = asc.call('GET', f'/builds?filter[app]={app}&filter[version]={num}&limit=1')['data']
    if not b or b[0]['attributes']['processingState'] != 'VALID': print('build not ready', b and b[0]['attributes']['processingState']); sys.exit(2)
    asc.call('PATCH', f'/appStoreVersions/{ver}/relationships/build', {'data': {'type': 'builds', 'id': b[0]['id']}})
    print('build set', num)
elif cmd == 'cancel':  # a: app id — 심사 대기 중인 제출을 취소한다(빌드를 바꾸려면 먼저 취소, 2026-10-27)
    subs = asc.call('GET', f'/reviewSubmissions?filter[app]={a[0]}&limit=5')['data']
    s2 = [x for x in subs if x['attributes'].get('state') in ('WAITING_FOR_REVIEW', 'IN_REVIEW', 'UNRESOLVED_ISSUES', 'READY_FOR_REVIEW')]
    if not s2: print('no submission to cancel', [x['attributes'].get('state') for x in subs]); sys.exit(2)
    r = asc.call('PATCH', f"/reviewSubmissions/{s2[0]['id']}", {'data': {'type': 'reviewSubmissions', 'id': s2[0]['id'], 'attributes': {'canceled': True}}})
    print('canceled', s2[0]['id'], r['data']['attributes'].get('state'))
elif cmd == 'resubmit':  # a: app id, version id — 새 제출을 만들어 그 버전을 넣고 낸다(취소 뒤)
    app, ver = a
    sub = asc.call('POST', '/reviewSubmissions', {'data': {'type': 'reviewSubmissions', 'attributes': {'platform': 'IOS'},
        'relationships': {'app': {'data': {'type': 'apps', 'id': app}}}}})['data']
    asc.call('POST', '/reviewSubmissionItems', {'data': {'type': 'reviewSubmissionItems',
        'relationships': {'reviewSubmission': {'data': {'type': 'reviewSubmissions', 'id': sub['id']}},
                          'appStoreVersion': {'data': {'type': 'appStoreVersions', 'id': ver}}}}})
    r = asc.call('PATCH', f"/reviewSubmissions/{sub['id']}", {'data': {'type': 'reviewSubmissions', 'id': sub['id'], 'attributes': {'submitted': True}}})
    print('resubmitted', sub['id'], r['data']['attributes'].get('state'))
elif cmd == 'submit':
    app = a[0]
    subs = asc.call('GET', f'/reviewSubmissions?filter[app]={app}&limit=5')['data']
    s = [x for x in subs if x['attributes'].get('state') in ('UNRESOLVED_ISSUES', 'READY_FOR_REVIEW')]
    if not s: print('no open submission', [x['attributes'].get('state') for x in subs]); sys.exit(2)
    r = asc.call('PATCH', f"/reviewSubmissions/{s[0]['id']}", {'data': {'type': 'reviewSubmissions', 'id': s[0]['id'], 'attributes': {'submitted': True}}})
    print('submitted', r['data']['attributes'].get('state'))
