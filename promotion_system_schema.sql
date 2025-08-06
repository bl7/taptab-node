-- ==================== PROMOTION SYSTEM DATABASE SCHEMA ====================
-- This schema supports all promotion types for a comprehensive POS system

-- Main promotions table
CREATE TABLE promotions (
    id VARCHAR(50) PRIMARY KEY,
    "tenantId" VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    
    -- Promotion type and behavior
    type VARCHAR(50) NOT NULL, -- 'ITEM_DISCOUNT', 'COMBO_DEAL', 'CART_DISCOUNT', 'BOGO', 'FIXED_PRICE', 'TIME_BASED', 'COUPON'
    "discountType" VARCHAR(20) NOT NULL, -- 'PERCENTAGE', 'FIXED_AMOUNT', 'FREE_ITEM', 'FIXED_PRICE'
    "discountValue" DECIMAL(10,2), -- percentage (0-100) or fixed amount
    "fixedPrice" DECIMAL(10,2), -- for fixed price promotions
    
    -- Conditions and limits
    "minCartValue" DECIMAL(10,2) DEFAULT 0,
    "maxDiscountAmount" DECIMAL(10,2), -- cap for percentage discounts
    "minItems" INTEGER DEFAULT 1,
    "maxItems" INTEGER,
    "usageLimit" INTEGER, -- total uses allowed
    "usageCount" INTEGER DEFAULT 0, -- current usage count
    "perCustomerLimit" INTEGER, -- uses per customer
    
    -- Time-based conditions
    "startDate" TIMESTAMP,
    "endDate" TIMESTAMP,
    "timeRangeStart" TIME, -- daily time range start (e.g., 16:00 for happy hour)
    "timeRangeEnd" TIME, -- daily time range end (e.g., 18:00 for happy hour)
    "daysOfWeek" INTEGER[], -- array: [1,2,3,4,5] for Mon-Fri, [6,7] for weekends
    
    -- Coupon/code settings
    "requiresCode" BOOLEAN DEFAULT FALSE,
    "promoCode" VARCHAR(50), -- unique promo code
    "autoApply" BOOLEAN DEFAULT TRUE, -- auto-apply if conditions met
    
    -- Customer targeting
    "customerSegments" TEXT[], -- ['LOYALTY_GOLD', 'FIRST_TIME', 'BIRTHDAY', 'VIP']
    "customerTypes" TEXT[], -- ['DINE_IN', 'DELIVERY', 'TAKEAWAY']
    
    -- Priority and conflicts
    priority INTEGER DEFAULT 0, -- higher number = higher priority
    "canCombineWithOthers" BOOLEAN DEFAULT FALSE,
    
    -- Status and metadata
    "isActive" BOOLEAN DEFAULT TRUE,
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "createdBy" VARCHAR(50),
    
    -- Constraints
    UNIQUE("tenantId", "promoCode") -- unique promo codes per tenant
);

-- Promotion items - specific items affected by promotion
CREATE TABLE "promotionItems" (
    id VARCHAR(50) PRIMARY KEY,
    "promotionId" VARCHAR(50) NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
    "menuItemId" VARCHAR(50), -- specific menu item (nullable for category-based)
    "categoryId" VARCHAR(50), -- category (nullable for item-specific)
    "requiredQuantity" INTEGER DEFAULT 1, -- min quantity to trigger
    "freeQuantity" INTEGER DEFAULT 0, -- free items to give (for BOGO)
    "discountedPrice" DECIMAL(10,2), -- specific price for this item in promotion
    "isRequired" BOOLEAN DEFAULT FALSE, -- must be in cart for promotion
    "maxQuantity" INTEGER, -- max quantity this promo applies to
    
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Promotion usage tracking
CREATE TABLE "promotionUsage" (
    id VARCHAR(50) PRIMARY KEY,
    "promotionId" VARCHAR(50) NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
    "orderId" VARCHAR(50) NOT NULL,
    "customerId" VARCHAR(50), -- if customer tracking available
    "customerPhone" VARCHAR(20), -- alternative customer identification
    "discountAmount" DECIMAL(10,2) NOT NULL,
    "originalAmount" DECIMAL(10,2) NOT NULL,
    "finalAmount" DECIMAL(10,2) NOT NULL,
    "appliedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "promoCode" VARCHAR(50), -- code used if any
    
    -- Track which items were affected
    "affectedItems" JSONB -- [{menuItemId, quantity, originalPrice, discountedPrice}]
);

-- Order promotions junction table (orders can have multiple promotions)
CREATE TABLE "orderPromotions" (
    id VARCHAR(50) PRIMARY KEY,
    "orderId" VARCHAR(50) NOT NULL,
    "promotionId" VARCHAR(50) NOT NULL REFERENCES promotions(id),
    "discountAmount" DECIMAL(10,2) NOT NULL,
    "promoCode" VARCHAR(50), -- if promotion was applied via code
    "appliedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE("orderId", "promotionId") -- prevent duplicate promotion application
);

-- Customer promotion usage (if customer tracking implemented)
CREATE TABLE "customerPromotionUsage" (
    id VARCHAR(50) PRIMARY KEY,
    "customerId" VARCHAR(50), -- customer ID if available
    "customerPhone" VARCHAR(20), -- phone as fallback identifier
    "promotionId" VARCHAR(50) NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
    "usageCount" INTEGER DEFAULT 1,
    "lastUsed" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "tenantId" VARCHAR(50) NOT NULL,
    
    UNIQUE("customerId", "promotionId"),
    UNIQUE("customerPhone", "promotionId", "tenantId")
);

-- Indexes for performance
CREATE INDEX idx_promotions_tenant_active ON promotions("tenantId", "isActive");
CREATE INDEX idx_promotions_time_range ON promotions("startDate", "endDate");
CREATE INDEX idx_promotions_code ON promotions("promoCode") WHERE "promoCode" IS NOT NULL;
CREATE INDEX idx_promotion_items_menu ON "promotionItems"("menuItemId");
CREATE INDEX idx_promotion_items_category ON "promotionItems"("categoryId");
CREATE INDEX idx_promotion_usage_order ON "promotionUsage"("orderId");
CREATE INDEX idx_promotion_usage_customer ON "promotionUsage"("customerId");
CREATE INDEX idx_order_promotions_order ON "orderPromotions"("orderId");

-- Example data for common promotion scenarios
INSERT INTO promotions (id, "tenantId", name, description, type, "discountType", "discountValue", "startDate", "endDate", "timeRangeStart", "timeRangeEnd", "daysOfWeek", "isActive") VALUES
-- Happy Hour
('promo_happyhour_001', 'tenant_123', 'Happy Hour - 30% off drinks', '30% off all beverages from 4-6 PM on weekdays', 'TIME_BASED', 'PERCENTAGE', 30.00, '2024-01-01', '2024-12-31', '16:00', '18:00', ARRAY[1,2,3,4,5], TRUE),

-- Weekend Brunch
('promo_brunch_001', 'tenant_123', 'Weekend Brunch Special', 'Fixed price combo available 9 AM – 12 PM on weekends', 'TIME_BASED', 'FIXED_PRICE', NULL, '2024-01-01', '2024-12-31', '09:00', '12:00', ARRAY[6,7], TRUE),

-- BOGO
('promo_bogo_001', 'tenant_123', 'Buy 1 Get 1 Free Drinks', 'Buy any drink, get second one free', 'BOGO', 'FREE_ITEM', NULL, NULL, NULL, NULL, NULL, NULL, TRUE),

-- Cart discount
('promo_cart_001', 'tenant_123', '10% off orders over Rs. 1000', 'Get 10% discount on orders above Rs. 1000', 'CART_DISCOUNT', 'PERCENTAGE', 10.00, NULL, NULL, NULL, NULL, NULL, TRUE),

-- Coupon code
('promo_welcome_001', 'tenant_123', 'Welcome10', '10% off first order with code WELCOME10', 'COUPON', 'PERCENTAGE', 10.00, NULL, NULL, NULL, NULL, NULL, TRUE);

-- Update the promo code and settings for coupon
UPDATE promotions SET "requiresCode" = TRUE, "promoCode" = 'WELCOME10', "autoApply" = FALSE, "perCustomerLimit" = 1 WHERE id = 'promo_welcome_001';
UPDATE promotions SET "minCartValue" = 1000.00, "maxDiscountAmount" = 200.00 WHERE id = 'promo_cart_001';
UPDATE promotions SET "fixedPrice" = 349.00 WHERE id = 'promo_brunch_001';

-- Add promotion items for specific scenarios
INSERT INTO "promotionItems" (id, "promotionId", "categoryId", "requiredQuantity", "freeQuantity") VALUES
-- Happy hour applies to beverages category
('promo_item_001', 'promo_happyhour_001', 'category_beverages', 1, 0),
-- BOGO for drinks
('promo_item_002', 'promo_bogo_001', 'category_beverages', 1, 1);