-- 핫딜 링크·판매처 가드 (2026-11-04 사장님 「지마켓 구매하기 눌러도 반응 없다 · 온라인몰로 분류」)
-- 사고: 베이비핫딜 회차(claude -p)가 curl 응답 헤더(「HTTP/1.1 302…」)를 링크 칸에 넣은 7행 → 버튼 무반응, 판매처 「온라인몰」.
-- 어느 경로(회차·Edge 함수·사람)로 들어와도: ① 공백·줄바꿈이 든 링크는 받지 않는다(조용히 두지 않고 오류로 — 만드는 쪽이 바로 안다)
-- ② 판매처가 비었거나 「온라인몰」이면 링크, 그래도 모르면 제목 머리(「지마켓)」·「g마켓)」…)로 채운다 ③ 「롯데ON」은 「롯데온」으로 통일(사이트 필터는 「롯데」 포함으로 걸러 영향은 없었다)
create or replace function public.hotdeals_fill_mall() returns trigger language plpgsql as $$
begin
  if new.link is not null and new.link ~ '[[:space:]]' then
    raise exception '핫딜 링크에 공백·줄바꿈이 있다(curl 응답 헤더를 넣지 않았는지 확인): %', left(new.link, 80);
  end if;
  if new.mall is null or btrim(new.mall) = '' or new.mall = '온라인몰' then
    new.mall := case
      when new.link ilike '%coupang.com%' or new.link ilike '%coupa.ng%' then '쿠팡'
      when new.link ilike '%toss.im%' or new.link ilike '%toss.shopping%' then '토스쇼핑'
      when new.link ilike '%m=gmarket%' or new.link ilike '%gmarket.co.kr%' then '지마켓'
      when new.link ilike '%m=auction%' or new.link ilike '%auction.co.kr%' then '옥션'
      when new.link ilike '%m=11st%' or new.link ilike '%11st.co.kr%' then '11번가'
      when new.link ilike '%m=lotteon%' or new.link ilike '%lotteon.com%' then '롯데온'
      when new.link ilike '%m=emart%' or new.link ilike '%ssg.com%' then 'SSG'
      when new.link ilike '%m=boribori%' then '보리보리'
      when new.link ilike '%klook.com%' then '클룩'
      when new.link ilike '%ohou.se%' or new.link ilike '%ozip.me%' then '오늘의집'
      when new.link ilike '%naver.%' then '네이버'
      when new.title ~* '^\s*(지마켓|g마켓)\s*\)' then '지마켓'
      when new.title ~ '^\s*옥션\s*\)' then '옥션'
      when new.title ~ '^\s*11번가\s*\)' then '11번가'
      when new.title ~* '^\s*(쿠팡)\s*\)' then '쿠팡'
      when new.title ~* '^\s*ssg\s*\)' then 'SSG'
      else new.mall end;
  end if;
  if new.mall in ('롯데ON', '롯데on', '롯데On') then new.mall := '롯데온'; end if;
  return new;
end $$;
drop trigger if exists trg_hotdeals_fill_mall on public.hotdeals;
create trigger trg_hotdeals_fill_mall before insert or update of mall, link, title on public.hotdeals for each row execute function public.hotdeals_fill_mall();
update public.hotdeals set mall = '롯데온' where mall in ('롯데ON', '롯데on', '롯데On');
