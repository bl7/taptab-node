-- =====================================================
-- LOCATIONS TABLE CREATION FOR TAPTAB
-- =====================================================

-- Create the locations table
CREATE TABLE locations (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    "tenantId" VARCHAR(50) NOT NULL,
    "isActive" BOOLEAN DEFAULT true,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Constraints
    CONSTRAINT locations_tenant_name_unique UNIQUE ("tenantId", name),
    CONSTRAINT locations_name_not_empty CHECK (LENGTH(TRIM(name)) > 0)
);

-- Create indexes for performance
CREATE INDEX idx_locations_tenant_id ON locations ("tenantId");
CREATE INDEX idx_locations_active ON locations ("isActive");
CREATE INDEX idx_locations_name ON locations (name);

-- =====================================================
-- MODIFY TABLES SCHEMA
-- =====================================================

-- Add locationId foreign key to tables
ALTER TABLE tables 
ADD COLUMN "locationId" VARCHAR(50),
ADD CONSTRAINT fk_tables_location 
    FOREIGN KEY ("locationId") REFERENCES locations(id) 
    ON DELETE SET NULL;

-- Create index for the foreign key
CREATE INDEX idx_tables_location_id ON tables ("locationId");

-- =====================================================
-- SAMPLE DATA INSERTION
-- =====================================================

-- Insert some default locations (replace tenantId with actual tenant ID)
-- Example for tenant: 6e8ba720-f7f5-4352-91d9-365632cfaf60

INSERT INTO locations (id, name, description, "tenantId", "isActive", "createdAt", "updatedAt") VALUES 
('loc_main_floor_001', 'Main Floor', 'Main dining area with regular seating', '6e8ba720-f7f5-4352-91d9-365632cfaf60', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('loc_window_side_002', 'Window Side', 'Tables next to windows with natural light', '6e8ba720-f7f5-4352-91d9-365632cfaf60', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('loc_patio_003', 'Patio', 'Outdoor seating area', '6e8ba720-f7f5-4352-91d9-365632cfaf60', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('loc_vip_area_004', 'VIP Area', 'Premium seating section for special guests', '6e8ba720-f7f5-4352-91d9-365632cfaf60', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('loc_bar_area_005', 'Bar Area', 'High tables near the bar counter', '6e8ba720-f7f5-4352-91d9-365632cfaf60', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- =====================================================
-- DATA MIGRATION STRATEGY
-- =====================================================

-- Option 1: Create a default location for existing tables with location text
INSERT INTO locations (id, name, description, "tenantId", "isActive", "createdAt", "updatedAt")
SELECT 
    'loc_legacy_' || LOWER(REPLACE(TRIM(location), ' ', '_')) || '_' || EXTRACT(EPOCH FROM CURRENT_TIMESTAMP)::BIGINT,
    CASE 
        WHEN TRIM(location) = '' OR location IS NULL THEN 'Unspecified'
        ELSE TRIM(location)
    END,
    'Migrated from legacy location field',
    "tenantId",
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM tables 
WHERE location IS NOT NULL 
    AND TRIM(location) != ''
GROUP BY "tenantId", TRIM(location)
ON CONFLICT ("tenantId", name) DO NOTHING;

-- Option 2: Update tables to reference the new locations
UPDATE tables 
SET "locationId" = locations.id
FROM locations 
WHERE tables."tenantId" = locations."tenantId" 
    AND (
        (TRIM(tables.location) = locations.name) 
        OR (
            (tables.location IS NULL OR TRIM(tables.location) = '') 
            AND locations.name = 'Unspecified'
        )
    );

-- =====================================================
-- CLEANUP (Optional - run after verification)
-- =====================================================

-- After successful migration and testing, you can remove the old location column
-- ALTER TABLE tables DROP COLUMN location;

-- =====================================================
-- VERIFICATION QUERIES
-- =====================================================

-- Check locations created
SELECT l.*, COUNT(t.id) as table_count 
FROM locations l 
LEFT JOIN tables t ON l.id = t."locationId" 
GROUP BY l.id, l.name, l.description, l."tenantId", l."isActive", l."createdAt", l."updatedAt"
ORDER BY l.name;

-- Check tables with locations
SELECT 
    t.number as table_number,
    t.location as old_location_text,
    l.name as new_location_name,
    l.description as location_description
FROM tables t 
LEFT JOIN locations l ON t."locationId" = l.id 
ORDER BY t.number;

-- Check tables without locations assigned
SELECT number, location, "tenantId" 
FROM tables 
WHERE "locationId" IS NULL;
