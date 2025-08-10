-- Migration: Add BOGO-specific fields to promotions table
-- Run this after creating the initial promotions table

-- Add new BOGO fields
ALTER TABLE promotions 
ADD COLUMN IF NOT EXISTS buy_target_type VARCHAR(20) CHECK (buy_target_type IN ('ALL', 'CATEGORY', 'PRODUCTS')),
ADD COLUMN IF NOT EXISTS buy_target_category_id VARCHAR(50),
ADD COLUMN IF NOT EXISTS buy_target_product_ids TEXT[],
ADD COLUMN IF NOT EXISTS get_target_type VARCHAR(20) CHECK (get_target_type IN ('ALL', 'CATEGORY', 'PRODUCTS')),
ADD COLUMN IF NOT EXISTS get_target_category_id VARCHAR(50),
ADD COLUMN IF NOT EXISTS get_target_product_ids TEXT[];

-- Add foreign key constraints for new fields (handle existing constraints)
DO $$
BEGIN
    -- Add buy category constraint if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'fk_promotions_buy_category'
    ) THEN
        ALTER TABLE promotions 
        ADD CONSTRAINT fk_promotions_buy_category 
        FOREIGN KEY (buy_target_category_id) REFERENCES categories(id) ON DELETE SET NULL;
    END IF;

    -- Add get category constraint if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'fk_promotions_get_category'
    ) THEN
        ALTER TABLE promotions 
        ADD CONSTRAINT fk_promotions_get_category 
        FOREIGN KEY (get_target_category_id) REFERENCES categories(id) ON DELETE SET NULL;
    END IF;
END $$;

-- Update existing BOGO promotions to use new fields
-- Example: Update "Buy 2 Get 1 Free Pizza" to specify pizza category for both buy and get
UPDATE promotions 
SET 
    buy_target_type = 'CATEGORY',
    buy_target_category_id = (SELECT id FROM categories WHERE name = 'Pizza' LIMIT 1),
    get_target_type = 'CATEGORY',
    get_target_category_id = (SELECT id FROM categories WHERE name = 'Pizza' LIMIT 1)
WHERE type = 'BOGO' AND name LIKE '%Pizza%';

-- Verify the changes
SELECT 
    id, 
    name, 
    type, 
    buy_target_type, 
    buy_target_category_id, 
    get_target_type, 
    get_target_category_id
FROM promotions 
WHERE type = 'BOGO';
