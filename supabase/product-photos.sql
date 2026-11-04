-- 2026-11-04 상품 추가 사진 (한 줄에 하나) — 메인 '순금 콩알금' 코너 사진 넘겨보기에 사용
alter table public.products add column if not exists photos text;
select '추가 사진 칸 준비 완료' as result;
