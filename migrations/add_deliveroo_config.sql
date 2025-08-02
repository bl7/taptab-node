-- Migration: Add Deliveroo Configuration Table
-- This migration creates a table to store restaurant-specific Deliveroo configurations

-- Create deliveroo_configs table
CREATE TABLE IF NOT EXISTS "deliverooConfigs" (
  id VARCHAR(255) PRIMARY KEY,
  "tenantId" VARCHAR(255) NOT NULL,
  "restaurantId" VARCHAR(255) NOT NULL,
  "clientId" VARCHAR(255) NOT NULL,
  "clientSecret" VARCHAR(255) NOT NULL,
  "apiUrl" VARCHAR(255) DEFAULT 'https://api.deliveroo.com/v1',
  "webhookSecret" VARCHAR(255),
  "isActive" BOOLEAN DEFAULT true,
  "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("tenantId")
);

-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_deliveroo_configs_tenant ON "deliverooConfigs"("tenantId");
CREATE INDEX IF NOT EXISTS idx_deliveroo_configs_restaurant ON "deliverooConfigs"("restaurantId");
CREATE INDEX IF NOT EXISTS idx_deliveroo_configs_active ON "deliverooConfigs"("isActive");

-- Add comments to document the table
COMMENT ON TABLE "deliverooConfigs" IS 'Stores Deliveroo API configurations for each restaurant';
COMMENT ON COLUMN "deliverooConfigs"."tenantId" IS 'Reference to the restaurant tenant';
COMMENT ON COLUMN "deliverooConfigs"."restaurantId" IS 'Deliveroo restaurant ID';
COMMENT ON COLUMN "deliverooConfigs"."clientId" IS 'Deliveroo API client ID';
COMMENT ON COLUMN "deliverooConfigs"."clientSecret" IS 'Deliveroo API client secret';
COMMENT ON COLUMN "deliverooConfigs"."apiUrl" IS 'Deliveroo API base URL';
COMMENT ON COLUMN "deliverooConfigs"."webhookSecret" IS 'Webhook signature secret for verification';
COMMENT ON COLUMN "deliverooConfigs"."isActive" IS 'Whether this configuration is active'; 