// Example usage of the new batch modify endpoint
// PUT /api/v1/orders/:id/modify-batch

const axios = require('axios');

// Example request body for batch modification
const batchModifyRequest = {
  changes: [
    {
      action: "remove_item",
      itemId: "item_1754121213685_fhtow", // Coca Cola
      reason: "Customer request"
    },
    {
      action: "change_quantity", 
      itemId: "item_1754130836233_zgdv9", // Pepsi
      quantity: 3,
      notes: "Customer wants more"
    },
    {
      action: "add_item",
      itemId: "item_1754240646561_pfton", // Fries
      quantity: 2,
      notes: "Add fries"
    }
  ]
};

// Example API call
async function testBatchModify() {
  try {
    const response = await axios.put(
      'http://localhost:5050/api/v1/orders/order_1754298603055_8xgre/modify-batch',
      batchModifyRequest,
      {
        headers: {
          'Authorization': 'Bearer YOUR_JWT_TOKEN',
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log('Batch modify response:', response.data);
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
  }
}

// This will trigger ONE notification with all changes combined
// Notification will include:
// - addedItems: [Fries]
// - removedItems: [Coca Cola] 
// - modifiedItems: [Pepsi quantity change]
// - modificationType: "mixed"

console.log('Batch modify endpoint created!');
console.log('Use this to send multiple changes in one API call');
console.log('This will trigger ONE notification instead of multiple'); 