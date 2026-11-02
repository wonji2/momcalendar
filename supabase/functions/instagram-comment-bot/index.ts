// 📸 맘캘린더 인스타그램 댓글 자동 답글봇 (Instagram Graph API Webhook)
//   @momcal_official 계정 고유의 말투와 양식(💜, .ᐟ.ᐟ, 친근한 경어체)을 100% 학습 반영한 버전.
//
//   손님이 인스타 릴스/피드에 "OO 공구 있나요?", "OO 언제해요?", "OO요ㅜㅜ" 댓글을 남기면:
//   1) 댓글에서 브랜드/상품명 추출
//   2) Supabase gonggu / hotdeals DB 실시간 검색
//   3) @momcal_official 고유 스타일의 맞춤형 대댓글 자동 등록

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const SB = Deno.env.get("SUPABASE_URL") || "https://hycaqsqeogjtbscmzrtm.supabase.co";
const KEY = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SB_PUBLISHABLE_KEY") || "sb_publishable_u4hR4mdNTSss3kdjFH6R5Q_iuJ2MuGE";
const SITE = "https://momcalendar.com";

const VERIFY_TOKEN = Deno.env.get("INSTAGRAM_VERIFY_TOKEN") || "momcal_insta_verify_2026";
const IG_ACCESS_TOKEN = Deno.env.get("INSTAGRAM_ACCESS_TOKEN") || "";
const IG_ACCOUNT_ID = Deno.env.get("INSTAGRAM_ACCOUNT_ID") || ""; // 맘캘린더 공식 계정 ID (루프 방지)

const COLS = "id,name,influencer,insta,open_date,end_date,pay_link";

// Supabase REST query 헬퍼
async function q(path: string) {
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
  return r.ok ? await r.json() : [];
}

// 손님들의 실제 댓글 유형에 맞춘 불용어/말끝 제거 규칙
// (예: "엉파 공구중인곳 있나요??", "두리수전이요ㅜㅜㅜ", "아보드 밥솥캐리어요ㅜㅜ", "엔퍼센트 알려주세요")
const TAILS = [
  /(?:[?？!！~.,ㅋㅎㅠㅜ\s]|z{2,}|Z{2,})+$/,
  /(뭐|머|모)\s*(있|잇|읻)(어요|어|엉|음|나요|나|니|냐고|냐)?$/,
  /(있|잇|읻)(어요|어|엉|음|나요|나|니|냐고|냐|는지)?$/,
  /(없|업)(어요|어|엉|음|나요|나|니)?$/,
  /(있|잇|읻|없|업)을까(요|용|나)?$/,
  /(파는|사는)\s*(데|곳)(가|이|는|은)?$/,
  /공구\s*(중인\s*곳|하는\s*곳|일정|언제|있나|있나요|하나|하나요|해요)?$/,
  /알려\s*(주세요|주라|줄래|줘|죠|줭)?$/,
  /언제\s*(해요|해용|하나요|하나|한대요|한대|함|해|야)?$/,
  /부탁\s*(드려요|드립니다|해요)?$/,
  /(궁금해요|궁금해|궁금합니다|알고싶어요|사고싶어요)$/,
  /(안보여요|안보여|어디있나요)$/,
  /(이요|에요|예요|요)$/,
  /공구$/,
];

function extractKeyword(text: string): string {
  let cleaned = text.trim();
  // 머리 인사말 및 접속사 제거
  cleaned = cleaned.replace(/^(안녕하세요|안녕|하이|반가워요|혹시)[\s,.!~]*/i, "");
  // 말끝 제거 루프
  let prev = "";
  while (prev !== cleaned) {
    prev = cleaned;
    for (const re of TAILS) {
      cleaned = cleaned.replace(re, "").trim();
    }
  }
  return cleaned.trim();
}

// 날짜 포맷 (M월 D일)
function formatDate(dStr: string): string {
  if (!dStr) return "";
  const parts = dStr.split("-");
  if (parts.length === 3) {
    return `${parseInt(parts[1], 10)}월 ${parseInt(parts[2], 10)}일`;
  }
  return dStr;
}

// 가격 포맷
function won(n: number | string): string {
  const num = Number(n);
  return isNaN(num) ? String(n) : num.toLocaleString("ko-KR") + "원";
}

// 맘캘린더 공구 및 핫딜 검색
async function searchMomcal(keyword: string) {
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  if (!keyword || keyword.length < 2) return null;

  // 1. 공구 검색 (진행 중이거나 예정된 공구 우선)
  const encodedKw = encodeURIComponent(`%${keyword}%`);
  const gonggus = await q(
    `gonggu?select=${COLS}&approved=eq.true&name=ilike.${encodedKw}&end_date=gte.${today}&order=open_date.asc&limit=3`
  );

  if (Array.isArray(gonggus) && gonggus.length > 0) {
    return { type: "gonggu", item: gonggus[0], count: gonggus.length };
  }

  // 2. 핫딜 검색 (공구가 없으면 최저가 핫딜 확인)
  const hotdeals = await q(
    `hotdeals?select=id,title,price,price_before,mall,link&title=ilike.${encodedKw}&order=id.desc&limit=1`
  );

  if (Array.isArray(hotdeals) && hotdeals.length > 0) {
    return { type: "hotdeal", item: hotdeals[0] };
  }

  return null;
}

// 인스타그램 Graph API 대댓글 발송
async function replyToComment(commentId: string, message: string) {
  if (!IG_ACCESS_TOKEN) {
    console.warn("[IG_BOT] INSTAGRAM_ACCESS_TOKEN is not configured. Reply message:", message);
    return false;
  }

  const url = `https://graph.facebook.com/v21.0/${commentId}/replies`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${IG_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message }),
  });

  const data = await res.json();
  if (!res.ok) {
    console.error("[IG_BOT] Error replying to comment:", data);
    return false;
  }
  console.log("[IG_BOT] Successfully replied to comment", commentId, data);
  return true;
}

serve(async (req: Request) => {
  const url = new URL(req.url);

  // 1. Meta Webhook URL Verification (GET)
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log("[IG_BOT] Webhook verified successfully");
      return new Response(challenge, { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }

  // 2. Webhook Event Received (POST)
  if (req.method === "POST") {
    try {
      const body = await req.json();

      if (body.object === "instagram") {
        for (const entry of body.entry || []) {
          for (const change of entry.changes || []) {
            if (change.field === "comments") {
              const val = change.value;
              const commentId = val?.id;
              const text = String(val?.text || "").trim();
              const from = val?.from;
              const username = from?.username || "고객";
              const fromId = from?.id;

              // 봇 자신의 댓글이거나 부모 댓글이 없는 경우 등 루프 방지
              if (IG_ACCOUNT_ID && fromId === IG_ACCOUNT_ID) {
                continue;
              }

              // 상품명/키워드 추출
              const kw = extractKeyword(text);
              if (!kw || kw.length < 2) {
                continue;
              }

              // DB 검색
              const searchResult = await searchMomcal(kw);
              let replyMsg = "";

              // 💜 @momcal_official 오피셜 계정 고유의 말투 및 양식 반영
              if (searchResult?.type === "gonggu") {
                const g = searchResult.item;
                const openD = formatDate(g.open_date);
                const endD = formatDate(g.end_date);
                const seller = g.influencer || (g.insta ? `@${g.insta}` : "공구 셀러");
                const dateStr = openD === endD ? `${openD}` : `${openD}~${endD}`;

                replyMsg = `@${username} 님! 문의주신 '${g.name}' 공구는 ${dateStr}에 ${seller} 님을 통해 진행 예정이에요 💜 전체 일정과 상세 정보는 프로필 링크 맘캘린더 웹사이트에서 바로 확인하실 수 있어요.ᐟ.ᐟ ✨`;
              } else if (searchResult?.type === "hotdeal") {
                const hd = searchResult.item;
                const priceStr = hd.price ? ` (${won(hd.price)})` : "";
                replyMsg = `@${username} 님! '${kw}' 공구 일정은 현재 없지만, 최저가 핫딜${priceStr}이 지금 떠 있어요 🔥 프로필 링크 맘캘린더 핫딜 탭에서 확인해 보세요 💜`;
              } else {
                replyMsg = `@${username} 님! 찾으시는 '${kw}' 공구는 현재 등록된 일정이 아직 없어요 🥺 맘캘린더 웹사이트(프로필 링크)에서 '${kw}' 키워드 알림을 켜두시면 오픈되는 즉시 알림으로 바로 알려드릴게요 💜`;
              }

              // 대댓글 발송
              await replyToComment(commentId, replyMsg);
            }
          }
        }
      }

      return new Response(JSON.stringify({ status: "ok" }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    } catch (err) {
      console.error("[IG_BOT] Error handling webhook:", err);
      return new Response(JSON.stringify({ error: String(err) }), {
        headers: { "Content-Type": "application/json" },
        status: 500,
      });
    }
  }

  return new Response("Method Not Allowed", { status: 405 });
});
