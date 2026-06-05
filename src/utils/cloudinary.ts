// src/utils/cloudinary.ts
import { v2 as cloudinary } from 'cloudinary';
import { Readable } from 'stream';

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/**
 * Upload a single image to Cloudinary
 * @param base64Data - Base64 encoded image data
 * @param folder - Cloudinary folder to upload to
 * @returns Promise with Cloudinary upload result
 */
export const uploadToCloudinary = async (
  base64Data: string,
  folder: string = 'products'
): Promise<{ url: string; publicId: string }> => {
  try {
    const result = await cloudinary.uploader.upload(base64Data, {
      folder,
      resource_type: 'auto',
      transformation: [
        { width: 800, height: 800, crop: 'limit' },
        { quality: 'auto:good' },
        { fetch_format: 'auto' },
      ],
    });

    return {
      url: result.secure_url,
      publicId: result.public_id,
    };
  } catch (error) {
    console.error('Cloudinary upload error:', error);
    throw new Error('Failed to upload image to Cloudinary');
  }
};

/**
 * Upload multiple images to Cloudinary
 * @param base64Images - Array of base64 encoded images
 * @param folder - Cloudinary folder to upload to
 * @returns Promise with array of Cloudinary URLs
 */
export const uploadMultipleToCloudinary = async (
  base64Images: string[],
  folder: string = 'products'
): Promise<string[]> => {
  try {
    const uploadPromises = base64Images.map((base64Data) =>
      uploadToCloudinary(base64Data, folder)
    );

    const results = await Promise.all(uploadPromises);
    return results.map((result) => result.url);
  } catch (error) {
    console.error('Multiple Cloudinary upload error:', error);
    throw new Error('Failed to upload images to Cloudinary');
  }
};

/**
 * Upload digital file (for digital products)
 * @param base64Data - Base64 encoded file data
 * @param folder - Cloudinary folder to upload to
 * @returns Promise with Cloudinary upload result including file details
 */
export const uploadDigitalFileToCloudinary = async (
  base64Data: string,
  folder: string = 'digital-products'
): Promise<{
  url: string;
  publicId: string;
  fileName: string;
  fileSize: number;
  fileType: string;
}> => {
  try {
    const result = await cloudinary.uploader.upload(base64Data, {
      folder,
      resource_type: 'raw',
    });

    // Cloudinary often returns empty format for raw uploads — fall back to the
    // MIME type in the base64 data URI header.
    let fileType = result.format || '';
    if (!fileType) {
      const mimeMatch = base64Data.match(/data:([^;]+);/);
      if (mimeMatch) {
        const mime = mimeMatch[1];
        const mimeToExt: Record<string, string> = {
          'application/pdf': 'pdf',
          'application/zip': 'zip',
          'application/epub+zip': 'epub',
          'video/mp4': 'mp4',
          'audio/mpeg': 'mp3',
          'audio/mp3': 'mp3',
          'image/jpeg': 'jpg',
          'image/png': 'png',
          'application/msword': 'doc',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
          'application/vnd.ms-excel': 'xls',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
          'text/plain': 'txt',
          'application/x-zip-compressed': 'zip',
        };
        fileType = mimeToExt[mime] || mime.split('/').pop() || '';
      }
    }

    return {
      url: result.secure_url,
      publicId: result.public_id,
      fileName: result.original_filename || 'digital-file',
      fileSize: result.bytes,
      fileType,
    };
  } catch (error) {
    console.error('Cloudinary digital file upload error:', error);
    throw new Error('Failed to upload digital file to Cloudinary');
  }
};

/**
 * Delete image from Cloudinary
 * @param publicId - Cloudinary public ID of the image
 */
export const deleteFromCloudinary = async (publicId: string): Promise<void> => {
  try {
    await cloudinary.uploader.destroy(publicId);
  } catch (error) {
    console.error('Cloudinary delete error:', error);
    throw new Error('Failed to delete image from Cloudinary');
  }
};

/**
 * Delete multiple images from Cloudinary
 * @param publicIds - Array of Cloudinary public IDs
 */
export const deleteMultipleFromCloudinary = async (
  publicIds: string[]
): Promise<void> => {
  try {
    const deletePromises = publicIds.map((publicId) =>
      cloudinary.uploader.destroy(publicId)
    );
    await Promise.all(deletePromises);
  } catch (error) {
    console.error('Multiple Cloudinary delete error:', error);
    throw new Error('Failed to delete images from Cloudinary');
  }
};

export default cloudinary;