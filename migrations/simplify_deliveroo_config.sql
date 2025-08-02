-- Migration: Simplify Deliveroo Configuration Table
-- This migration simplifies the table to only include what Deliveroo actually provides

-- Drop the existing table and recreate with minimal fields
DROP TABLE IF EXISTS "deliverooConfigs";

CREATE TABLE "deliverooConfigs" (
  id VARCHAR(255) PRIMARY KEY,
  "tenantId" VARCHAR(255) NOT NULL,
  "restaurantId" VARCHAR(255) NOT NULL,
  "clientId" VARCHAR(255) NOT NULL,
  "clientSecret" VARCHAR(255) NOT NULL,
  "isActive" BOOLEAN DEFAULT true,
  "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("tenantId")
);

-- Add indexes for better performance
CREATE INDEX idx_deliveroo_configs_tenant ON "deliverooConfigs"("tenantId");
CREATE INDEX idx_deliveroo_configs_restaurant ON "deliverooConfigs"("restaurantId");
CREATE INDEX idx_deliveroo_configs_active ON "deliverooConfigs"("isActive");

-- Add comments to document the table
COMMENT ON TABLE "deliverooConfigs" IS 'Stores Deliveroo API configurations for each restaurant';
COMMENT ON COLUMN "deliverooConfigs"."tenantId" IS 'Reference to the restaurant tenant';
COMMENT ON COLUMN "deliverooConfigs"."restaurantId" IS 'Deliveroo restaurant ID (provided by Deliveroo)';
COMMENT ON COLUMN "deliverooConfigs"."clientId" IS 'Deliveroo API client ID (provided by Deliveroo)';
COMMENT ON COLUMN "deliverooConfigs"."clientSecret" IS 'Deliveroo API client secret (provided by Deliveroo)';
COMMENT ON COLUMN "deliverooConfigs"."isActive" IS 'Whether this configuration is active'; 