const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const axios = require('axios');

// Test configuration - Change these values based on your environment
const BASE_URL = process.env.API_BASE_URL || 'http://localhost:5050';
const API_VERSION = process.env.API_VERSION || 'v1';

// You'll need to get a valid JWT token from your auth endpoint
const JWT_TOKEN = process.env.JWT_TOKEN || 'your-jwt-token-here'; // Replace with actual token

async function testImageUpload() {
  try {
    console.log('🧪 Testing image upload functionality...\n');

    // Create a simple test image (1x1 pixel PNG)
    const testImageBuffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    
    // Create form data
    const formData = new FormData();
    formData.append('image', testImageBuffer, {
      filename: 'test-image.png',
      contentType: 'image/png'
    });

    console.log('📤 Uploading test image...');

    const response = await axios.post(`${BASE_URL}/api/${API_VERSION}/upload/image`, formData, {
      headers: {
        ...formData.getHeaders(),
        'Authorization': `Bearer ${JWT_TOKEN}`,
        'X-Tenant-ID': 'your-tenant-id' // Replace with actual tenant ID
      },
      timeout: 30000
    });

    console.log('✅ Upload successful!');
    console.log('📊 Response:', JSON.stringify(response.data, null, 2));

    if (response.data.success && response.data.data.url) {
      console.log('\n🔗 Image URL:', response.data.data.url);
      console.log('🆔 Public ID:', response.data.data.publicId);
      console.log('📏 Dimensions:', `${response.data.data.width}x${response.data.data.height}`);
      console.log('💾 File size:', `${(response.data.data.size / 1024).toFixed(2)} KB`);
    }

  } catch (error) {
    console.error('❌ Upload failed:', error.response?.data || error.message);
    
    if (error.response?.status === 401) {
      console.log('\n💡 Make sure to:');
      console.log('1. Replace JWT_TOKEN with a valid token from /api/v1/auth/login');
      console.log('2. Replace tenant-id with a valid tenant ID');
    }
  }
}

async function testMultipleImageUpload() {
  try {
    console.log('\n🧪 Testing multiple image upload...\n');

    // Create multiple test images
    const testImageBuffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    
    const formData = new FormData();
    formData.append('images', testImageBuffer, {
      filename: 'test-image-1.png',
      contentType: 'image/png'
    });
    formData.append('images', testImageBuffer, {
      filename: 'test-image-2.png',
      contentType: 'image/png'
    });

    console.log('📤 Uploading multiple test images...');

    const response = await axios.post(`${BASE_URL}/api/${API_VERSION}/upload/images`, formData, {
      headers: {
        ...formData.getHeaders(),
        'Authorization': `Bearer ${JWT_TOKEN}`,
        'X-Tenant-ID': 'your-tenant-id'
      },
      timeout: 30000
    });

    console.log('✅ Multiple upload successful!');
    console.log('📊 Response:', JSON.stringify(response.data, null, 2));

    if (response.data.success && response.data.data.length > 0) {
      console.log(`\n📸 Uploaded ${response.data.data.length} images:`);
      response.data.data.forEach((image, index) => {
        console.log(`${index + 1}. ${image.url}`);
      });
    }

  } catch (error) {
    console.error('❌ Multiple upload failed:', error.response?.data || error.message);
  }
}

// Run tests
async function runTests() {
  console.log('🚀 Starting upload tests...\n');
  
  await testImageUpload();
  await testMultipleImageUpload();
  
  console.log('\n✨ Tests completed!');
}

runTests().catch(console.error); 