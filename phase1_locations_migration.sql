-- =====================================================
-- PHASE 1: LOCATIONS TABLE MIGRATION
-- Safe migration - keeps existing location field
-- =====================================================

-- Step 1: Create the locations table
CREATE TABLE locations (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    "tenantId" TEXT NOT NULL,
    "isActive" BOOLEAN DEFAULT true,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    
    -- Constraints
    CONSTRAINT locations_tenant_name_unique UNIQUE ("tenantId", name),
    CONSTRAINT locations_name_not_empty CHECK (LENGTH(TRIM(name)) > 0)
);

-- Step 2: Create indexes for performance
CREATE INDEX idx_locations_tenant_id ON locations ("tenantId");
CREATE INDEX idx_locations_active ON locations ("isActive");
CREATE INDEX idx_locations_name ON locations (name);

-- Step 3: Add foreign key constraint to locations table
ALTER TABLE locations 
ADD CONSTRAINT "locations_tenantId_fkey" 
FOREIGN KEY ("tenantId") REFERENCES tenants(id) ON DELETE CASCADE ON UPDATE CASCADE;

-- Step 4: Add locationId column to tables (keeps existing location field)
ALTER TABLE tables 
ADD COLUMN "locationId" VARCHAR(50);

-- Step 5: Add foreign key constraint for locationId
ALTER TABLE tables 
ADD CONSTRAINT fk_tables_location 
FOREIGN KEY ("locationId") REFERENCES locations(id) ON DELETE SET NULL;

-- Step 6: Create index for the foreign key
CREATE INDEX idx_tables_location_id ON tables ("locationId");

-- Step 7: Insert default locations for existing tenants
-- This creates a generic "Main Area" location for each tenant
INSERT INTO locations (id, name, description, "tenantId", "isActive", "createdAt", "updatedAt")
SELECT 
    'loc_main_area_' || REPLACE("tenantId", '-', '_'),
    'Main Area',
    'Default location for existing tables',
    "tenantId",
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM (
    SELECT DISTINCT "tenantId" FROM tables
) AS distinct_tenants
ON CONFLICT ("tenantId", name) DO NOTHING;

-- Step 8: Create locations from existing unique location text
-- This preserves existing location names as proper location entities
INSERT INTO locations (id, name, description, "tenantId", "isActive", "createdAt", "updatedAt")
SELECT 
    'loc_' || LOWER(REPLACE(REPLACE(TRIM(location), ' ', '_'), '''', '')) || '_' || EXTRACT(EPOCH FROM CURRENT_TIMESTAMP)::BIGINT % 100000,
    TRIM(location),
    'Migrated from existing table location field',
    "tenantId",
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM tables 
WHERE location IS NOT NULL 
    AND TRIM(location) != ''
    AND LENGTH(TRIM(location)) > 0
GROUP BY "tenantId", TRIM(location)
ON CONFLICT ("tenantId", name) DO NOTHING;

-- Step 9: Update tables to reference the new locations
-- First, update tables with specific location text
UPDATE tables 
SET "locationId" = locations.id
FROM locations 
WHERE tables."tenantId" = locations."tenantId" 
    AND TRIM(tables.location) = locations.name
    AND tables.location IS NOT NULL 
    AND TRIM(tables.location) != '';

-- Second, update tables with empty/null locations to use "Main Area"
UPDATE tables 
SET "locationId" = locations.id
FROM locations 
WHERE tables."tenantId" = locations."tenantId" 
    AND locations.name = 'Main Area'
    AND (tables.location IS NULL OR TRIM(tables.location) = '')
    AND tables."locationId" IS NULL;

-- =====================================================
-- VERIFICATION QUERIES
-- =====================================================

-- Check locations created
SELECT 
    l.id,
    l.name,
    l.description,
    l."tenantId",
    COUNT(t.id) as table_count 
FROM locations l 
LEFT JOIN tables t ON l.id = t."locationId" 
GROUP BY l.id, l.name, l.description, l."tenantId"
ORDER BY l."tenantId", l.name;

-- Check tables with their locations
SELECT 
    t.number as table_number,
    t.location as old_location_text,
    t."locationId",
    l.name as new_location_name,
    t."tenantId"
FROM tables t 
LEFT JOIN locations l ON t."locationId" = l.id 
ORDER BY t."tenantId", t.number;

-- Check for any tables without locationId assigned
SELECT 
    COUNT(*) as unassigned_tables,
    "tenantId"
FROM tables 
WHERE "locationId" IS NULL
GROUP BY "tenantId";

-- Summary report
SELECT 
    'Total locations created' as metric, 
    COUNT(*)::TEXT as value 
FROM locations
UNION ALL
SELECT 
    'Total tables with locationId assigned' as metric, 
    COUNT(*)::TEXT as value 
FROM tables 
WHERE "locationId" IS NOT NULL
UNION ALL
SELECT 
    'Total tables without locationId' as metric, 
    COUNT(*)::TEXT as value 
FROM tables 
WHERE "locationId" IS NULL;
