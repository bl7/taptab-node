-- Drop old promotion tables from previous complex system
-- Run this BEFORE creating the new simple promotions table

-- Drop tables in dependency order (foreign keys first)
DROP TABLE IF EXISTS "promotionItems" CASCADE;
DROP TABLE IF EXISTS "promotionUsage" CASCADE;
DROP TABLE IF EXISTS "promotions" CASCADE;

-- Verify tables are dropped
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('promotions', 'promotionItems', 'promotionUsage');

-- Should return no rows if tables were dropped successfully
