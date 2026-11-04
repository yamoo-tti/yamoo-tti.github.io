-- 2026-11-04 반지 사이즈 9~17호 (1호 단위) — 반지는 사이즈를 골라도 중량·가격은 그대로
-- 사이즈 단위: 반지 '호', 팔찌·목걸이 'cm' (주문 상품명: '… (사이즈 13호)')
-- size-addon.sql · size-weight.sql 다음에 실행하세요. 여러 번 실행해도 안전합니다.
update public.products set sizes = '9,10,11,12,13,14,15,16,17', base_size = null
 where kind = 'accessory' and category = 'ring';

create or replace function public.opt_check(pr public.products, p_size text, p_addon boolean, out label text, out extra numeric)
language plpgsql stable set search_path = public as $$
declare s text := nullif(trim(coalesce(p_size, '')), '');
begin
  label := ''; extra := 0;
  if coalesce(trim(pr.sizes), '') <> '' then
    if s is null then raise exception '사이즈를 골라 주세요: %', pr.name; end if;
    if not s = any (string_to_array(replace(pr.sizes, ' ', ''), ',')) then raise exception '사이즈를 다시 골라 주세요: %', pr.name; end if;
    label := '사이즈 ' || s || case when pr.category = 'ring' then '호' else 'cm' end;
  end if;
  if coalesce(p_addon, false) then
    if coalesce(trim(pr.addon_name), '') = '' or coalesce(pr.addon_price, 0) <= 0 then raise exception '선택할 수 없는 옵션이에요: %', pr.name; end if;
    label := label || case when label = '' then '' else ' · ' end || pr.addon_name;
    extra := pr.addon_price;
  end if;
end $$;
revoke all on function public.opt_check(public.products, text, boolean) from public, anon, authenticated;

select name as "반지", sizes as "사이즈(호)" from public.products where kind = 'accessory' and category = 'ring' order by weight_g;
