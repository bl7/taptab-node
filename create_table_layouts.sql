-- =====================================================
-- TABLE LAYOUTS CREATION FOR LOCATION-BASED LAYOUTS
-- =====================================================

-- Create the table_layouts table
CREATE TABLE table_layouts (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    "locationId" VARCHAR(50) NOT NULL,
    "tenantId" TEXT NOT NULL,
    layout_json JSONB NOT NULL,
    "isActive" BOOLEAN DEFAULT true,
    "isDefault" BOOLEAN DEFAULT false,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT,
    
    -- Constraints
    CONSTRAINT table_layouts_tenant_location_name_unique UNIQUE ("tenantId", "locationId", name),
    CONSTRAINT table_layouts_name_not_empty CHECK (LENGTH(TRIM(name)) > 0),
    CONSTRAINT table_layouts_valid_json CHECK (layout_json IS NOT NULL AND jsonb_typeof(layout_json) = 'object')
);

-- Create indexes for performance
CREATE INDEX idx_table_layouts_tenant_id ON table_layouts ("tenantId");
CREATE INDEX idx_table_layouts_location_id ON table_layouts ("locationId");
CREATE INDEX idx_table_layouts_active ON table_layouts ("isActive");
CREATE INDEX idx_table_layouts_default ON table_layouts ("isDefault");

-- Create GIN index for JSON queries (enables fast JSON searches)
CREATE INDEX idx_table_layouts_json ON table_layouts USING GIN (layout_json);

-- Add foreign key constraints
ALTER TABLE table_layouts 
ADD CONSTRAINT "table_layouts_tenantId_fkey" 
FOREIGN KEY ("tenantId") REFERENCES tenants(id) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE table_layouts 
ADD CONSTRAINT "table_layouts_locationId_fkey" 
FOREIGN KEY ("locationId") REFERENCES locations(id) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE table_layouts 
ADD CONSTRAINT "table_layouts_createdByUserId_fkey" 
FOREIGN KEY ("createdByUserId") REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE;

-- Ensure only one default layout per location
CREATE UNIQUE INDEX idx_table_layouts_one_default_per_location 
ON table_layouts ("locationId") 
WHERE "isDefault" = true AND "isActive" = true;

-- =====================================================
-- SAMPLE LAYOUT DATA
-- =====================================================

-- Insert sample layouts for existing locations
-- Replace with actual locationId and tenantId values

INSERT INTO table_layouts (
    id, 
    name, 
    description, 
    "locationId", 
    "tenantId", 
    layout_json, 
    "isActive", 
    "isDefault", 
    "createdAt", 
    "updatedAt"
) VALUES 
(
    'layout_main_area_001', 
    'Main Floor Standard Layout',
    'Standard rectangular layout for main dining area',
    'loc_main_area_6e8ba720_f7f5_4352_91d9_365632cfaf60', -- Replace with actual location ID
    '6e8ba720-f7f5-4352-91d9-365632cfaf60', -- Replace with actual tenant ID
    '{
        "type": "grid",
        "dimensions": {
            "width": 800,
            "height": 600,
            "gridSize": 50
        },
        "tables": [
            {
                "tableId": "table_123",
                "position": {"x": 100, "y": 100},
                "size": {"width": 80, "height": 80},
                "shape": "round",
                "seats": 4,
                "rotation": 0
            },
            {
                "tableId": "table_456", 
                "position": {"x": 250, "y": 100},
                "size": {"width": 120, "height": 60},
                "shape": "rectangle",
                "seats": 6,
                "rotation": 0
            }
        ],
        "walls": [
            {"start": {"x": 0, "y": 0}, "end": {"x": 800, "y": 0}},
            {"start": {"x": 800, "y": 0}, "end": {"x": 800, "y": 600}},
            {"start": {"x": 800, "y": 600}, "end": {"x": 0, "y": 600}},
            {"start": {"x": 0, "y": 600}, "end": {"x": 0, "y": 0}}
        ],
        "objects": [
            {
                "type": "bar",
                "position": {"x": 50, "y": 500},
                "size": {"width": 200, "height": 80}
            },
            {
                "type": "kitchen_door",
                "position": {"x": 400, "y": 0},
                "size": {"width": 80, "height": 20}
            }
        ]
    }',
    true,
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
),
(
    'layout_patio_001',
    'Outdoor Patio Layout',
    'Scattered layout for outdoor patio seating',
    'loc_patio_003', -- Replace with actual patio location ID
    '6e8ba720-f7f5-4352-91d9-365632cfaf60', -- Replace with actual tenant ID
    '{
        "type": "freeform",
        "dimensions": {
            "width": 1000,
            "height": 800,
            "gridSize": 25
        },
        "tables": [
            {
                "tableId": "table_patio_001",
                "position": {"x": 150, "y": 200},
                "size": {"width": 80, "height": 80},
                "shape": "round",
                "seats": 4,
                "rotation": 0
            },
            {
                "tableId": "table_patio_002",
                "position": {"x": 300, "y": 350},
                "size": {"width": 80, "height": 80}, 
                "shape": "round",
                "seats": 2,
                "rotation": 0
            }
        ],
        "objects": [
            {
                "type": "tree",
                "position": {"x": 500, "y": 400},
                "size": {"width": 100, "height": 100}
            },
            {
                "type": "umbrella",
                "position": {"x": 150, "y": 200},
                "size": {"width": 120, "height": 120}
            }
        ]
    }',
    true,
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
);

-- =====================================================
-- USEFUL JSON QUERIES FOR LAYOUTS
-- =====================================================

-- Query to find layouts by location
-- SELECT * FROM table_layouts WHERE "locationId" = 'loc_main_area_001';

-- Query to find tables in a specific position range
-- SELECT name, layout_json->'tables' as tables 
-- FROM table_layouts 
-- WHERE layout_json->'tables' @> '[{"position": {"x": 100}}]';

-- Query to find layouts with specific table count
-- SELECT name, jsonb_array_length(layout_json->'tables') as table_count
-- FROM table_layouts
-- WHERE jsonb_array_length(layout_json->'tables') > 5;

-- Query to find layouts with round tables
-- SELECT name, layout_json->'tables' as tables
-- FROM table_layouts
-- WHERE layout_json->'tables' @> '[{"shape": "round"}]';

-- Update a table position in layout
-- UPDATE table_layouts 
-- SET layout_json = jsonb_set(
--     layout_json, 
--     '{tables,0,position}', 
--     '{"x": 200, "y": 150}'
-- )
-- WHERE id = 'layout_main_area_001';

-- =====================================================
-- VERIFICATION QUERIES
-- =====================================================

-- Check layouts created
SELECT 
    tl.id,
    tl.name,
    tl.description,
    l.name as location_name,
    tl."isDefault",
    tl."isActive",
    jsonb_array_length(tl.layout_json->'tables') as table_count
FROM table_layouts tl
LEFT JOIN locations l ON tl."locationId" = l.id
ORDER BY tl."tenantId", l.name, tl.name;

-- Check JSON structure validity
SELECT 
    id,
    name,
    layout_json ? 'type' as has_type,
    layout_json ? 'dimensions' as has_dimensions,
    layout_json ? 'tables' as has_tables,
    jsonb_typeof(layout_json->'tables') as tables_type
FROM table_layouts;

-- Summary report
SELECT 
    'Total layouts created' as metric, 
    COUNT(*)::TEXT as value 
FROM table_layouts
UNION ALL
SELECT 
    'Active layouts' as metric, 
    COUNT(*)::TEXT as value 
FROM table_layouts 
WHERE "isActive" = true
UNION ALL
SELECT 
    'Default layouts' as metric, 
    COUNT(*)::TEXT as value 
FROM table_layouts 
WHERE "isDefault" = true;
