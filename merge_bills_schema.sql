-- MERGE BILLS SYSTEM - DATABASE SCHEMA (UPDATED FOR ACTUAL TABLES)
-- ================================================================

-- 1. ENHANCE ORDERS TABLE (matching actual structure)
-- ===================================================
ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_group_id VARCHAR(255);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_group_name VARCHAR(255);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS table_order_index INTEGER;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS is_merged BOOLEAN DEFAULT FALSE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS merged_from JSON;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS can_be_merged BOOLEAN DEFAULT TRUE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS merge_restrictions JSON;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS merge_history JSON;

-- 2. CREATE ORDER_GROUPS TABLE
-- =============================
CREATE TABLE IF NOT EXISTS order_groups (
  id VARCHAR(255) PRIMARY KEY,
  table_number VARCHAR(255) NOT NULL, -- Using tableNumber instead of table_id
  name VARCHAR(255) NOT NULL,
  customer_name VARCHAR(255),
  customer_phone VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. CREATE ORDER_MERGE_HISTORY TABLE
-- ===================================
CREATE TABLE IF NOT EXISTS order_merge_history (
  id VARCHAR(255) PRIMARY KEY,
  merged_order_id VARCHAR(255) NOT NULL,
  source_order_id VARCHAR(255) NOT NULL,
  table_number VARCHAR(255) NOT NULL, -- Using tableNumber instead of table_id
  merged_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  merged_by VARCHAR(255) NOT NULL,
  merge_reason TEXT,
  merge_strategy VARCHAR(50),
  customer_name_before VARCHAR(255),
  customer_name_after VARCHAR(255),
  total_amount_before DECIMAL(10,2),
  total_amount_after DECIMAL(10,2),
  FOREIGN KEY (merged_order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (source_order_id) REFERENCES orders(id) ON DELETE CASCADE
);

-- 4. CREATE ORDER_SPLIT_HISTORY TABLE
-- ====================================
CREATE TABLE IF NOT EXISTS order_split_history (
  id VARCHAR(255) PRIMARY KEY,
  original_order_id VARCHAR(255) NOT NULL,
  new_order_id VARCHAR(255) NOT NULL,
  table_number VARCHAR(255) NOT NULL, -- Using tableNumber instead of table_id
  split_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  split_by VARCHAR(255) NOT NULL,
  split_reason TEXT,
  items_split JSON,
  FOREIGN KEY (original_order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (new_order_id) REFERENCES orders(id) ON DELETE CASCADE
);

-- 5. CREATE INDEXES FOR PERFORMANCE
-- ==================================
CREATE INDEX IF NOT EXISTS idx_orders_group_id ON orders(order_group_id);
CREATE INDEX IF NOT EXISTS idx_orders_merged ON orders(is_merged);
CREATE INDEX IF NOT EXISTS idx_orders_can_merge ON orders(can_be_merged);
CREATE INDEX IF NOT EXISTS idx_order_groups_table_number ON order_groups(table_number);
CREATE INDEX IF NOT EXISTS idx_merge_history_merged_order ON order_merge_history(merged_order_id);
CREATE INDEX IF NOT EXISTS idx_merge_history_source_order ON order_merge_history(source_order_id);
CREATE INDEX IF NOT EXISTS idx_split_history_original_order ON order_split_history(original_order_id);
CREATE INDEX IF NOT EXISTS idx_split_history_new_order ON order_split_history(new_order_id); 