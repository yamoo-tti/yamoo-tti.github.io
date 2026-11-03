-- 2026-11-03 스마트스토어 상품 등록 + 순금선물(gift) 종류 추가
--  가격: 순금 24K = 순금 살 때 시세(g당) × 중량 + 공임 / 실버 925 = 은 살 때 시세(g당) × 중량 + 공임
--        공임 기본값: 순금 1돈(3.75g)당 5만원 / 실버는 스마트스토어 가격에 맞춤 (관리자 > 상품 관리에서 상품마다 바꿀 수 있음)
--  여러 번 실행해도 같은 상품이 두 번 들어가지 않아요.

-- 1) 종류·함량·분류 늘리기
alter table public.products drop constraint if exists products_kind_check;
alter table public.products add constraint products_kind_check check (kind in ('bar','zodiac','silver','accessory','gift'));
alter table public.products drop constraint if exists products_karat_check;
alter table public.products add constraint products_karat_check check (karat in ('24K','18K','14K','SV'));
alter table public.products drop constraint if exists products_category_check;
alter table public.products add constraint products_category_check check (category in ('necklace','ring','bracelet','earring','dol','key','memo','goods'));

-- 2) 가격 계산 (common.js productPrice 와 같은 식)
create or replace function public.quote_price(p public.products)
returns numeric language plpgsql stable security definer set search_path = public as $$
declare
  s public.price_settings;
  au numeric; ag numeric; don numeric; buy numeric; sell numeric; f numeric;
begin
  select * into s from public.price_settings where id = 1;
  select krw_per_oz into au from public.live_prices where symbol = 'XAU' and fetched_at > now() - interval '10 minutes';
  select krw_per_oz into ag from public.live_prices where symbol = 'XAG' and fetched_at > now() - interval '10 minutes';
  if p.kind = 'silver' or (p.kind in ('accessory','gift') and p.karat = 'SV') then
    if ag is null then return null; end if;
    don := ag / 31.1034768 * 3.75;
    buy := round(don * (1 + s.ag_buy_pct / 100) * 1.1 / 10) * 10;
    if p.kind = 'silver' then
      return round(buy / 3.75 * p.weight_g * (1 + p.premium_pct / 100) / 100) * 100;
    end if;
    return round((buy / 3.75 * p.weight_g + p.labor) / 1000) * 1000;
  end if;
  if au is null then return null; end if;
  don := au / 31.1034768 * 3.75;
  buy := round(don * (1 + s.gold_buy_pct / 100) * 1.1 / 100) * 100;
  if p.kind in ('accessory','gift') then
    if p.karat = '24K' then
      return round((buy / 3.75 * p.weight_g + p.labor) / 1000) * 1000;
    end if;
    f := case p.karat when '18K' then s.k18_factor when '14K' then s.k14_factor else 1 end;
    sell := round(don * (1 + s.gold_sell_pct / 100) * f / 100) * 100;
    return round((sell / 3.75 * 1.3 * p.weight_g + p.labor) / 1000) * 1000;
  end if;
  return round(buy / 3.75 * p.weight_g * (1 + p.premium_pct / 100) / 100) * 100;
end $$;
revoke all on function public.quote_price(public.products) from public, anon, authenticated;

-- 3) 예시 악세사리 8개 숨기기 (주문 기록이 있을 수 있어 지우지 않음)
update public.products set visible = false
 where kind = 'accessory' and img in ('necklace-oval.jpg','ring-mirror.jpg','bracelet-chain.jpg','earring-hoop.jpg','pendant.jpg','ring-box.jpg','bracelet-charm.jpg','necklace-blazer.jpg');

-- 4) 스마트스토어 상품 + 순금선물 상품 등록 (중량을 몰라 숨긴 상품은 관리자에서 중량 입력 후 노출)
insert into public.products (kind, name, weight_g, karat, category, labor, img, sort, visible)
select v.kind, v.name, v.weight_g, v.karat, v.category, v.labor, v.img, v.sort, v.visible from (values
  ('accessory', '실버 호랑이 체인 팔찌[104g]', 104, 'SV', 'bracelet', 1020000, 'store/13629517763.jpg', 10, true),
  ('accessory', '호랑이 실버팔찌[60g]', 60, 'SV', 'bracelet', 706000, 'store/13629463109.jpg', 20, true),
  ('accessory', '실버 체인형 팔찌[44.16g]', 44.16, 'SV', 'bracelet', 604000, 'store/13627404766.jpg', 30, true),
  ('accessory', '오닉스,말라카이트,호안석 비휴팔찌 [24k 3.75g]', 3.75, '24K', 'bracelet', 50000, 'store/12612321775.jpg', 40, true),
  ('gift', '콩알금 24K (3.75g)99.9%', 3.75, '24K', 'goods', 50000, 'store/12553693981.jpg', 50, true),
  ('accessory', '순금별빛 매듭팔찌(3.75g)', 3.75, '24K', 'bracelet', 50000, 'store/11928380767.jpg', 60, true),
  ('accessory', '불교실버 925%팔찌', 3.75, 'SV', 'bracelet', 520000, 'store/11217424917.jpg', 70, false),
  ('accessory', '순금24k 물고기 2마리 반지[3.75g]', 3.75, '24K', 'ring', 50000, 'store/10390050931.jpg', 80, true),
  ('accessory', '순금 네잎클로버 목걸이(18.75g)', 18.75, '24K', 'necklace', 250000, 'store/10249493147.jpg', 90, true),
  ('gift', '순금 행운의 2달러 골드바 카드(1g)', 1, '24K', 'goods', 13000, 'store/10194404877.jpg', 100, true),
  ('accessory', '불교 은 팔찌925 실버팔찌(56g)', 56, 'SV', 'bracelet', 815000, 'store/9975131236.jpg', 110, true),
  ('accessory', '은팔찌925', 3.75, 'SV', 'bracelet', 730000, 'store/9825595426.jpg', 120, false),
  ('accessory', '24K 순금 체인 반지( 3.75g)', 3.75, '24K', 'ring', 50000, 'store/8879301645.jpg', 130, true),
  ('accessory', '여성용 순금 나비 팔찌[18.75g]', 18.75, '24K', 'bracelet', 250000, 'store/8873517720.jpg', 140, true),
  ('accessory', '여성용 순금 돌 고래 팔찌 [11.25g]', 11.25, '24K', 'bracelet', 150000, 'store/8867686341.jpg', 150, true),
  ('accessory', '여성용 순금 팔찌 [18.75g]', 18.75, '24K', 'bracelet', 250000, 'store/8849581195.jpg', 160, true),
  ('accessory', '24k 일체형 순금 목걸이[11.25g]', 11.25, '24K', 'necklace', 150000, 'store/8835558328.jpg', 170, true),
  ('accessory', '24k 순금 목걸이 [클로버]18.75g', 18.75, '24K', 'necklace', 250000, 'store/8835456108.jpg', 180, true),
  ('accessory', '24k 순금 목걸이 [클로버]11.25g', 11.25, '24K', 'necklace', 150000, 'store/8829597963.jpg', 190, true),
  ('accessory', '24k 레이스 순금 하트 반지( 3.75g)', 3.75, '24K', 'ring', 50000, 'store/8784171099.jpg', 200, true),
  ('accessory', '24K 순금 체인 반지( 3.75g)', 3.75, '24K', 'ring', 50000, 'store/8772509876.jpg', 210, true),
  ('accessory', '24K 순금 말 발굽 반지( 3.75g)', 3.75, '24K', 'ring', 50000, 'store/8772470772.jpg', 220, true),
  ('accessory', '24k 순금 H 이니셜 반지(3.75g)', 3.75, '24K', 'ring', 50000, 'store/8752520836.jpg', 230, true),
  ('accessory', '24k 순금 레이어드샹달 반지(3.75', 3.75, '24K', 'ring', 50000, 'store/8697754374.jpg', 240, true),
  ('accessory', '골드랑24k 말 발굽 순금반지(3.75g)', 3.75, '24K', 'ring', 50000, 'store/8602585859.jpg', 250, true),
  ('accessory', '24k 순금 돌고래 큐 꼬리 목걸이(7.5g)', 7.5, '24K', 'necklace', 100000, 'store/8566623382.jpg', 260, true),
  ('accessory', '순금 곰돌이 목걸이(7.5g)', 7.5, '24K', 'necklace', 100000, 'store/8560619430.jpg', 270, true),
  ('accessory', '사랑스런 곰돌이 페던트 목걸이(7.5g)', 7.5, '24K', 'necklace', 100000, 'store/8555456943.jpg', 280, true),
  ('accessory', '24k 순금 돌고래 루비 꼬리 목걸이(7.5g)', 7.5, '24K', 'necklace', 100000, 'store/8555309654.jpg', 290, true),
  ('accessory', '24k 순금 토끼 목걸이 (7.5g)', 7.5, '24K', 'necklace', 100000, 'store/8555182558.jpg', 300, true),
  ('accessory', '순금 곰돌이 목걸이 (7.5g)', 7.5, '24K', 'necklace', 100000, 'store/8555060851.jpg', 310, true),
  ('accessory', '24k 순금 돌고래 꼬리 목걸이 무광(7.5g)', 7.5, '24K', 'necklace', 100000, 'store/8554874616.jpg', 320, true),
  ('accessory', '계묘년 순금 토끼 목걸이(7.5g)', 7.5, '24K', 'necklace', 100000, 'store/8550765809.jpg', 330, true),
  ('accessory', '24k 순금 토끼 목걸이(7.5g)', 7.5, '24K', 'necklace', 100000, 'store/8550620769.jpg', 340, true),
  ('accessory', '여자 순금 여우 목걸이 (7.5g)', 7.5, '24K', 'necklace', 100000, 'store/8537007342.jpg', 350, true),
  ('accessory', '24k 순금 돌고래 꼬리 목걸이(7.5g)', 7.5, '24K', 'necklace', 100000, 'store/8536880549.jpg', 360, true),
  ('accessory', '24k 돌고래 꼬리 순금 목걸이(3.75g)', 3.75, '24K', 'necklace', 50000, 'store/8530393420.jpg', 370, true),
  ('accessory', '순금 루비 목걸이(3.75g)', 3.75, '24K', 'necklace', 50000, 'store/8530185615.jpg', 380, true),
  ('accessory', '순금 에멜 포인트 목걸이(3.75g)', 3.75, '24K', 'necklace', 50000, 'store/8529931313.jpg', 390, true),
  ('accessory', '순금 클립 남자 여자 팔찌( 3.75g)', 3.75, '24K', 'bracelet', 50000, 'store/8468875395.jpg', 400, true),
  ('accessory', '순금 카네이션 목걸이(11.25g)', 11.25, '24K', 'necklace', 150000, 'store/8436984790.jpg', 410, true),
  ('accessory', '순금 골드바 목걸이(18.75g)', 18.75, '24K', 'necklace', 250000, 'store/8436708730.jpg', 420, true),
  ('accessory', '순금 골드바 목걸이 (7.5g)', 7.5, '24K', 'necklace', 100000, 'store/8436168015.jpg', 430, true),
  ('accessory', '순금 진쥬 비휴팔찌 여성용 선물', 3.75, '24K', 'bracelet', 50000, 'store/8268758702.jpg', 440, false),
  ('accessory', '순금 오닉스 비휴 팔찌 1.5g', 1.5, '24K', 'bracelet', 20000, 'store/8267792230.jpg', 450, true),
  ('accessory', '남.여공용 순금 플렉스 필 팔찌(37.5g)+18k장식', 37.5, '24K', 'bracelet', 500000, 'store/8232319516.jpg', 460, true),
  ('accessory', '여성용 순금 럭키 체인 팔찌(7.5g)', 7.5, '24K', 'bracelet', 100000, 'store/8130929414.jpg', 470, true),
  ('accessory', '여성용 순금 럭키체인 목걸이 (11.25g)', 11.25, '24K', 'necklace', 150000, 'store/8130522276.jpg', 480, true),
  ('accessory', '여성용 순금 클립 목걸이(3.75g)', 3.75, '24K', 'necklace', 50000, 'store/8124938466.jpg', 490, true),
  ('accessory', '남성순금팔찌(262.5g)', 262.5, '24K', 'bracelet', 3500000, 'store/7799905661.jpg', 500, true),
  ('accessory', '골드랑24K 노블 순금 반지(3.75g)', 3.75, '24K', 'ring', 50000, 'store/7791039826.jpg', 510, true),
  ('accessory', '물고기 두줄 순금 반지(7.5g)', 7.5, '24K', 'ring', 100000, 'store/7790927085.jpg', 520, true),
  ('accessory', '두줄 레이어드 순금 반지 (7.5g)', 7.5, '24K', 'ring', 100000, 'store/7790905795.jpg', 530, true),
  ('accessory', '사각 컷팅 순금 반지(11.25g)', 11.25, '24K', 'ring', 150000, 'store/7790852861.jpg', 540, true),
  ('accessory', '클로버 순금 목걸이(18.75g)', 18.75, '24K', 'necklace', 250000, 'store/7216868106.jpg', 550, true),
  ('accessory', '크로버 순금목걸이(18.75g) [팬던트 크기/ 대 사이즈]', 18.75, '24K', 'necklace', 250000, 'store/7216866519.jpg', 560, true),
  ('accessory', '여성용 클로버 순금목걸이(18.75g)[팬던트 크기]대 사이즈', 18.75, '24K', 'necklace', 250000, 'store/7216861722.jpg', 570, true),
  ('accessory', '클로버 순금 목걸이(18.75g) [팬던트 크기/ 대 사이즈]', 18.75, '24K', 'necklace', 250000, 'store/7216844342.jpg', 580, true),
  ('accessory', '24k 순금 볼 팔찌(18.75g)', 18.75, '24K', 'bracelet', 250000, 'store/7156453139.jpg', 590, true),
  ('accessory', '순금 볼 팔찌 11.25g', 11.25, '24K', 'bracelet', 150000, 'store/7156388659.jpg', 600, true),
  ('accessory', '24k 순금 남.여 크로스 반지(37.5g)', 37.5, '24K', 'ring', 500000, 'store/7119001579.jpg', 610, true),
  ('accessory', '24k 순금 남.여 커플반지 (18.75g)', 18.75, '24K', 'ring', 250000, 'store/7118957757.jpg', 620, true),
  ('accessory', '순금 여성용 컷팅 쌍반지(11.25g)', 11.25, '24K', 'ring', 150000, 'store/7116228149.jpg', 630, true),
  ('accessory', '남.여 순금 팔각체인 팔찌 56.25g(컷팅/쪼이)', 56.25, '24K', 'bracelet', 750000, 'store/7115024997.jpg', 640, true),
  ('accessory', '남자 럭셔리 순금반지(18.75g)', 18.75, '24K', 'ring', 250000, 'store/6930024712.jpg', 650, true),
  ('accessory', '순금 체인 팔각 컷팅/쪼이 반지18.75g(5)', 18.75, '24K', 'ring', 250000, 'store/6853925833.jpg', 660, true),
  ('accessory', '24k 순금 용 컷팅반지 26.25g(7)26.', 26.25, '24K', 'ring', 350000, 'store/6716525023.jpg', 670, true),
  ('accessory', '꽂 크로바 십자가 순금반지( 11.25g)', 11.25, '24K', 'ring', 150000, 'store/6697117178.jpg', 680, true),
  ('accessory', '크로바 행운 순금반지 (7.5g)', 7.5, '24K', 'ring', 100000, 'store/6697059626.jpg', 690, true),
  ('accessory', '순금 팔각 컷팅 체인반지 (11.25g)', 11.25, '24K', 'ring', 150000, 'store/6696897429.jpg', 700, true),
  ('accessory', '순금 팔각 컷팅/쪼이 컷반지( 7.5g)', 7.5, '24K', 'ring', 100000, 'store/6696855567.jpg', 710, true),
  ('accessory', '남자 순금 사파이어 용 반지 (37.5g)', 37.5, '24K', 'ring', 500000, 'store/6679541444.jpg', 720, true),
  ('accessory', '순금 웨딩링 커플반지(11.25g)', 11.25, '24K', 'ring', 150000, 'store/6679170872.jpg', 730, true),
  ('gift', '순금 미니 골드바(3.75g) 99.99%', 3.75, '24K', 'goods', 50000, 'store/6611286772.jpg', 740, true),
  ('accessory', '남자 여자 순금 평 반지 11,25g', 11.25, '24K', 'ring', 150000, 'store/6521186438.jpg', 750, true),
  ('accessory', '순금로랙스팔찌 37.5g', 37.5, '24K', 'bracelet', 500000, 'store/6490034297.jpg', 760, true),
  ('gift', '순금100억수표99.9%(18.75g)', 18.75, '24K', 'goods', 250000, 'store/6484434905.jpg', 770, true),
  ('gift', '100억짜리수표(3.75g)', 3.75, '24K', 'goods', 50000, 'store/6484409690.jpg', 780, true),
  ('accessory', '순금반지 3.75g', 3.75, '24K', 'ring', 50000, 'store/6449475004.jpg', 790, true),
  ('accessory', '순금부엉이목걸이18.75g', 18.75, '24K', 'necklace', 250000, 'store/6420009876.jpg', 800, true),
  ('accessory', '순금 부엉이 목걸이(11.25g)', 11.25, '24K', 'necklace', 150000, 'store/6419910249.jpg', 810, true),
  ('accessory', '순금 부엉이 목걸이( 7.5g)', 7.5, '24K', 'necklace', 100000, 'store/6419892623.jpg', 820, true),
  ('accessory', '순금 이니셜 H 목걸이(11.25g)', 11.25, '24K', 'necklace', 150000, 'store/6399955246.jpg', 830, true),
  ('accessory', '순금 여자 U 볼 매듭 목걸이(18.75g) 99.99%', 18.75, '24K', 'necklace', 250000, 'store/6372741134.jpg', 840, true),
  ('accessory', '순금 클립 팔찌(7.5g)', 7.5, '24K', 'bracelet', 100000, 'store/6372721217.jpg', 850, true),
  ('gift', '순금골프공37.5g', 37.5, '24K', 'goods', 500000, 'store/6368274252.jpg', 860, true),
  ('accessory', '순금 클립형 목걸이7.5g(99.99%)', 7.5, '24K', 'necklace', 100000, 'store/6364060534.jpg', 870, true),
  ('accessory', '순금팔찌3.75g(99.99%)', 3.75, '24K', 'bracelet', 50000, 'store/6364042661.jpg', 880, true),
  ('gift', '행운의TWO달러 7.5g', 7.5, '24K', 'goods', 100000, 'store/6276755635.jpg', 890, true),
  ('gift', 'TWO달러 3.75g', 3.75, '24K', 'goods', 50000, 'store/6276733001.jpg', 900, true),
  ('gift', '동물 순금호랑이(18.75g)', 18.75, '24K', 'goods', 250000, 'store/6276360909.jpg', 910, true),
  ('gift', '동물 황금 송아지(37.5g)', 37.5, '24K', 'goods', 500000, 'store/6158148370.jpg', 920, true),
  ('accessory', '순금볼팔찌 (56.25g)', 56.25, '24K', 'bracelet', 750000, 'store/6139774284.jpg', 930, true),
  ('gift', '순금 거북이(37.5g)', 37.5, '24K', 'goods', 500000, 'store/6136597720.jpg', 940, true),
  ('accessory', '여성용 순금 볼 목걸이[75g]', 75, '24K', 'necklace', 1000000, 'store/6131168643.jpg', 950, true),
  ('accessory', '순금팔찌/팔각체인콤비[187.5g]', 187.5, '24K', 'bracelet', 2500000, 'store/6120085485.jpg', 960, true),
  ('gift', '순금 거북이(18.75g) 순금기념품', 18.75, '24K', 'goods', 250000, 'store/6111350128.jpg', 970, true),
  ('gift', '순금거북이( 11.25g) 순금 기념품 선물', 11.25, '24K', 'goods', 150000, 'store/6111169879.jpg', 980, true),
  ('accessory', '여성용 24k순금팔찌(18.75g)', 18.75, '24K', 'bracelet', 250000, 'store/6096348207.jpg', 990, true),
  ('accessory', '여성용 순금목걸이(7.5g) [팬던트 크기/ 소 사이즈]', 7.5, '24K', 'necklace', 100000, 'store/6093413515.jpg', 1000, true),
  ('accessory', '여성용 순금 목걸이(11.25g) [팬던트 크기/ 중 사이즈]', 11.25, '24K', 'necklace', 150000, 'store/6090612900.jpg', 1010, true),
  ('accessory', '여성용 순금 목걸이(18.75g) [팬던트 크기/ 대 사이즈]', 18.75, '24K', 'necklace', 250000, 'store/6083220580.jpg', 1020, true),
  ('accessory', '여성용 순금 목걸이(7.5g) [팬던트 크기/ 소 사이즈]', 7.5, '24K', 'necklace', 100000, 'store/6077585625.jpg', 1030, true),
  ('accessory', '여성용 순금 목걸이(11.25g) [팬던트 크기/ 중 사이즈]', 11.25, '24K', 'necklace', 150000, 'store/6077034117.jpg', 1040, true),
  ('accessory', '여성용 순금목걸이(18.75g) [팬던트 크기/ 대 사이즈]', 18.75, '24K', 'necklace', 250000, 'store/6074225604.jpg', 1050, true),
  ('accessory', '남성,여성 공용 순금팔찌(37.5g)', 37.5, '24K', 'bracelet', 500000, 'store/6053686726.jpg', 1060, true),
  ('accessory', '남성여성,공용 순금팔찌(37.5g)', 37.5, '24K', 'bracelet', 500000, 'store/6053133524.jpg', 1070, true),
  ('accessory', '여성용 순금팔찌(11.25g)', 11.25, '24K', 'bracelet', 150000, 'store/6035153674.jpg', 1080, true),
  ('accessory', '여성용 순금반지(11.25g)', 11.25, '24K', 'ring', 150000, 'store/6026394809.jpg', 1090, true),
  ('accessory', '여성용 순금 컷팅반지(7.5g)', 7.5, '24K', 'ring', 100000, 'store/6026256696.jpg', 1100, true),
  ('accessory', '여성용 순금반지(3.75g)', 3.75, '24K', 'ring', 50000, 'store/6025745940.jpg', 1110, true),
  ('accessory', '순금여성용쌍반지(11.25g)', 11.25, '24K', 'ring', 150000, 'store/6022404956.jpg', 1120, true),
  ('accessory', '순금목걸이(18.75g)', 18.75, '24K', 'necklace', 250000, 'store/6004110638.jpg', 1130, true),
  ('accessory', '순금 목걸이7.5g', 7.5, '24K', 'necklace', 100000, 'store/5895046678.jpg', 1140, true),
  ('accessory', '골드24k 체인팔찌 (26.25g)', 26.25, '24K', 'bracelet', 350000, 'store/5861432947.jpg', 1150, true),
  ('accessory', '24k 순금팔각팔찌(37.5g) 남녀공용', 37.5, '24K', 'bracelet', 500000, 'store/5845841971.jpg', 1160, true),
  ('accessory', '순금팔찌30(112.5g)', 112.5, '24K', 'bracelet', 1500000, 'store/5829452616.jpg', 1170, true),
  ('accessory', '순금팔찌5(18.75g)', 18.75, '24K', 'bracelet', 250000, 'store/5817233008.jpg', 1180, true),
  ('accessory', '순금 24k 팔찌 37.5g 팔각체인', 37.5, '24K', 'bracelet', 500000, 'store/5817199866.jpg', 1190, true),
  ('accessory', '순금목걸이 (7.5g)', 7.5, '24K', 'necklace', 100000, 'store/5803487397.jpg', 1200, true),
  ('accessory', '실버925 방패칼날 팔찌', 3.75, 'SV', 'bracelet', 550000, 'store/5798072383.jpg', 1210, false),
  ('accessory', '실버925 방패팔찌', 3.75, 'SV', 'bracelet', 720000, 'store/5785318034.jpg', 1220, false),
  ('accessory', '실버925 호랑이팔찌', 3.75, 'SV', 'bracelet', 2000000, 'store/5785108361.jpg', 1230, false),
  ('accessory', '실버925면체인 스틱팔찌', 3.75, 'SV', 'bracelet', 850000, 'store/5784790273.jpg', 1240, false),
  ('accessory', '실버925팔찌', 3.75, 'SV', 'bracelet', 790000, 'store/5784602184.jpg', 1250, false),
  ('accessory', '실버925 쌍용팔찌', 3.75, 'SV', 'bracelet', 2100000, 'store/5749898283.jpg', 1260, false),
  ('accessory', '실버925팔찌', 3.75, 'SV', 'bracelet', 2100000, 'store/5749694410.jpg', 1270, false),
  ('accessory', '순금클립팔찌18.75g(매력있는팔찌)', 18.75, '24K', 'bracelet', 250000, 'store/5734372274.jpg', 1280, true),
  ('accessory', '순금 클립목걸이(18.75g)', 18.75, '24K', 'necklace', 250000, 'store/5731930370.jpg', 1290, true),
  ('accessory', '순금 여성팔찌37.5g', 37.5, '24K', 'bracelet', 500000, 'store/5731872814.jpg', 1300, true),
  ('accessory', '순금남성남자팔찌 75g', 75, '24K', 'bracelet', 1000000, 'store/5721174587.jpg', 1310, true),
  ('gift', '순금 돌반지 반돈', 1.875, '24K', 'dol', 25000, 'gift/ring.svg', 5000, true),
  ('gift', '순금 돌반지 한돈', 3.75, '24K', 'dol', 50000, 'gift/ring.svg', 5010, true),
  ('gift', '순금 돌목걸이 한돈', 3.75, '24K', 'dol', 50000, 'gift/necklace.svg', 5020, true),
  ('gift', '순금 돌팔찌 한돈', 3.75, '24K', 'dol', 50000, 'gift/bracelet.svg', 5030, true),
  ('gift', '행운의 열쇠 1g', 1, '24K', 'key', 13000, 'gift/key.svg', 5100, true),
  ('gift', '행운의 열쇠 반돈', 1.875, '24K', 'key', 25000, 'gift/key.svg', 5110, true),
  ('gift', '행운의 열쇠 한돈', 3.75, '24K', 'key', 50000, 'gift/key.svg', 5120, true),
  ('gift', '행운의 열쇠 두돈', 7.5, '24K', 'key', 100000, 'gift/key.svg', 5130, true),
  ('gift', '행운의 열쇠 세돈', 11.25, '24K', 'key', 150000, 'gift/key.svg', 5140, true),
  ('gift', '행운의 열쇠 다섯돈', 18.75, '24K', 'key', 250000, 'gift/key.svg', 5150, true),
  ('gift', '기념 각인 골드바 한돈', 3.75, '24K', 'memo', 50000, 'gift/bar.svg', 5200, true),
  ('gift', '기념 각인 골드바 세돈', 11.25, '24K', 'memo', 150000, 'gift/bar.svg', 5210, true),
  ('gift', '기념 각인 골드바 다섯돈', 18.75, '24K', 'memo', 250000, 'gift/bar.svg', 5220, true)
) as v(kind, name, weight_g, karat, category, labor, img, sort, visible)
where not exists (select 1 from public.products x where x.name = v.name and x.kind = v.kind);