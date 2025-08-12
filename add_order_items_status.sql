-- Add status field to orderItems table for kitchen management
-- This allows kitchen staff to mark individual menu items as cooked or not

ALTER TABLE "orderItems" 
ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'cooked'));

-- Add index for better performance when querying by status
CREATE INDEX IF NOT EXISTS idx_orderitems_status ON "orderItems" (status);

-- Add index for better performance when querying order items by order and status
CREATE INDEX IF NOT EXISTS idx_orderitems_order_status ON "orderItems" ("orderId", status);

-- Update existing order items to have 'pending' status
UPDATE "orderItems" SET status = 'pending' WHERE status IS NULL;

-- Add comment to document the status field
COMMENT ON COLUMN "orderItems".status IS 'Status of the order item: pending (not cooked) or cooked';
