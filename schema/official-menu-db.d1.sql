PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS brands (
  brand_id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_name TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  list_page_url TEXT,
  nutrition_page_url TEXT,
  deeplink_pattern TEXT,
  scrap_method TEXT NOT NULL DEFAULT 'STATIC'
    CHECK (scrap_method IN ('STATIC', 'DYNAMIC', 'PDF', 'OFFICIAL_JSON', 'MANUAL')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS brand_menus (
  menu_id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_id INTEGER NOT NULL,
  menu_name TEXT NOT NULL,
  aliases_json TEXT NOT NULL DEFAULT '[]',
  item_code_val TEXT,
  serving_label TEXT,
  serving_size_g REAL,
  calories_kcal REAL,
  carbohydrates_g REAL,
  protein_g REAL,
  fat_g REAL,
  saturated_fat_g REAL,
  trans_fat_g REAL,
  sugar_g REAL,
  sodium_mg REAL,
  caffeine_mg REAL NOT NULL DEFAULT 0,
  source_type TEXT NOT NULL DEFAULT 'official_menu_page',
  source_label TEXT,
  detail_deeplink_url TEXT,
  image_url TEXT,
  verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (brand_id) REFERENCES brands(brand_id) ON DELETE CASCADE,
  UNIQUE (brand_id, menu_name, item_code_val)
);

CREATE INDEX IF NOT EXISTS idx_brands_name ON brands (brand_name);
CREATE INDEX IF NOT EXISTS idx_brand_menus_brand ON brand_menus (brand_id);
CREATE INDEX IF NOT EXISTS idx_brand_menus_name ON brand_menus (menu_name);
CREATE INDEX IF NOT EXISTS idx_brand_menus_item_code ON brand_menus (item_code_val);

CREATE TABLE IF NOT EXISTS public_foods (
  food_id INTEGER PRIMARY KEY AUTOINCREMENT,
  food_code TEXT NOT NULL UNIQUE,
  db_type TEXT NOT NULL,
  food_name TEXT NOT NULL,
  search_name TEXT NOT NULL,
  data_group TEXT,
  origin_name TEXT,
  category_large TEXT,
  category_middle TEXT,
  category_small TEXT,
  category_detail TEXT,
  representative_food TEXT,
  serving_basis TEXT,
  serving_weight TEXT,
  calories_kcal REAL,
  carbohydrates_g REAL,
  protein_g REAL,
  fat_g REAL,
  saturated_fat_g REAL,
  trans_fat_g REAL,
  sugar_g REAL,
  sodium_mg REAL,
  fiber_g REAL,
  leucine_mg REAL,
  caffeine_mg REAL,
  manufacturer_name TEXT,
  importer_name TEXT,
  distributor_name TEXT,
  report_no TEXT,
  source_name TEXT,
  source_file TEXT,
  standard_date TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_public_foods_name ON public_foods (food_name);
CREATE INDEX IF NOT EXISTS idx_public_foods_search_name ON public_foods (search_name);
CREATE INDEX IF NOT EXISTS idx_public_foods_code ON public_foods (food_code);
CREATE INDEX IF NOT EXISTS idx_public_foods_category ON public_foods (category_large, category_middle);
CREATE INDEX IF NOT EXISTS idx_public_foods_manufacturer ON public_foods (manufacturer_name);

CREATE TABLE IF NOT EXISTS nutrition_source_fetch_logs (
  fetch_log_id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_id INTEGER,
  source_url TEXT NOT NULL,
  status TEXT NOT NULL,
  message TEXT,
  fetched_count INTEGER NOT NULL DEFAULT 0,
  fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (brand_id) REFERENCES brands(brand_id) ON DELETE SET NULL
);
