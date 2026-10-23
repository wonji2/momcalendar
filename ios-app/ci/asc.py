#!/usr/bin/env python3
"""App Store Connect API 도우미 — iOS CI 서명용 (2026-10-23)

흐름(ios-app/ci/testflight.sh 가 부른다):
  1) 러너에서 RSA 키·CSR 을 만들고   → `create-cert <csr.pem>`  : Apple Distribution 인증서 발급(DER 를 <out>.cer 로)
  2) `bundle-id <identifier>`         : 번들 ID 리소스 id
  3) `create-profile <bundleIdResId> <certId> <name> <out.mobileprovision>` : App Store 프로파일 발급·내려받기
  4) 빌드·업로드 뒤 `delete-profile <id>` · `delete-cert <id>` 로 **그 회차 것만** 지운다(인증서 한도 3개)
왜 이렇게 하나: 자동 서명(archive)은 개발용 프로파일을 쓰는데 팀에 등록된 기기가 0대라 못 만든다(run #50).
  Apple Distribution 을 자동 서명에 억지로 넣으면 「conflicting provisioning settings」(run #51·#52).
  → 수동 서명 + 회차마다 쓰고 버리는 배포 인증서. 비밀은 GitHub Secrets 의 API 키 4개뿐.
환경변수: APPLE_API_KEY_ID · APPLE_API_ISSUER_ID · APPLE_API_KEY_PATH(.p8 경로)
"""
import base64, json, os, sys, time, urllib.request, urllib.error

API = 'https://api.appstoreconnect.apple.com/v1'


def token():
    import jwt  # pyjwt + cryptography
    key = open(os.environ['APPLE_API_KEY_PATH']).read()
    now = int(time.time())
    return jwt.encode({'iss': os.environ['APPLE_API_ISSUER_ID'], 'iat': now, 'exp': now + 900,
                       'aud': 'appstoreconnect-v1'}, key, algorithm='ES256',
                      headers={'kid': os.environ['APPLE_API_KEY_ID'], 'typ': 'JWT'})


def call(method, path, body=None):
    req = urllib.request.Request(API + path, method=method,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={'Authorization': 'Bearer ' + token(),
                                          'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        sys.stderr.write('🔴 %s %s → %s %s\n' % (method, path, e.code, e.read().decode()[:800]))
        sys.exit(1)


def main():
    cmd, a = sys.argv[1], sys.argv[2:]
    if cmd == 'create-cert':  # a: csr.pem, out.cer
        csr = open(a[0]).read()
        csr = csr.replace('-----BEGIN CERTIFICATE REQUEST-----', '').replace('-----END CERTIFICATE REQUEST-----', '').strip()
        d = call('POST', '/certificates', {'data': {'type': 'certificates', 'attributes': {
            'certificateType': 'DISTRIBUTION', 'csrContent': csr}}})['data']
        open(a[1], 'wb').write(base64.b64decode(d['attributes']['certificateContent']))
        print(d['id'])
    elif cmd == 'bundle-id':  # a: identifier
        d = call('GET', '/bundleIds?filter[identifier]=' + a[0])['data']
        if not d:
            sys.stderr.write('🔴 bundle id 없음: %s\n' % a[0]); sys.exit(1)
        print(d[0]['id'])
    elif cmd == 'create-profile':  # a: bundleIdResId, certId, name, out.mobileprovision
        d = call('POST', '/profiles', {'data': {'type': 'profiles',
            'attributes': {'name': a[2], 'profileType': 'IOS_APP_STORE'},
            'relationships': {'bundleId': {'data': {'type': 'bundleIds', 'id': a[0]}},
                              'certificates': {'data': [{'type': 'certificates', 'id': a[1]}]}}}})['data']
        open(a[3], 'wb').write(base64.b64decode(d['attributes']['profileContent']))
        print(d['id'])
    elif cmd == 'delete-profile':
        call('DELETE', '/profiles/' + a[0]); print('profile 삭제', a[0])
    elif cmd == 'delete-cert':
        call('DELETE', '/certificates/' + a[0]); print('cert 삭제', a[0])
    elif cmd == 'list':
        for c in call('GET', '/certificates')['data']:
            print('cert', c['id'], c['attributes']['certificateType'], c['attributes']['name'])
        for p in call('GET', '/profiles')['data']:
            print('profile', p['id'], p['attributes']['name'], p['attributes']['profileState'])
    else:
        sys.stderr.write(__doc__); sys.exit(2)


if __name__ == '__main__':
    main()
