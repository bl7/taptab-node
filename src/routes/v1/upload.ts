import { Router } from 'express';
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import { logger } from '../../utils/logger';

const router = Router();

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Check file type
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  },
});

// Upload single image
router.post('/image', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'NO_FILE_PROVIDED',
          message: 'No image file provided',
        },
        timestamp: new Date().toISOString(),
      });
    }

    // Convert buffer to base64
    const b64 = Buffer.from(req.file.buffer).toString('base64');
    const dataURI = `data:${req.file.mimetype};base64,${b64}`;

    // Upload to Cloudinary
    console.log('=== CLOUDINARY UPLOAD ===');
    console.log('Cloudinary config:', {
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY ? 'SET' : 'NOT SET',
      api_secret: process.env.CLOUDINARY_API_SECRET ? 'SET' : 'NOT SET'
    });
    
    const result = await cloudinary.uploader.upload(dataURI, {
      folder: 'taptab',
      resource_type: 'image',
      transformation: [
        { width: 800, height: 800, crop: 'limit' }, // Resize if too large
        { quality: 'auto' }, // Optimize quality
      ],
    });

    if (!result) {
      throw new Error('Cloudinary upload returned null/undefined result');
    }

    logger.info(`Image uploaded to Cloudinary: ${result.public_id}`);

    const responseData = {
      url: result.secure_url,
      publicId: result.public_id,
      width: result.width,
      height: result.height,
      format: result.format,
      size: result.bytes,
    };

    console.log('=== UPLOAD RESPONSE ===');
    console.log('Full response:', JSON.stringify(responseData, null, 2));
    console.log('URL:', responseData.url);
    console.log('Response structure keys:', Object.keys(responseData));
    console.log('=======================');

    res.json(responseData);
  } catch (error) {
    console.error('=== UPLOAD ERROR ===');
    console.error('Error details:', error);
    console.error('Error message:', (error as Error).message);
    console.error('Error stack:', (error as Error).stack);
    console.error('====================');
    
    logger.error('Image upload error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'UPLOAD_FAILED',
        message: `Failed to upload image: ${(error as Error).message}`,
      },
      timestamp: new Date().toISOString(),
    });
  }
});

// Upload multiple images
router.post('/images', upload.array('images', 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'NO_FILES_PROVIDED',
          message: 'No image files provided',
        },
        timestamp: new Date().toISOString(),
      });
    }

    const uploadPromises = (req.files as Express.Multer.File[]).map(async (file) => {
      const b64 = Buffer.from(file.buffer).toString('base64');
      const dataURI = `data:${file.mimetype};base64,${b64}`;

      return cloudinary.uploader.upload(dataURI, {
        folder: 'taptab',
        resource_type: 'image',
        transformation: [
          { width: 800, height: 800, crop: 'limit' },
          { quality: 'auto' },
        ],
      });
    });

    const results = await Promise.all(uploadPromises);

    logger.info(`Multiple images uploaded to Cloudinary: ${results.length} files`);

    res.json({
      success: true,
      data: results.map(result => ({
        url: result.secure_url,
        publicId: result.public_id,
        width: result.width,
        height: result.height,
        format: result.format,
        size: result.bytes,
      })),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Multiple images upload error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'UPLOAD_FAILED',
        message: `Failed to upload images: ${(error as Error).message}`,
      },
      timestamp: new Date().toISOString(),
    });
  }
});

// Delete image from Cloudinary
router.delete('/image/:publicId', async (req, res) => {
  try {
    const { publicId } = req.params;

    if (!publicId) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'PUBLIC_ID_REQUIRED',
          message: 'Public ID is required',
        },
        timestamp: new Date().toISOString(),
      });
    }

    const result = await cloudinary.uploader.destroy(publicId);

    if (result.result === 'ok') {
      logger.info(`Image deleted from Cloudinary: ${publicId}`);
      
      res.json({
        success: true,
        data: {
          message: 'Image deleted successfully',
          publicId: publicId,
        },
        timestamp: new Date().toISOString(),
      });
    } else {
      res.status(400).json({
        success: false,
        error: {
          code: 'DELETE_FAILED',
          message: 'Failed to delete image',
        },
        timestamp: new Date().toISOString(),
      });
    }
  } catch (error) {
    logger.error('Image deletion error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'DELETE_FAILED',
        message: `Failed to delete image: ${(error as Error).message}`,
      },
      timestamp: new Date().toISOString(),
    });
  }
});

export default router; 