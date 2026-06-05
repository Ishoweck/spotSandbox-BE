"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteMultipleFromCloudinary = exports.deleteFromCloudinary = exports.uploadDigitalFileToCloudinary = exports.uploadMultipleToCloudinary = exports.uploadToCloudinary = void 0;
// src/utils/cloudinary.ts
const cloudinary_1 = require("cloudinary");
// Configure Cloudinary
cloudinary_1.v2.config({
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
const uploadToCloudinary = async (base64Data, folder = 'products') => {
    try {
        const result = await cloudinary_1.v2.uploader.upload(base64Data, {
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
    }
    catch (error) {
        console.error('Cloudinary upload error:', error);
        throw new Error('Failed to upload image to Cloudinary');
    }
};
exports.uploadToCloudinary = uploadToCloudinary;
/**
 * Upload multiple images to Cloudinary
 * @param base64Images - Array of base64 encoded images
 * @param folder - Cloudinary folder to upload to
 * @returns Promise with array of Cloudinary URLs
 */
const uploadMultipleToCloudinary = async (base64Images, folder = 'products') => {
    try {
        const uploadPromises = base64Images.map((base64Data) => (0, exports.uploadToCloudinary)(base64Data, folder));
        const results = await Promise.all(uploadPromises);
        return results.map((result) => result.url);
    }
    catch (error) {
        console.error('Multiple Cloudinary upload error:', error);
        throw new Error('Failed to upload images to Cloudinary');
    }
};
exports.uploadMultipleToCloudinary = uploadMultipleToCloudinary;
/**
 * Upload digital file (for digital products)
 * @param base64Data - Base64 encoded file data
 * @param folder - Cloudinary folder to upload to
 * @returns Promise with Cloudinary upload result including file details
 */
const uploadDigitalFileToCloudinary = async (base64Data, folder = 'digital-products') => {
    try {
        const result = await cloudinary_1.v2.uploader.upload(base64Data, {
            folder,
            resource_type: 'raw',
        });
        return {
            url: result.secure_url,
            publicId: result.public_id,
            fileName: result.original_filename || 'digital-file',
            fileSize: result.bytes,
            fileType: result.format,
        };
    }
    catch (error) {
        console.error('Cloudinary digital file upload error:', error);
        throw new Error('Failed to upload digital file to Cloudinary');
    }
};
exports.uploadDigitalFileToCloudinary = uploadDigitalFileToCloudinary;
/**
 * Delete image from Cloudinary
 * @param publicId - Cloudinary public ID of the image
 */
const deleteFromCloudinary = async (publicId) => {
    try {
        await cloudinary_1.v2.uploader.destroy(publicId);
    }
    catch (error) {
        console.error('Cloudinary delete error:', error);
        throw new Error('Failed to delete image from Cloudinary');
    }
};
exports.deleteFromCloudinary = deleteFromCloudinary;
/**
 * Delete multiple images from Cloudinary
 * @param publicIds - Array of Cloudinary public IDs
 */
const deleteMultipleFromCloudinary = async (publicIds) => {
    try {
        const deletePromises = publicIds.map((publicId) => cloudinary_1.v2.uploader.destroy(publicId));
        await Promise.all(deletePromises);
    }
    catch (error) {
        console.error('Multiple Cloudinary delete error:', error);
        throw new Error('Failed to delete images from Cloudinary');
    }
};
exports.deleteMultipleFromCloudinary = deleteMultipleFromCloudinary;
exports.default = cloudinary_1.v2;
//# sourceMappingURL=cloudinary.js.map