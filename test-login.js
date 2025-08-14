const axios = require('axios');

// Configuration
const BASE_URL = process.env.BASE_URL || 'http://localhost:5050';
const API_VERSION = 'v1';

// Test credentials (you'll need to update these with real user data)
const TEST_EMAIL = 'test@example.com';
const TEST_PIN = '123456';

async function testLogin() {
  try {
    console.log('🔐 Testing login route...');
    console.log(`📍 URL: ${BASE_URL}/api/${API_VERSION}/auth/login`);
    console.log(`📧 Email: ${TEST_EMAIL}`);
    console.log(`🔢 PIN: ${TEST_PIN}`);

    const response = await axios.post(`${BASE_URL}/api/${API_VERSION}/auth/login`, {
      email: TEST_EMAIL,
      pin: TEST_PIN
    }, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    console.log('✅ Login successful!');
    console.log('📋 Response:', JSON.stringify(response.data, null, 2));
    
    // Test token verification
    if (response.data.data && response.data.data.token) {
      console.log('\n🔍 Testing token verification...');
      
      const verifyResponse = await axios.post(`${BASE_URL}/api/${API_VERSION}/auth/verify`, {
        token: response.data.data.token
      }, {
        headers: {
          'Content-Type': 'application/json'
        }
      });

      console.log('✅ Token verification successful!');
      console.log('📋 Verification response:', JSON.stringify(verifyResponse.data, null, 2));
    }

  } catch (error) {
    console.error('❌ Login failed:', error.response?.data || error.message);
    
    if (error.response?.status === 401) {
      console.log('\n💡 This might be expected if the test credentials are not in your database.');
      console.log('💡 Make sure you have a user with the test email and PIN in your users table.');
    }
  }
}

// Test invalid PIN format
async function testInvalidPinFormat() {
  try {
    console.log('\n🧪 Testing invalid PIN format...');
    
    const response = await axios.post(`${BASE_URL}/api/${API_VERSION}/auth/login`, {
      email: TEST_EMAIL,
      pin: '12345' // 5 digits instead of 6
    }, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    console.log('❌ Should have failed with validation error');
  } catch (error) {
    if (error.response?.status === 400) {
      console.log('✅ Correctly rejected invalid PIN format');
      console.log('📋 Error:', error.response.data);
    } else {
      console.error('❌ Unexpected error:', error.response?.data || error.message);
    }
  }
}

// Test missing fields
async function testMissingFields() {
  try {
    console.log('\n🧪 Testing missing fields...');
    
    const response = await axios.post(`${BASE_URL}/api/${API_VERSION}/auth/login`, {
      email: TEST_EMAIL
      // Missing PIN
    }, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    console.log('❌ Should have failed with validation error');
  } catch (error) {
    if (error.response?.status === 400) {
      console.log('✅ Correctly rejected missing fields');
      console.log('📋 Error:', error.response.data);
    } else {
      console.error('❌ Unexpected error:', error.response?.data || error.message);
    }
  }
}

// Run all tests
async function runTests() {
  console.log('🚀 Starting login route tests...\n');
  
  await testLogin();
  await testInvalidPinFormat();
  await testMissingFields();
  
  console.log('\n✨ All tests completed!');
}

runTests();
