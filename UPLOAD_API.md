# Image Upload API

This API provides endpoints for uploading images to Cloudinary and managing them.

## Configuration

Make sure you have the following environment variables set in your `.env` file:

```env
CLOUDINARY_CLOUD_NAME=your-cloudinary-cloud-name
CLOUDINARY_API_KEY=your-cloudinary-api-key
CLOUDINARY_API_SECRET=your-cloudinary-api-secret
```

## Endpoints

### Upload Single Image

**POST** `/api/v1/upload/image`

Upload a single image to Cloudinary.

**Headers:**
- `Authorization: Bearer <jwt-token>` (required)
- `X-Tenant-ID: <tenant-id>` (required)
- `Content-Type: multipart/form-data`

**Body:**
- `image` (file): The image file to upload (max 10MB)

**Response:**
```json
{
  "success": true,
  "data": {
    "url": "https://res.cloudinary.com/your-cloud/image/upload/v1234567890/taptab/image.jpg",
    "publicId": "taptab/image",
    "width": 800,
    "height": 600,
    "format": "jpg",
    "size": 45678
  },
  "timestamp": "2024-01-01T12:00:00.000Z"
}
```

### Upload Multiple Images

**POST** `/api/v1/upload/images`

Upload multiple images to Cloudinary (max 10 images).

**Headers:**
- `Authorization: Bearer <jwt-token>` (required)
- `X-Tenant-ID: <tenant-id>` (required)
- `Content-Type: multipart/form-data`

**Body:**
- `images` (files): Array of image files to upload (max 10MB each)

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "url": "https://res.cloudinary.com/your-cloud/image/upload/v1234567890/taptab/image1.jpg",
      "publicId": "taptab/image1",
      "width": 800,
      "height": 600,
      "format": "jpg",
      "size": 45678
    },
    {
      "url": "https://res.cloudinary.com/your-cloud/image/upload/v1234567890/taptab/image2.jpg",
      "publicId": "taptab/image2",
      "width": 800,
      "height": 600,
      "format": "jpg",
      "size": 45678
    }
  ],
  "timestamp": "2024-01-01T12:00:00.000Z"
}
```

### Delete Image

**DELETE** `/api/v1/upload/image/:publicId`

Delete an image from Cloudinary.

**Headers:**
- `Authorization: Bearer <jwt-token>` (required)
- `X-Tenant-ID: <tenant-id>` (required)

**Parameters:**
- `publicId` (string): The Cloudinary public ID of the image to delete

**Response:**
```json
{
  "success": true,
  "data": {
    "message": "Image deleted successfully",
    "publicId": "taptab/image"
  },
  "timestamp": "2024-01-01T12:00:00.000Z"
}
```

## Features

- **File Size Limit**: 10MB per image
- **File Type Validation**: Only image files are allowed
- **Automatic Optimization**: Images are automatically resized and optimized
- **Folder Organization**: All images are stored in the `taptab` folder on Cloudinary
- **Secure URLs**: Returns HTTPS URLs for secure access
- **Error Handling**: Comprehensive error responses with appropriate HTTP status codes

## Error Responses

### No File Provided
```json
{
  "success": false,
  "error": {
    "code": "NO_FILE_PROVIDED",
    "message": "No image file provided"
  },
  "timestamp": "2024-01-01T12:00:00.000Z"
}
```

### Upload Failed
```json
{
  "success": false,
  "error": {
    "code": "UPLOAD_FAILED",
    "message": "Failed to upload image"
  },
  "timestamp": "2024-01-01T12:00:00.000Z"
}
```

### Invalid File Type
```json
{
  "success": false,
  "error": {
    "code": "INVALID_FILE_TYPE",
    "message": "Only image files are allowed"
  },
  "timestamp": "2024-01-01T12:00:00.000Z"
}
```

## Testing

You can test the upload functionality using the provided test script:

### Local Development
```bash
node test-upload.js
```

### Production/Staging Environment
```bash
# Set environment variables
export API_BASE_URL="https://your-api-domain.com"
export JWT_TOKEN="your-jwt-token"
export API_VERSION="v1"

# Run the test
node test-upload.js
```

### Using Environment Variables
You can also create a `.env` file for testing:
```env
API_BASE_URL=https://your-api-domain.com
JWT_TOKEN=your-jwt-token-here
API_VERSION=v1
```

Then run:
```bash
node -r dotenv/config test-upload.js
```

Make sure to:
1. Replace `JWT_TOKEN` with a valid token from your auth endpoint
2. Replace `tenant-id` with a valid tenant ID
3. Ensure your Cloudinary credentials are properly configured
4. Update `API_BASE_URL` to match your deployment environment

## Example Usage

### Using cURL

#### Local Development
```bash
# Upload single image
curl -X POST http://localhost:5050/api/v1/upload/image \
  -H "Authorization: Bearer your-jwt-token" \
  -H "X-Tenant-ID: your-tenant-id" \
  -F "image=@/path/to/your/image.jpg"

# Upload multiple images
curl -X POST http://localhost:5050/api/v1/upload/images \
  -H "Authorization: Bearer your-jwt-token" \
  -H "X-Tenant-ID: your-tenant-id" \
  -F "images=@/path/to/image1.jpg" \
  -F "images=@/path/to/image2.jpg"

# Delete image
curl -X DELETE http://localhost:5050/api/v1/upload/image/taptab/image \
  -H "Authorization: Bearer your-jwt-token" \
  -H "X-Tenant-ID: your-tenant-id"
```

#### Production/Staging Environment
```bash
# Upload single image
curl -X POST https://your-api-domain.com/api/v1/upload/image \
  -H "Authorization: Bearer your-jwt-token" \
  -H "X-Tenant-ID: your-tenant-id" \
  -F "image=@/path/to/your/image.jpg"

# Upload multiple images
curl -X POST https://your-api-domain.com/api/v1/upload/images \
  -H "Authorization: Bearer your-jwt-token" \
  -H "X-Tenant-ID: your-tenant-id" \
  -F "images=@/path/to/image1.jpg" \
  -F "images=@/path/to/image2.jpg"

# Delete image
curl -X DELETE https://your-api-domain.com/api/v1/upload/image/taptab/image \
  -H "Authorization: Bearer your-jwt-token" \
  -H "X-Tenant-ID: your-tenant-id"
```

### Using JavaScript/Fetch

```javascript
// Configuration - change based on environment
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:5050';
const API_VERSION = process.env.API_VERSION || 'v1';

// Upload single image
const formData = new FormData();
formData.append('image', fileInput.files[0]);

const response = await fetch(`${API_BASE_URL}/api/${API_VERSION}/upload/image`, {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer your-jwt-token',
    'X-Tenant-ID': 'your-tenant-id'
  },
  body: formData
});

const result = await response.json();
console.log('Image URL:', result.data.url);
``` 