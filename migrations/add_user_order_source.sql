-- Migration: Add User-based Order Source Tracking
-- This migration adds fields to track which user took each order

-- Add new columns to orders table
ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS "orderSource" VARCHAR(50) DEFAULT 'INTERNAL',
ADD COLUMN IF NOT EXISTS "sourceDetails" VARCHAR(255),
ADD COLUMN IF NOT EXISTS "createdByUserId" VARCHAR(255),
ADD COLUMN IF NOT EXISTS "createdByUserName" VARCHAR(255),
ADD COLUMN IF NOT EXISTS "deliverooOrderId" VARCHAR(255),
ADD COLUMN IF NOT EXISTS "deliverooReference" VARCHAR(255),
ADD COLUMN IF NOT EXISTS "customerAddress" TEXT,
ADD COLUMN IF NOT EXISTS "estimatedDeliveryTime" TIMESTAMP,
ADD COLUMN IF NOT EXISTS "specialInstructions" TEXT;

-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_orders_order_source ON orders("orderSource");
CREATE INDEX IF NOT EXISTS idx_orders_source_details ON orders("sourceDetails");
CREATE INDEX IF NOT EXISTS idx_orders_created_by_user ON orders("createdByUserId");
CREATE INDEX IF NOT EXISTS idx_orders_deliveroo_order_id ON orders("deliverooOrderId");
CREATE INDEX IF NOT EXISTS idx_orders_deliveroo_reference ON orders("deliverooReference");

-- Update existing orders to have INTERNAL as orderSource
UPDATE orders SET "orderSource" = 'INTERNAL' WHERE "orderSource" IS NULL;

-- Add comment to document the new fields
COMMENT ON COLUMN orders."orderSource" IS 'Source of the order: INTERNAL, QR_ORDERING, WAITER_ORDERING, CASHIER_ORDERING, MANAGER_ORDERING, DELIVEROO';
COMMENT ON COLUMN orders."sourceDetails" IS 'Additional details about the order source (e.g., waiter name, customer name)';
COMMENT ON COLUMN orders."createdByUserId" IS 'ID of the user who created the order';
COMMENT ON COLUMN orders."createdByUserName" IS 'Name of the user who created the order';
COMMENT ON COLUMN orders."deliverooOrderId" IS 'Original Deliveroo order ID';
COMMENT ON COLUMN orders."deliverooReference" IS 'Deliveroo order reference number';
COMMENT ON COLUMN orders."customerAddress" IS 'Customer delivery address for external orders';
COMMENT ON COLUMN orders."estimatedDeliveryTime" IS 'Estimated delivery time for external orders';
COMMENT ON COLUMN orders."specialInstructions" IS 'Special delivery instructions'; 