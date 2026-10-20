-- public_foods LIKE '%q%' 검색이 매번 테이블 전체를 스캔(D1 rows read 폭증)하던 문제 해결
-- trigram FTS5 인덱스를 만들어서 LIKE '%q%' 패턴을 그대로 쓰면서도 인덱스를 타게 함
-- (3글자 미만 검색어는 trigram 특성상 인덱스 가속이 안 걸릴 수 있음 — 드문 케이스라 허용)

CREATE VIRTUAL TABLE IF NOT EXISTS public_foods_fts USING fts5(
  food_name,
  search_name,
  content='public_foods',
  content_rowid='food_id',
  tokenize='trigram'
);

-- 기존 데이터 채우기 (이미 인덱싱된 행은 건드리지 않도록 최초 1회만 실행되면 됨)
INSERT INTO public_foods_fts(rowid, food_name, search_name)
SELECT food_id, food_name, search_name FROM public_foods
WHERE food_id NOT IN (SELECT rowid FROM public_foods_fts);

-- public_foods 변경 시 FTS 인덱스 자동 동기화
CREATE TRIGGER IF NOT EXISTS public_foods_fts_ai AFTER INSERT ON public_foods BEGIN
  INSERT INTO public_foods_fts(rowid, food_name, search_name)
  VALUES (new.food_id, new.food_name, new.search_name);
END;

CREATE TRIGGER IF NOT EXISTS public_foods_fts_ad AFTER DELETE ON public_foods BEGIN
  INSERT INTO public_foods_fts(public_foods_fts, rowid, food_name, search_name)
  VALUES ('delete', old.food_id, old.food_name, old.search_name);
END;

CREATE TRIGGER IF NOT EXISTS public_foods_fts_au AFTER UPDATE ON public_foods BEGIN
  INSERT INTO public_foods_fts(public_foods_fts, rowid, food_name, search_name)
  VALUES ('delete', old.food_id, old.food_name, old.search_name);
  INSERT INTO public_foods_fts(rowid, food_name, search_name)
  VALUES (new.food_id, new.food_name, new.search_name);
END;
