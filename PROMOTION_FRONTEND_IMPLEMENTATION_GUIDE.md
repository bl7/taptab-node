# Promotion System Frontend Implementation Guide

## Overview

This guide provides comprehensive instructions for implementing the promotion system frontend that integrates with the TapTab backend promotion engine.

## 1. Required Frontend Components

### 1.1 Promotion Management Dashboard (Admin)

```typescript
// interfaces/promotion.ts
export interface Promotion {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  type:
    | "ITEM_DISCOUNT"
    | "COMBO_DEAL"
    | "CART_DISCOUNT"
    | "BOGO"
    | "FIXED_PRICE"
    | "TIME_BASED"
    | "COUPON";
  discountType: "PERCENTAGE" | "FIXED_AMOUNT" | "FREE_ITEM" | "FIXED_PRICE";
  discountValue?: number;
  fixedPrice?: number;
  minCartValue: number;
  maxDiscountAmount?: number;
  minItems: number;
  maxItems?: number;
  usageLimit?: number;
  usageCount: number;
  perCustomerLimit?: number;
  startDate?: string;
  endDate?: string;
  timeRangeStart?: string;
  timeRangeEnd?: string;
  daysOfWeek?: number[];
  requiresCode: boolean;
  promoCode?: string;
  autoApply: boolean;
  customerSegments: string[];
  customerTypes: string[];
  priority: number;
  canCombineWithOthers: boolean;
  isActive: boolean;
  items?: PromotionItem[];
}

export interface PromotionItem {
  id: string;
  menuItemId?: string;
  categoryId?: string;
  requiredQuantity: number;
  freeQuantity: number;
  discountedPrice?: number;
  isRequired: boolean;
  maxQuantity?: number;
  menuItemName?: string;
  categoryName?: string;
}

export interface PromotionAnalytics {
  id: string;
  name: string;
  type: string;
  discountType: string;
  total_uses: number;
  total_discount_given: number;
  total_original_amount: number;
  avg_discount_per_use: number;
}
```

### 1.2 Promotion Creation Form Component

```typescript
// components/PromotionForm.tsx
import React, { useState, useEffect } from "react";

interface PromotionFormProps {
  promotion?: Promotion;
  onSave: (promotion: Partial<Promotion>) => void;
  onCancel: () => void;
}

export const PromotionForm: React.FC<PromotionFormProps> = ({
  promotion,
  onSave,
  onCancel,
}) => {
  const [formData, setFormData] = useState<Partial<Promotion>>({
    name: "",
    description: "",
    type: "CART_DISCOUNT",
    discountType: "PERCENTAGE",
    discountValue: 0,
    minCartValue: 0,
    minItems: 1,
    autoApply: true,
    priority: 0,
    canCombineWithOthers: false,
    isActive: true,
    items: [],
  });

  const [menuItems, setMenuItems] = useState([]);
  const [categories, setCategories] = useState([]);

  useEffect(() => {
    // Load menu items and categories
    fetchMenuItems();
    fetchCategories();

    if (promotion) {
      setFormData(promotion);
    }
  }, [promotion]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };

  const addPromotionItem = () => {
    setFormData((prev) => ({
      ...prev,
      items: [
        ...(prev.items || []),
        {
          id: "",
          requiredQuantity: 1,
          freeQuantity: 0,
          isRequired: false,
        },
      ],
    }));
  };

  return (
    <form onSubmit={handleSubmit} className="promotion-form">
      {/* Basic Information */}
      <div className="form-section">
        <h3>Basic Information</h3>

        <div className="form-group">
          <label>Promotion Name *</label>
          <input
            type="text"
            value={formData.name}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, name: e.target.value }))
            }
            required
          />
        </div>

        <div className="form-group">
          <label>Description</label>
          <textarea
            value={formData.description}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, description: e.target.value }))
            }
          />
        </div>

        <div className="form-group">
          <label>Promotion Type *</label>
          <select
            value={formData.type}
            onChange={(e) =>
              setFormData((prev) => ({
                ...prev,
                type: e.target.value as Promotion["type"],
              }))
            }
            required
          >
            <option value="CART_DISCOUNT">Cart Discount</option>
            <option value="ITEM_DISCOUNT">Item Discount</option>
            <option value="BOGO">Buy One Get One</option>
            <option value="COMBO_DEAL">Combo Deal</option>
            <option value="FIXED_PRICE">Fixed Price</option>
            <option value="TIME_BASED">Time-Based</option>
            <option value="COUPON">Coupon Code</option>
          </select>
        </div>
      </div>

      {/* Discount Configuration */}
      <div className="form-section">
        <h3>Discount Configuration</h3>

        <div className="form-group">
          <label>Discount Type *</label>
          <select
            value={formData.discountType}
            onChange={(e) =>
              setFormData((prev) => ({
                ...prev,
                discountType: e.target.value as Promotion["discountType"],
              }))
            }
            required
          >
            <option value="PERCENTAGE">Percentage Off</option>
            <option value="FIXED_AMOUNT">Fixed Amount Off</option>
            <option value="FIXED_PRICE">Fixed Price</option>
            <option value="FREE_ITEM">Free Item</option>
          </select>
        </div>

        {formData.discountType === "PERCENTAGE" && (
          <div className="form-group">
            <label>Discount Percentage (%) *</label>
            <input
              type="number"
              min="0"
              max="100"
              value={formData.discountValue}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  discountValue: parseFloat(e.target.value),
                }))
              }
              required
            />
          </div>
        )}

        {formData.discountType === "FIXED_AMOUNT" && (
          <div className="form-group">
            <label>Discount Amount (Rs.) *</label>
            <input
              type="number"
              min="0"
              value={formData.discountValue}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  discountValue: parseFloat(e.target.value),
                }))
              }
              required
            />
          </div>
        )}

        {formData.discountType === "FIXED_PRICE" && (
          <div className="form-group">
            <label>Fixed Price (Rs.) *</label>
            <input
              type="number"
              min="0"
              value={formData.fixedPrice}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  fixedPrice: parseFloat(e.target.value),
                }))
              }
              required
            />
          </div>
        )}
      </div>

      {/* Conditions */}
      <div className="form-section">
        <h3>Conditions</h3>

        <div className="form-group">
          <label>Minimum Cart Value (Rs.)</label>
          <input
            type="number"
            min="0"
            value={formData.minCartValue}
            onChange={(e) =>
              setFormData((prev) => ({
                ...prev,
                minCartValue: parseFloat(e.target.value),
              }))
            }
          />
        </div>

        <div className="form-group">
          <label>Maximum Discount Amount (Rs.)</label>
          <input
            type="number"
            min="0"
            value={formData.maxDiscountAmount || ""}
            onChange={(e) =>
              setFormData((prev) => ({
                ...prev,
                maxDiscountAmount: e.target.value
                  ? parseFloat(e.target.value)
                  : undefined,
              }))
            }
          />
        </div>

        <div className="form-group">
          <label>Minimum Items</label>
          <input
            type="number"
            min="1"
            value={formData.minItems}
            onChange={(e) =>
              setFormData((prev) => ({
                ...prev,
                minItems: parseInt(e.target.value),
              }))
            }
          />
        </div>

        <div className="form-group">
          <label>Maximum Items</label>
          <input
            type="number"
            min="1"
            value={formData.maxItems || ""}
            onChange={(e) =>
              setFormData((prev) => ({
                ...prev,
                maxItems: e.target.value ? parseInt(e.target.value) : undefined,
              }))
            }
          />
        </div>
      </div>

      {/* Time-based Conditions */}
      <div className="form-section">
        <h3>Time-based Conditions</h3>

        <div className="form-group">
          <label>Start Date</label>
          <input
            type="datetime-local"
            value={formData.startDate}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, startDate: e.target.value }))
            }
          />
        </div>

        <div className="form-group">
          <label>End Date</label>
          <input
            type="datetime-local"
            value={formData.endDate}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, endDate: e.target.value }))
            }
          />
        </div>

        <div className="form-group">
          <label>Time Range</label>
          <div className="time-range">
            <input
              type="time"
              value={formData.timeRangeStart || ""}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  timeRangeStart: e.target.value,
                }))
              }
              placeholder="Start time"
            />
            <span>to</span>
            <input
              type="time"
              value={formData.timeRangeEnd || ""}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  timeRangeEnd: e.target.value,
                }))
              }
              placeholder="End time"
            />
          </div>
        </div>

        <div className="form-group">
          <label>Days of Week</label>
          <div className="days-selector">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(
              (day, index) => (
                <label key={day} className="day-checkbox">
                  <input
                    type="checkbox"
                    checked={formData.daysOfWeek?.includes(index + 1) || false}
                    onChange={(e) => {
                      const dayValue = index + 1;
                      setFormData((prev) => ({
                        ...prev,
                        daysOfWeek: e.target.checked
                          ? [...(prev.daysOfWeek || []), dayValue]
                          : (prev.daysOfWeek || []).filter(
                              (d) => d !== dayValue
                            ),
                      }));
                    }}
                  />
                  {day}
                </label>
              )
            )}
          </div>
        </div>
      </div>

      {/* Promo Code Settings */}
      <div className="form-section">
        <h3>Promo Code Settings</h3>

        <div className="form-group">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={formData.requiresCode}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  requiresCode: e.target.checked,
                }))
              }
            />
            Requires Promo Code
          </label>
        </div>

        {formData.requiresCode && (
          <div className="form-group">
            <label>Promo Code</label>
            <input
              type="text"
              value={formData.promoCode || ""}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  promoCode: e.target.value.toUpperCase(),
                }))
              }
              placeholder="e.g., WELCOME10"
            />
          </div>
        )}

        <div className="form-group">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={formData.autoApply}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  autoApply: e.target.checked,
                }))
              }
            />
            Auto Apply (if conditions met)
          </label>
        </div>
      </div>

      {/* Usage Limits */}
      <div className="form-section">
        <h3>Usage Limits</h3>

        <div className="form-group">
          <label>Total Usage Limit</label>
          <input
            type="number"
            min="1"
            value={formData.usageLimit || ""}
            onChange={(e) =>
              setFormData((prev) => ({
                ...prev,
                usageLimit: e.target.value
                  ? parseInt(e.target.value)
                  : undefined,
              }))
            }
            placeholder="Unlimited"
          />
        </div>

        <div className="form-group">
          <label>Per Customer Limit</label>
          <input
            type="number"
            min="1"
            value={formData.perCustomerLimit || ""}
            onChange={(e) =>
              setFormData((prev) => ({
                ...prev,
                perCustomerLimit: e.target.value
                  ? parseInt(e.target.value)
                  : undefined,
              }))
            }
            placeholder="Unlimited"
          />
        </div>
      </div>

      {/* Promotion Items */}
      {(formData.type === "ITEM_DISCOUNT" ||
        formData.type === "BOGO" ||
        formData.type === "COMBO_DEAL") && (
        <div className="form-section">
          <h3>Applicable Items</h3>

          {formData.items?.map((item, index) => (
            <div key={index} className="promotion-item">
              <div className="form-group">
                <label>Target</label>
                <select
                  value={item.menuItemId || item.categoryId || ""}
                  onChange={(e) => {
                    const value = e.target.value;
                    const isMenuItem = menuItems.some((mi) => mi.id === value);
                    setFormData((prev) => ({
                      ...prev,
                      items: prev.items?.map((pi, i) =>
                        i === index
                          ? {
                              ...pi,
                              menuItemId: isMenuItem ? value : undefined,
                              categoryId: isMenuItem ? undefined : value,
                            }
                          : pi
                      ),
                    }));
                  }}
                >
                  <option value="">Select item or category</option>
                  <optgroup label="Categories">
                    {categories.map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.name}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Menu Items">
                    {menuItems.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </div>

              <div className="form-group">
                <label>Required Quantity</label>
                <input
                  type="number"
                  min="1"
                  value={item.requiredQuantity}
                  onChange={(e) => {
                    setFormData((prev) => ({
                      ...prev,
                      items: prev.items?.map((pi, i) =>
                        i === index
                          ? {
                              ...pi,
                              requiredQuantity: parseInt(e.target.value),
                            }
                          : pi
                      ),
                    }));
                  }}
                />
              </div>

              {formData.type === "BOGO" && (
                <div className="form-group">
                  <label>Free Quantity</label>
                  <input
                    type="number"
                    min="0"
                    value={item.freeQuantity}
                    onChange={(e) => {
                      setFormData((prev) => ({
                        ...prev,
                        items: prev.items?.map((pi, i) =>
                          i === index
                            ? {
                                ...pi,
                                freeQuantity: parseInt(e.target.value),
                              }
                            : pi
                        ),
                      }));
                    }}
                  />
                </div>
              )}

              <div className="form-group">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={item.isRequired}
                    onChange={(e) => {
                      setFormData((prev) => ({
                        ...prev,
                        items: prev.items?.map((pi, i) =>
                          i === index
                            ? {
                                ...pi,
                                isRequired: e.target.checked,
                              }
                            : pi
                        ),
                      }));
                    }}
                  />
                  Required for promotion
                </label>
              </div>

              <button
                type="button"
                onClick={() => {
                  setFormData((prev) => ({
                    ...prev,
                    items: prev.items?.filter((_, i) => i !== index),
                  }));
                }}
                className="remove-item-btn"
              >
                Remove
              </button>
            </div>
          ))}

          <button
            type="button"
            onClick={addPromotionItem}
            className="add-item-btn"
          >
            Add Item
          </button>
        </div>
      )}

      {/* Advanced Settings */}
      <div className="form-section">
        <h3>Advanced Settings</h3>

        <div className="form-group">
          <label>Priority (higher = applied first)</label>
          <input
            type="number"
            value={formData.priority}
            onChange={(e) =>
              setFormData((prev) => ({
                ...prev,
                priority: parseInt(e.target.value),
              }))
            }
          />
        </div>

        <div className="form-group">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={formData.canCombineWithOthers}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  canCombineWithOthers: e.target.checked,
                }))
              }
            />
            Can combine with other promotions
          </label>
        </div>

        <div className="form-group">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={formData.isActive}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, isActive: e.target.checked }))
              }
            />
            Active
          </label>
        </div>
      </div>

      {/* Form Actions */}
      <div className="form-actions">
        <button type="button" onClick={onCancel} className="cancel-btn">
          Cancel
        </button>
        <button type="submit" className="save-btn">
          {promotion ? "Update" : "Create"} Promotion
        </button>
      </div>
    </form>
  );
};
```

### 1.3 Order Interface with Promotion Integration

```typescript
// components/OrderInterface.tsx
import React, { useState, useEffect } from "react";

interface OrderInterfaceProps {
  tenantSlug: string;
  tableNumber?: string;
}

export const OrderInterface: React.FC<OrderInterfaceProps> = ({
  tenantSlug,
  tableNumber,
}) => {
  const [cart, setCart] = useState([]);
  const [appliedPromoCodes, setAppliedPromoCodes] = useState<string[]>([]);
  const [promoCodeInput, setPromoCodeInput] = useState("");
  const [availablePromotions, setAvailablePromotions] = useState([]);
  const [promotionPreview, setPromotionPreview] = useState(null);
  const [customer, setCustomer] = useState({ name: "", phone: "", email: "" });

  useEffect(() => {
    // Load available auto-apply promotions
    loadAvailablePromotions();
  }, [tenantSlug]);

  useEffect(() => {
    // Preview promotions when cart changes
    if (cart.length > 0) {
      previewPromotions();
    }
  }, [cart, appliedPromoCodes]);

  const loadAvailablePromotions = async () => {
    try {
      const response = await fetch(
        `/api/v1/orders/available-promotions?tenantSlug=${tenantSlug}`
      );
      const data = await response.json();
      setAvailablePromotions(data.promotions);
    } catch (error) {
      console.error("Failed to load promotions:", error);
    }
  };

  const previewPromotions = async () => {
    try {
      const response = await fetch("/api/v1/orders/preview-promotions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: cart.map((item) => ({
            menuItemId: item.menuItemId,
            quantity: item.quantity,
          })),
          tenantSlug,
          promoCodes: appliedPromoCodes,
          customerPhone: customer.phone,
        }),
      });

      const data = await response.json();
      setPromotionPreview(data);
    } catch (error) {
      console.error("Failed to preview promotions:", error);
    }
  };

  const applyPromoCode = async () => {
    if (!promoCodeInput.trim()) return;

    try {
      const response = await fetch("/api/v1/promotions/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          promoCode: promoCodeInput.toUpperCase(),
          tenantSlug,
          customerPhone: customer.phone,
          orderItems: cart,
          cartTotal: cart.reduce((sum, item) => sum + item.totalPrice, 0),
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setAppliedPromoCodes((prev) => [...prev, promoCodeInput.toUpperCase()]);
        setPromoCodeInput("");
        alert(`Promo code applied! You save Rs. ${data.estimatedDiscount}`);
      } else {
        const error = await response.json();
        alert(error.error.message);
      }
    } catch (error) {
      alert("Failed to apply promo code");
    }
  };

  const removePromoCode = (codeToRemove: string) => {
    setAppliedPromoCodes((prev) =>
      prev.filter((code) => code !== codeToRemove)
    );
  };

  const placeOrder = async () => {
    try {
      const orderData = {
        tableId: tableNumber,
        items: cart.map((item) => ({
          menuItemId: item.menuItemId,
          quantity: item.quantity,
          notes: item.notes,
        })),
        customerName: customer.name,
        customerPhone: customer.phone,
        customerEmail: customer.email,
        appliedPromoCodes,
        autoApplyPromotions: true,
      };

      const response = await fetch("/api/v1/public/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Tenant-Slug": tenantSlug,
        },
        body: JSON.stringify(orderData),
      });

      if (response.ok) {
        const data = await response.json();
        alert("Order placed successfully!");
        setCart([]);
        setAppliedPromoCodes([]);
        setPromotionPreview(null);
      } else {
        const error = await response.json();
        alert(`Failed to place order: ${error.error.message}`);
      }
    } catch (error) {
      alert("Failed to place order");
    }
  };

  return (
    <div className="order-interface">
      {/* Customer Information */}
      <div className="customer-section">
        <h3>Customer Information</h3>
        <input
          type="text"
          placeholder="Name"
          value={customer.name}
          onChange={(e) =>
            setCustomer((prev) => ({ ...prev, name: e.target.value }))
          }
        />
        <input
          type="tel"
          placeholder="Phone Number"
          value={customer.phone}
          onChange={(e) =>
            setCustomer((prev) => ({ ...prev, phone: e.target.value }))
          }
        />
        <input
          type="email"
          placeholder="Email (optional)"
          value={customer.email}
          onChange={(e) =>
            setCustomer((prev) => ({ ...prev, email: e.target.value }))
          }
        />
      </div>

      {/* Cart Items */}
      <div className="cart-section">
        <h3>Your Order</h3>
        {cart.map((item, index) => (
          <div key={index} className="cart-item">
            <div className="item-details">
              <h4>{item.name}</h4>
              <p>Quantity: {item.quantity}</p>
              <p>
                Price: Rs. {item.unitPrice} × {item.quantity} = Rs.{" "}
                {item.totalPrice}
              </p>
            </div>
            <button onClick={() => removeFromCart(index)}>Remove</button>
          </div>
        ))}
      </div>

      {/* Available Promotions */}
      {availablePromotions.length > 0 && (
        <div className="available-promotions">
          <h3>Available Offers</h3>
          {availablePromotions.map((promo) => (
            <div key={promo.id} className="promotion-card">
              <h4>{promo.name}</h4>
              <p>{promo.description}</p>
              {promo.minCartValue > 0 && (
                <p className="condition">
                  Minimum order: Rs. {promo.minCartValue}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Promo Code Section */}
      <div className="promo-section">
        <h3>Promo Code</h3>
        <div className="promo-input">
          <input
            type="text"
            placeholder="Enter promo code"
            value={promoCodeInput}
            onChange={(e) => setPromoCodeInput(e.target.value.toUpperCase())}
          />
          <button onClick={applyPromoCode}>Apply</button>
        </div>

        {appliedPromoCodes.length > 0 && (
          <div className="applied-codes">
            <h4>Applied Codes:</h4>
            {appliedPromoCodes.map((code) => (
              <div key={code} className="applied-code">
                <span>{code}</span>
                <button onClick={() => removePromoCode(code)}>×</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Order Summary */}
      {promotionPreview && (
        <div className="order-summary">
          <h3>Order Summary</h3>
          <div className="summary-line">
            <span>Subtotal:</span>
            <span>Rs. {promotionPreview.originalSubtotal}</span>
          </div>

          {promotionPreview.promotions.applicablePromotions.map((promo) => (
            <div key={promo.promotionId} className="summary-line discount">
              <span>{promo.promotionName}:</span>
              <span>-Rs. {promo.discountAmount}</span>
            </div>
          ))}

          <div className="summary-line">
            <span>Tax (10%):</span>
            <span>
              Rs.{" "}
              {(
                (promotionPreview.originalSubtotal -
                  promotionPreview.promotions.totalDiscount) *
                0.1
              ).toFixed(2)}
            </span>
          </div>

          <div className="summary-line total">
            <span>Total:</span>
            <span>Rs. {promotionPreview.estimatedFinalAmount}</span>
          </div>

          {promotionPreview.promotions.totalDiscount > 0 && (
            <div className="savings">
              <strong>
                You Save: Rs. {promotionPreview.promotions.totalDiscount}
              </strong>
            </div>
          )}
        </div>
      )}

      {/* Place Order Button */}
      <button
        className="place-order-btn"
        onClick={placeOrder}
        disabled={cart.length === 0}
      >
        Place Order
      </button>
    </div>
  );
};
```

## 2. API Integration

### 2.1 Promotion Management API Calls

```typescript
// services/promotionApi.ts
export class PromotionAPI {
  private static baseURL = "/api/v1/promotions";

  static async getPromotions(filters?: {
    active?: boolean;
    type?: string;
    search?: string;
  }) {
    const params = new URLSearchParams(filters as any);
    const response = await fetch(`${this.baseURL}?${params}`);
    return response.json();
  }

  static async createPromotion(promotion: Partial<Promotion>) {
    const response = await fetch(this.baseURL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(promotion),
    });
    return response.json();
  }

  static async updatePromotion(id: string, promotion: Partial<Promotion>) {
    const response = await fetch(`${this.baseURL}/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(promotion),
    });
    return response.json();
  }

  static async deletePromotion(id: string) {
    const response = await fetch(`${this.baseURL}/${id}`, {
      method: "DELETE",
    });
    return response.json();
  }

  static async validatePromoCode(data: {
    promoCode: string;
    tenantSlug: string;
    customerPhone?: string;
    orderItems?: any[];
    cartTotal?: number;
  }) {
    const response = await fetch(`${this.baseURL}/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    return response.json();
  }

  static async getAnalytics(filters?: {
    startDate?: string;
    endDate?: string;
  }) {
    const params = new URLSearchParams(filters as any);
    const response = await fetch(`${this.baseURL}/analytics?${params}`);
    return response.json();
  }
}
```

### 2.2 Order Integration

```typescript
// services/orderApi.ts
export class OrderAPI {
  static async previewPromotions(data: {
    items: Array<{ menuItemId: string; quantity: number }>;
    tenantSlug: string;
    promoCodes?: string[];
    customerPhone?: string;
  }) {
    const response = await fetch("/api/v1/orders/preview-promotions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    return response.json();
  }

  static async getAvailablePromotions(tenantSlug: string) {
    const response = await fetch(
      `/api/v1/orders/available-promotions?tenantSlug=${tenantSlug}`
    );
    return response.json();
  }

  static async createOrderWithPromotions(
    orderData: {
      tableId: string;
      items: Array<{ menuItemId: string; quantity: number; notes?: string }>;
      customerName?: string;
      customerPhone?: string;
      customerEmail?: string;
      appliedPromoCodes?: string[];
      autoApplyPromotions?: boolean;
    },
    tenantSlug: string
  ) {
    const response = await fetch("/api/v1/public/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Tenant-Slug": tenantSlug,
      },
      body: JSON.stringify(orderData),
    });
    return response.json();
  }
}
```

## 3. Styling Guidelines

### 3.1 CSS Classes for Promotion Components

```css
/* promotion-components.css */

.promotion-form {
  max-width: 800px;
  margin: 0 auto;
  padding: 20px;
}

.form-section {
  margin-bottom: 30px;
  padding: 20px;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
}

.form-section h3 {
  margin-top: 0;
  color: #333;
  border-bottom: 2px solid #007bff;
  padding-bottom: 10px;
}

.form-group {
  margin-bottom: 15px;
}

.form-group label {
  display: block;
  margin-bottom: 5px;
  font-weight: bold;
  color: #555;
}

.form-group input,
.form-group select,
.form-group textarea {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 14px;
}

.form-group input:focus,
.form-group select:focus,
.form-group textarea:focus {
  outline: none;
  border-color: #007bff;
  box-shadow: 0 0 0 2px rgba(0, 123, 255, 0.25);
}

.checkbox-label {
  display: flex;
  align-items: center;
  font-weight: normal;
}

.checkbox-label input[type="checkbox"] {
  width: auto;
  margin-right: 8px;
}

.time-range {
  display: flex;
  align-items: center;
  gap: 10px;
}

.time-range input {
  flex: 1;
}

.days-selector {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.day-checkbox {
  display: flex;
  align-items: center;
  font-weight: normal;
  margin-right: 15px;
}

.day-checkbox input {
  width: auto;
  margin-right: 5px;
}

.promotion-item {
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  padding: 15px;
  margin-bottom: 15px;
  position: relative;
}

.remove-item-btn {
  position: absolute;
  top: 10px;
  right: 10px;
  background: #dc3545;
  color: white;
  border: none;
  border-radius: 4px;
  padding: 5px 10px;
  cursor: pointer;
}

.add-item-btn {
  background: #28a745;
  color: white;
  border: none;
  border-radius: 4px;
  padding: 10px 20px;
  cursor: pointer;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 30px;
}

.cancel-btn,
.save-btn {
  padding: 10px 20px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 16px;
}

.cancel-btn {
  background: #6c757d;
  color: white;
}

.save-btn {
  background: #007bff;
  color: white;
}

/* Order Interface Styles */
.order-interface {
  max-width: 600px;
  margin: 0 auto;
  padding: 20px;
}

.customer-section,
.cart-section,
.promo-section,
.order-summary {
  margin-bottom: 30px;
  padding: 20px;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
}

.cart-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 0;
  border-bottom: 1px solid #eee;
}

.cart-item:last-child {
  border-bottom: none;
}

.item-details h4 {
  margin: 0 0 5px 0;
}

.item-details p {
  margin: 0;
  color: #666;
  font-size: 14px;
}

.available-promotions {
  margin-bottom: 20px;
}

.promotion-card {
  background: #f8f9fa;
  border: 1px solid #e9ecef;
  border-radius: 6px;
  padding: 15px;
  margin-bottom: 10px;
}

.promotion-card h4 {
  margin: 0 0 10px 0;
  color: #007bff;
}

.promotion-card .condition {
  color: #666;
  font-size: 12px;
  font-style: italic;
}

.promo-input {
  display: flex;
  gap: 10px;
  margin-bottom: 15px;
}

.promo-input input {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 4px;
}

.promo-input button {
  background: #007bff;
  color: white;
  border: none;
  border-radius: 4px;
  padding: 8px 16px;
  cursor: pointer;
}

.applied-codes {
  margin-top: 15px;
}

.applied-code {
  display: inline-flex;
  align-items: center;
  background: #d4edda;
  color: #155724;
  padding: 5px 10px;
  border-radius: 4px;
  margin-right: 10px;
  margin-bottom: 5px;
}

.applied-code button {
  background: none;
  border: none;
  color: #155724;
  margin-left: 8px;
  cursor: pointer;
  font-size: 16px;
}

.summary-line {
  display: flex;
  justify-content: space-between;
  margin-bottom: 10px;
}

.summary-line.discount {
  color: #28a745;
}

.summary-line.total {
  font-weight: bold;
  font-size: 18px;
  border-top: 1px solid #ddd;
  padding-top: 10px;
  margin-top: 10px;
}

.savings {
  text-align: center;
  color: #28a745;
  margin-top: 15px;
  padding: 10px;
  background: #d4edda;
  border-radius: 4px;
}

.place-order-btn {
  width: 100%;
  background: #28a745;
  color: white;
  border: none;
  border-radius: 6px;
  padding: 15px;
  font-size: 18px;
  cursor: pointer;
  margin-top: 20px;
}

.place-order-btn:disabled {
  background: #6c757d;
  cursor: not-allowed;
}

/* Responsive Design */
@media (max-width: 768px) {
  .promotion-form,
  .order-interface {
    padding: 10px;
  }

  .time-range {
    flex-direction: column;
  }

  .days-selector {
    justify-content: center;
  }

  .form-actions {
    flex-direction: column;
  }

  .promo-input {
    flex-direction: column;
  }
}
```

## 4. State Management

### 4.1 Redux Store Structure (if using Redux)

```typescript
// store/promotionSlice.ts
import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";

export const fetchPromotions = createAsyncThunk(
  "promotions/fetchPromotions",
  async (filters?: any) => {
    const response = await PromotionAPI.getPromotions(filters);
    return response.data;
  }
);

const promotionSlice = createSlice({
  name: "promotions",
  initialState: {
    promotions: [],
    loading: false,
    error: null,
    analytics: null,
  },
  reducers: {
    clearError: (state) => {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchPromotions.pending, (state) => {
        state.loading = true;
      })
      .addCase(fetchPromotions.fulfilled, (state, action) => {
        state.loading = false;
        state.promotions = action.payload;
      })
      .addCase(fetchPromotions.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message;
      });
  },
});

export default promotionSlice.reducer;
```

## 5. Testing Considerations

### 5.1 Component Testing

```typescript
// __tests__/PromotionForm.test.tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { PromotionForm } from "../components/PromotionForm";

describe("PromotionForm", () => {
  test("renders basic form fields", () => {
    render(<PromotionForm onSave={jest.fn()} onCancel={jest.fn()} />);

    expect(screen.getByLabelText(/promotion name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/promotion type/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/discount type/i)).toBeInTheDocument();
  });

  test("validates required fields", () => {
    const onSave = jest.fn();
    render(<PromotionForm onSave={onSave} onCancel={jest.fn()} />);

    fireEvent.click(screen.getByText(/create promotion/i));

    // Form should not submit without required fields
    expect(onSave).not.toHaveBeenCalled();
  });
});
```

## 6. Performance Optimization

### 6.1 Memoization and Optimization

```typescript
// hooks/usePromotionPreview.ts
import { useState, useCallback, useMemo } from "react";
import { debounce } from "lodash";

export const usePromotionPreview = (tenantSlug: string) => {
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);

  const debouncedPreview = useCallback(
    debounce(async (items, promoCodes, customerPhone) => {
      setLoading(true);
      try {
        const data = await OrderAPI.previewPromotions({
          items,
          tenantSlug,
          promoCodes,
          customerPhone,
        });
        setPreview(data);
      } catch (error) {
        console.error("Preview failed:", error);
      } finally {
        setLoading(false);
      }
    }, 500),
    [tenantSlug]
  );

  const previewPromotions = useCallback(
    (items, promoCodes = [], customerPhone = "") => {
      if (items.length === 0) {
        setPreview(null);
        return;
      }
      debouncedPreview(items, promoCodes, customerPhone);
    },
    [debouncedPreview]
  );

  return { preview, loading, previewPromotions };
};
```

This comprehensive frontend implementation guide provides everything needed to build a modern, user-friendly promotion system that integrates seamlessly with the TapTab backend.
