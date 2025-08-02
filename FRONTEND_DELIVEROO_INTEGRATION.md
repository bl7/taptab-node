# Frontend Deliveroo Integration Guide

This guide shows how to integrate Deliveroo features into your React/Vue frontend application.

## 🎯 **Features Available**

### **1. Deliveroo Configuration Management**
- ✅ **Setup/Update** restaurant-specific Deliveroo credentials
- ✅ **Test connection** to Deliveroo API
- ✅ **Deactivate** Deliveroo integration

### **2. Order Management**
- ✅ **View Deliveroo orders** in your POS
- ✅ **Update order status** (syncs with Deliveroo)
- ✅ **Real-time notifications** via WebSocket

### **3. Menu Management**
- ✅ **Sync menu** from POS to Deliveroo
- ✅ **Manage categories** and items
- ✅ **Update availability** and pricing

### **4. Site Management**
- ✅ **Update restaurant status** (open/closed/busy)
- ✅ **Manage opening hours**
- ✅ **Control workload mode**

## 🚀 **Frontend Implementation**

### **1. Deliveroo Configuration Component**

```jsx
// components/DeliverooConfig.jsx
import React, { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';

const DeliverooConfig = () => {
  const { token } = useAuth();
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    restaurantId: '',
    clientId: '',
    clientSecret: '',
    apiUrl: 'https://api.deliveroo.com/v1',
    webhookSecret: ''
  });

  // Fetch current configuration
  const fetchConfig = async () => {
    try {
      const response = await fetch('/api/v1/deliveroo-config', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await response.json();
      if (data.success && data.data.config) {
        setConfig(data.data.config);
        setFormData({
          restaurantId: data.data.config.restaurantId || '',
          clientId: data.data.config.clientId || '',
          clientSecret: '', // Never show existing secret
          apiUrl: data.data.config.apiUrl || 'https://api.deliveroo.com/v1',
          webhookSecret: ''
        });
      }
    } catch (error) {
      console.error('Failed to fetch config:', error);
    }
  };

  // Save configuration
  const saveConfig = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/v1/deliveroo-config', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(formData)
      });
      const data = await response.json();
      if (data.success) {
        alert('Deliveroo configuration saved successfully!');
        fetchConfig();
      } else {
        alert(`Error: ${data.error.message}`);
      }
    } catch (error) {
      alert('Failed to save configuration');
    } finally {
      setLoading(false);
    }
  };

  // Test connection
  const testConnection = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/v1/deliveroo-config/test', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await response.json();
      if (data.success) {
        alert('✅ Connection test successful!');
      } else {
        alert(`❌ Connection failed: ${data.error.message}`);
      }
    } catch (error) {
      alert('Connection test failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConfig();
  }, []);

  return (
    <div className="deliveroo-config">
      <h2>Deliveroo Integration</h2>
      
      <div className="config-form">
        <h3>API Configuration</h3>
        
        <div className="form-group">
          <label>Restaurant ID</label>
          <input
            type="text"
            value={formData.restaurantId}
            onChange={(e) => setFormData({...formData, restaurantId: e.target.value})}
            placeholder="Your Deliveroo restaurant ID"
          />
        </div>

        <div className="form-group">
          <label>Client ID</label>
          <input
            type="text"
            value={formData.clientId}
            onChange={(e) => setFormData({...formData, clientId: e.target.value})}
            placeholder="Deliveroo API Client ID"
          />
        </div>

        <div className="form-group">
          <label>Client Secret</label>
          <input
            type="password"
            value={formData.clientSecret}
            onChange={(e) => setFormData({...formData, clientSecret: e.target.value})}
            placeholder="Deliveroo API Client Secret"
          />
        </div>

        <div className="form-group">
          <label>API URL</label>
          <input
            type="text"
            value={formData.apiUrl}
            onChange={(e) => setFormData({...formData, apiUrl: e.target.value})}
            placeholder="https://api.deliveroo.com/v1"
          />
        </div>

        <div className="form-group">
          <label>Webhook Secret (Optional)</label>
          <input
            type="password"
            value={formData.webhookSecret}
            onChange={(e) => setFormData({...formData, webhookSecret: e.target.value})}
            placeholder="Webhook signature secret"
          />
        </div>

        <div className="form-actions">
          <button 
            onClick={saveConfig} 
            disabled={loading}
            className="btn btn-primary"
          >
            {loading ? 'Saving...' : 'Save Configuration'}
          </button>
          
          <button 
            onClick={testConnection} 
            disabled={loading || !config}
            className="btn btn-secondary"
          >
            Test Connection
          </button>
        </div>
      </div>

      {config && (
        <div className="config-status">
          <h3>Current Configuration</h3>
          <p><strong>Restaurant ID:</strong> {config.restaurantId}</p>
          <p><strong>Client ID:</strong> {config.clientId}</p>
          <p><strong>API URL:</strong> {config.apiUrl}</p>
          <p><strong>Status:</strong> <span className="status-active">Active</span></p>
        </div>
      )}
    </div>
  );
};

export default DeliverooConfig;
```

### **2. Deliveroo Orders Component**

```jsx
// components/DeliverooOrders.jsx
import React, { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useWebSocket } from '../hooks/useWebSocket';

const DeliverooOrders = () => {
  const { token } = useAuth();
  const { socket } = useWebSocket();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);

  // Fetch Deliveroo orders
  const fetchOrders = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/v1/deliveroo/orders', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await response.json();
      if (data.success) {
        setOrders(data.data.orders || []);
      }
    } catch (error) {
      console.error('Failed to fetch orders:', error);
    } finally {
      setLoading(false);
    }
  };

  // Update order status
  const updateOrderStatus = async (orderId, status) => {
    try {
      const response = await fetch(`/api/v1/deliveroo/orders/${orderId}/status`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ status })
      });
      const data = await response.json();
      if (data.success) {
        // Refresh orders
        fetchOrders();
      } else {
        alert(`Error: ${data.error.message}`);
      }
    } catch (error) {
      alert('Failed to update order status');
    }
  };

  // Listen for new Deliveroo orders via WebSocket
  useEffect(() => {
    if (socket) {
      socket.on('new_order', (order) => {
        if (order.source === 'DELIVEROO') {
          setOrders(prev => [order, ...prev]);
        }
      });

      return () => {
        socket.off('new_order');
      };
    }
  }, [socket]);

  useEffect(() => {
    fetchOrders();
  }, []);

  return (
    <div className="deliveroo-orders">
      <h2>Deliveroo Orders</h2>
      
      <div className="orders-header">
        <button onClick={fetchOrders} disabled={loading} className="btn btn-secondary">
          {loading ? 'Loading...' : 'Refresh Orders'}
        </button>
      </div>

      <div className="orders-list">
        {orders.map(order => (
          <div key={order.id} className="order-card deliveroo-order">
            <div className="order-header">
              <h3>Order #{order.reference}</h3>
              <span className={`status status-${order.status}`}>
                {order.status}
              </span>
            </div>
            
            <div className="order-details">
              <p><strong>Customer:</strong> {order.customer.name}</p>
              <p><strong>Phone:</strong> {order.customer.phone}</p>
              <p><strong>Address:</strong> {order.customer.address}</p>
              <p><strong>Total:</strong> ${order.total.amount}</p>
              {order.estimated_delivery_time && (
                <p><strong>Delivery Time:</strong> {new Date(order.estimated_delivery_time).toLocaleString()}</p>
              )}
              {order.special_instructions && (
                <p><strong>Special Instructions:</strong> {order.special_instructions}</p>
              )}
            </div>

            <div className="order-items">
              <h4>Items:</h4>
              {order.items.map(item => (
                <div key={item.id} className="order-item">
                  <span>{item.quantity}x {item.name}</span>
                  <span>${item.price}</span>
                  {item.notes && <span className="notes">({item.notes})</span>}
                </div>
              ))}
            </div>

            <div className="order-actions">
              <select 
                value={order.status} 
                onChange={(e) => updateOrderStatus(order.id, e.target.value)}
                className="status-select"
              >
                <option value="accepted">Accepted</option>
                <option value="confirmed">Confirmed</option>
                <option value="ready_for_pickup">Ready for Pickup</option>
                <option value="picked_up">Picked Up</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
          </div>
        ))}
      </div>

      {orders.length === 0 && !loading && (
        <div className="no-orders">
          <p>No Deliveroo orders found</p>
        </div>
      )}
    </div>
  );
};

export default DeliverooOrders;
```

### **3. Menu Sync Component**

```jsx
// components/DeliverooMenuSync.jsx
import React, { useState } from 'react';
import { useAuth } from '../hooks/useAuth';

const DeliverooMenuSync = () => {
  const { token } = useAuth();
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);

  // Sync menu to Deliveroo
  const syncMenu = async () => {
    setSyncing(true);
    setSyncResult(null);
    
    try {
      const response = await fetch('/api/v1/deliveroo/sync/menu', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await response.json();
      setSyncResult(data);
      
      if (data.success) {
        alert(`✅ Menu synced successfully! ${data.data.synced} items synced.`);
      } else {
        alert(`❌ Sync failed: ${data.error.message}`);
      }
    } catch (error) {
      alert('Failed to sync menu');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="deliveroo-menu-sync">
      <h2>Menu Synchronization</h2>
      
      <div className="sync-info">
        <p>Sync your POS menu to Deliveroo platform</p>
        <ul>
          <li>Categories will be created automatically</li>
          <li>Items will be synced with prices and descriptions</li>
          <li>Availability status will be updated</li>
        </ul>
      </div>

      <div className="sync-actions">
        <button 
          onClick={syncMenu} 
          disabled={syncing}
          className="btn btn-primary"
        >
          {syncing ? 'Syncing...' : 'Sync Menu to Deliveroo'}
        </button>
      </div>

      {syncResult && (
        <div className="sync-result">
          <h3>Sync Result</h3>
          <pre>{JSON.stringify(syncResult, null, 2)}</pre>
        </div>
      )}
    </div>
  );
};

export default DeliverooMenuSync;
```

### **4. Site Management Component**

```jsx
// components/DeliverooSiteManagement.jsx
import React, { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';

const DeliverooSiteManagement = () => {
  const { token } = useAuth();
  const [siteInfo, setSiteInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('open');
  const [openingHours, setOpeningHours] = useState([]);

  // Fetch site information
  const fetchSiteInfo = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/v1/deliveroo/site', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await response.json();
      if (data.success) {
        setSiteInfo(data.data.site);
        setStatus(data.data.site.status);
        setOpeningHours(data.data.site.opening_hours || []);
      }
    } catch (error) {
      console.error('Failed to fetch site info:', error);
    } finally {
      setLoading(false);
    }
  };

  // Update site status
  const updateStatus = async () => {
    try {
      const response = await fetch('/api/v1/deliveroo/site/status', {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ status })
      });
      const data = await response.json();
      if (data.success) {
        alert('✅ Status updated successfully!');
        fetchSiteInfo();
      } else {
        alert(`❌ Failed to update status: ${data.error.message}`);
      }
    } catch (error) {
      alert('Failed to update status');
    }
  };

  // Update opening hours
  const updateOpeningHours = async () => {
    try {
      const response = await fetch('/api/v1/deliveroo/site/opening-hours', {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ opening_hours: openingHours })
      });
      const data = await response.json();
      if (data.success) {
        alert('✅ Opening hours updated successfully!');
        fetchSiteInfo();
      } else {
        alert(`❌ Failed to update hours: ${data.error.message}`);
      }
    } catch (error) {
      alert('Failed to update opening hours');
    }
  };

  useEffect(() => {
    fetchSiteInfo();
  }, []);

  return (
    <div className="deliveroo-site-management">
      <h2>Site Management</h2>
      
      {loading ? (
        <p>Loading site information...</p>
      ) : (
        <>
          <div className="status-section">
            <h3>Restaurant Status</h3>
            <div className="status-controls">
              <select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="open">Open</option>
                <option value="closed">Closed</option>
                <option value="busy">Busy</option>
              </select>
              <button onClick={updateStatus} className="btn btn-primary">
                Update Status
              </button>
            </div>
          </div>

          <div className="hours-section">
            <h3>Opening Hours</h3>
            <div className="opening-hours">
              {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((day, index) => (
                <div key={day} className="day-row">
                  <span className="day-name">{day}</span>
                  <input
                    type="time"
                    value={openingHours[index]?.open_time || ''}
                    onChange={(e) => {
                      const newHours = [...openingHours];
                      if (!newHours[index]) newHours[index] = {};
                      newHours[index] = { ...newHours[index], open_time: e.target.value };
                      setOpeningHours(newHours);
                    }}
                  />
                  <span>to</span>
                  <input
                    type="time"
                    value={openingHours[index]?.close_time || ''}
                    onChange={(e) => {
                      const newHours = [...openingHours];
                      if (!newHours[index]) newHours[index] = {};
                      newHours[index] = { ...newHours[index], close_time: e.target.value };
                      setOpeningHours(newHours);
                    }}
                  />
                  <label>
                    <input
                      type="checkbox"
                      checked={openingHours[index]?.closed || false}
                      onChange={(e) => {
                        const newHours = [...openingHours];
                        if (!newHours[index]) newHours[index] = {};
                        newHours[index] = { ...newHours[index], closed: e.target.checked };
                        setOpeningHours(newHours);
                      }}
                    />
                    Closed
                  </label>
                </div>
              ))}
            </div>
            <button onClick={updateOpeningHours} className="btn btn-primary">
              Update Opening Hours
            </button>
          </div>

          {siteInfo && (
            <div className="site-info">
              <h3>Current Site Information</h3>
              <p><strong>Name:</strong> {siteInfo.name}</p>
              <p><strong>Status:</strong> {siteInfo.status}</p>
              <p><strong>Workload Mode:</strong> {siteInfo.workload_mode || 'Normal'}</p>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default DeliverooSiteManagement;
```

### **5. Main Deliveroo Dashboard**

```jsx
// pages/DeliverooDashboard.jsx
import React, { useState } from 'react';
import DeliverooConfig from '../components/DeliverooConfig';
import DeliverooOrders from '../components/DeliverooOrders';
import DeliverooMenuSync from '../components/DeliverooMenuSync';
import DeliverooSiteManagement from '../components/DeliverooSiteManagement';

const DeliverooDashboard = () => {
  const [activeTab, setActiveTab] = useState('config');

  const tabs = [
    { id: 'config', label: 'Configuration', component: DeliverooConfig },
    { id: 'orders', label: 'Orders', component: DeliverooOrders },
    { id: 'menu', label: 'Menu Sync', component: DeliverooMenuSync },
    { id: 'site', label: 'Site Management', component: DeliverooSiteManagement }
  ];

  const ActiveComponent = tabs.find(tab => tab.id === activeTab)?.component;

  return (
    <div className="deliveroo-dashboard">
      <h1>Deliveroo Integration</h1>
      
      <div className="tabs">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`tab ${activeTab === tab.id ? 'active' : ''}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="tab-content">
        {ActiveComponent && <ActiveComponent />}
      </div>
    </div>
  );
};

export default DeliverooDashboard;
```

## 🎨 **CSS Styles**

```css
/* deliveroo-dashboard.css */
.deliveroo-dashboard {
  padding: 20px;
}

.tabs {
  display: flex;
  border-bottom: 1px solid #ddd;
  margin-bottom: 20px;
}

.tab {
  padding: 10px 20px;
  border: none;
  background: none;
  cursor: pointer;
  border-bottom: 2px solid transparent;
}

.tab.active {
  border-bottom-color: #007bff;
  color: #007bff;
}

.deliveroo-config {
  max-width: 600px;
}

.config-form {
  background: #f8f9fa;
  padding: 20px;
  border-radius: 8px;
  margin-bottom: 20px;
}

.form-group {
  margin-bottom: 15px;
}

.form-group label {
  display: block;
  margin-bottom: 5px;
  font-weight: bold;
}

.form-group input {
  width: 100%;
  padding: 8px;
  border: 1px solid #ddd;
  border-radius: 4px;
}

.form-actions {
  display: flex;
  gap: 10px;
  margin-top: 20px;
}

.btn {
  padding: 10px 20px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.btn-primary {
  background: #007bff;
  color: white;
}

.btn-secondary {
  background: #6c757d;
  color: white;
}

.deliveroo-orders {
  max-width: 800px;
}

.order-card {
  border: 1px solid #ddd;
  border-radius: 8px;
  padding: 15px;
  margin-bottom: 15px;
  background: white;
}

.deliveroo-order {
  border-left: 4px solid #ff6b35;
}

.order-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.status {
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: bold;
}

.status-accepted { background: #fff3cd; color: #856404; }
.status-confirmed { background: #d1ecf1; color: #0c5460; }
.status-ready_for_pickup { background: #d4edda; color: #155724; }
.status-picked_up { background: #cce5ff; color: #004085; }
.status-cancelled { background: #f8d7da; color: #721c24; }

.order-items {
  margin: 10px 0;
}

.order-item {
  display: flex;
  justify-content: space-between;
  padding: 5px 0;
  border-bottom: 1px solid #eee;
}

.notes {
  color: #666;
  font-style: italic;
}

.status-select {
  padding: 5px;
  border: 1px solid #ddd;
  border-radius: 4px;
}

.deliveroo-menu-sync,
.deliveroo-site-management {
  max-width: 600px;
}

.sync-info {
  background: #e7f3ff;
  padding: 15px;
  border-radius: 8px;
  margin-bottom: 20px;
}

.sync-info ul {
  margin: 10px 0;
  padding-left: 20px;
}

.opening-hours {
  margin: 15px 0;
}

.day-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.day-name {
  width: 100px;
  font-weight: bold;
}

.day-row input[type="time"] {
  padding: 5px;
  border: 1px solid #ddd;
  border-radius: 4px;
}

.site-info {
  background: #f8f9fa;
  padding: 15px;
  border-radius: 8px;
  margin-top: 20px;
}
```

## 🔧 **Setup Instructions**

### **1. Add to your routing**
```jsx
// App.jsx or router configuration
import DeliverooDashboard from './pages/DeliverooDashboard';

// Add to your routes
<Route path="/deliveroo" element={<DeliverooDashboard />} />
```

### **2. Add navigation link**
```jsx
// In your navigation menu
<Link to="/deliveroo" className="nav-link">
  <i className="fas fa-truck"></i>
  Deliveroo
</Link>
```

### **3. Update your WebSocket hook**
```jsx
// hooks/useWebSocket.js
useEffect(() => {
  if (socket) {
    // Listen for Deliveroo orders
    socket.on('new_order', (order) => {
      if (order.source === 'DELIVEROO') {
        // Handle new Deliveroo order
        console.log('New Deliveroo order:', order);
      }
    });
  }
}, [socket]);
```

## 🎯 **Next Steps**

1. **Test the configuration** with your Deliveroo credentials
2. **Update API endpoints** based on actual Deliveroo documentation
3. **Customize the UI** to match your design system
4. **Add error handling** and loading states
5. **Implement real-time updates** via WebSocket

This provides a complete frontend integration for managing your Deliveroo presence! 