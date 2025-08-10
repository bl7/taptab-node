-- Simple Promotions System for Restaurant
-- Basic promotions: Happy Hour, BOGO, Percentage Off, Fixed Amount Off

CREATE TABLE IF NOT EXISTS promotions (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    type VARCHAR(20) NOT NULL CHECK (type IN ('HAPPY_HOUR', 'BOGO', 'PERCENTAGE_OFF', 'FIXED_OFF')),
    
    -- Discount details
    discount_value DECIMAL(10,2), -- Percentage or fixed amount
    min_order_amount DECIMAL(10,2) DEFAULT 0,
    max_discount_amount DECIMAL(10,2), -- For percentage discounts
    
    -- BOGO specific
    buy_quantity INTEGER DEFAULT 1,
    get_quantity INTEGER DEFAULT 1,
    buy_target_type VARCHAR(20) CHECK (buy_target_type IN ('ALL', 'CATEGORY', 'PRODUCTS')),
    buy_target_category_id VARCHAR(50),
    buy_target_product_ids TEXT[], -- Array of product IDs for "buy" items
    get_target_type VARCHAR(20) CHECK (get_target_type IN ('ALL', 'CATEGORY', 'PRODUCTS')),
    get_target_category_id VARCHAR(50),
    get_target_product_ids TEXT[], -- Array of product IDs for "get" items
    
    -- Happy Hour specific
    start_time TIME,
    end_time TIME,
    days_of_week INTEGER[], -- [1,2,3,4,5,6,7] for Monday-Sunday
    
    -- Product/Category targeting (for non-BOGO promotions)
    target_type VARCHAR(20) CHECK (target_type IN ('ALL', 'CATEGORY', 'PRODUCTS')),
    target_category_id VARCHAR(50),
    target_product_ids TEXT[], -- Array of product IDs
    
    -- General settings
    "tenantId" TEXT NOT NULL,
    "isActive" BOOLEAN DEFAULT TRUE,
    priority INTEGER DEFAULT 1, -- Higher number = higher priority
    "startDate" DATE,
    "endDate" DATE,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT fk_promotions_tenant FOREIGN KEY ("tenantId") REFERENCES tenants(id) ON DELETE CASCADE,
    CONSTRAINT fk_promotions_category FOREIGN KEY (target_category_id) REFERENCES categories(id) ON DELETE SET NULL,
    CONSTRAINT fk_promotions_buy_category FOREIGN KEY (buy_target_category_id) REFERENCES categories(id) ON DELETE SET NULL,
    CONSTRAINT fk_promotions_get_category FOREIGN KEY (get_target_category_id) REFERENCES categories(id) ON DELETE SET NULL
);

-- Indexes for performance
CREATE INDEX idx_promotions_tenant ON promotions("tenantId");
CREATE INDEX idx_promotions_active ON promotions("isActive");
CREATE INDEX idx_promotions_type ON promotions(type);
CREATE INDEX idx_promotions_dates ON promotions("startDate", "endDate");

-- Sample data for testing
INSERT INTO promotions (id, name, description, type, discount_value, "tenantId") VALUES
('promo_001', 'Happy Hour 20% Off', '20% off all drinks during happy hour', 'HAPPY_HOUR', 20.0, 'your-tenant-id-here'),
('promo_002', 'Buy 2 Get 1 Free Pizza', 'Buy 2 pizzas, get 1 free', 'BOGO', NULL, 'your-tenant-id-here'),
('promo_003', '10% Off Appetizers', '10% off all appetizer category', 'PERCENTAGE_OFF', 10.0, 'your-tenant-id-here');
