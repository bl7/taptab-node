-- ==================== MENU TAGS TABLE ====================
-- Global tags that all tenants can assign to their menu items
CREATE TABLE IF NOT EXISTS menuTags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  color TEXT DEFAULT '#667eea', -- Hex color for UI display
  isActive BOOLEAN DEFAULT true,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_menu_tags_name ON menuTags(name);
CREATE INDEX IF NOT EXISTS idx_menu_tags_active ON menuTags(isActive);

-- ==================== MENU ITEM TAGS JUNCTION TABLE ====================
-- Many-to-many relationship between menu items and tags
CREATE TABLE IF NOT EXISTS "menuItemTags" (
  id TEXT PRIMARY KEY,
  "menuItemId" TEXT NOT NULL,
  "tagId" TEXT NOT NULL,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("menuItemId") REFERENCES "menuItems"(id) ON DELETE CASCADE,
  FOREIGN KEY ("tagId") REFERENCES menuTags(id) ON DELETE CASCADE,
  UNIQUE("menuItemId", "tagId")
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_menu_item_tags_menu_item_id ON "menuItemTags"("menuItemId");
CREATE INDEX IF NOT EXISTS idx_menu_item_tags_tag_id ON "menuItemTags"("tagId");

-- ==================== INSERT STANDARD TAGS ====================
INSERT INTO menuTags (id, name, description, color) VALUES
('tag_gluten_free', 'Gluten-Free', 'Does not contain gluten or gluten-containing ingredients', '#28a745'),
('tag_dairy_free', 'Dairy-Free', 'Does not contain milk, cheese, butter, or other dairy products', '#17a2b8'),
('tag_nut_free', 'Nut-Free', 'Does not contain tree nuts or nut-derived ingredients', '#fd7e14'),
('tag_peanut_free', 'Peanut-Free', 'Does not contain peanuts or peanut-derived ingredients', '#dc3545'),
('tag_egg_free', 'Egg-Free', 'Does not contain eggs or egg-derived ingredients', '#ffc107'),
('tag_soy_free', 'Soy-Free', 'Does not contain soy or soy-derived ingredients', '#6f42c1'),
('tag_shellfish_free', 'Shellfish-Free', 'Does not contain shellfish or shellfish-derived ingredients', '#20c997'),
('tag_sesame_free', 'Sesame-Free', 'Does not contain sesame seeds or sesame-derived ingredients', '#6c757d'),
('tag_wheat_free', 'Wheat-Free', 'Does not contain wheat or wheat-derived ingredients', '#e83e8c'),
('tag_lactose_free', 'Lactose-Free', 'Does not contain lactose or is treated to remove lactose', '#007bff'),
('tag_allergen_free', 'Allergen-Free', 'Free from all major allergens', '#198754')
ON CONFLICT (name) DO NOTHING;