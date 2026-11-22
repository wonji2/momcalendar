# 맘캘린더 외부 감시 워커

깃허브와 무관하게 5분마다 라이브를 확인하고, 이상하면 텔레그램으로 알린다.

## 한 번만 (Cloudflare 로그인 필요 — 자비스는 대신 못 한다)
    npm i -g wrangler
    wrangler login
    cd tools/cf-healthcheck-worker
    wrangler kv namespace create STATE      # 나온 id 를 wrangler.toml 에 붙인다
    wrangler secret put TELEGRAM_BOT_TOKEN  # 봇 토큰
    wrangler secret put TELEGRAM_CHAT_ID    # 받을 방/대화 id
    wrangler deploy

## 확인
    curl https://momcal-healthcheck.<서브도메인>.workers.dev/   # {"ok": true, "bad": []} 면 정상
    wrangler tail                                              # 예약 실행 로그

## 끄기
    wrangler delete
