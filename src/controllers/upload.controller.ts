import { Response } from 'express';
import { AuthRequest, ApiResponse } from '../types';
import { AppError } from '../middleware/error';
import cloudinary from '../utils/cloudinary';
import { logger } from '../utils/logger';
import VendorProfile from '../models/VendorProfile';
import { markKycSubmitted, notifyKycUploaded } from '../utils/kycReview';

export class UploadController {
  /**
   * Upload vendor image to Cloudinary
   */
  async uploadVendorImage(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    if (!req.file) {
      throw new AppError('No image file provided', 400);
    }

    const type = req.body.type || 'logo'; // 'logo' or 'banner'

    try {
      // Upload to Cloudinary
      const result = await new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            folder: `vendor/${type}s`,
            transformation: type === 'logo' 
              ? [{ width: 400, height: 400, crop: 'fill' }]
              : [{ width: 1200, height: 400, crop: 'fill' }],
          },
          (error, result) => {
            if (error) reject(error);
            else resolve(result);
          }
        );

        uploadStream.end(req.file!.buffer);
      });

      const cloudinaryResult = result as any;

      logger.info(`Vendor ${type} uploaded: ${cloudinaryResult.secure_url}`);

      res.json({
        success: true,
        message: `${type.charAt(0).toUpperCase() + type.slice(1)} uploaded successfully`,
        data: {
          url: cloudinaryResult.secure_url,
          publicId: cloudinaryResult.public_id,
        },
      });
    } catch (error) {
      logger.error('Upload error:', error);
      throw new AppError('Failed to upload image', 500);
    }
  }

  /**
   * ✅ NEW METHOD - Upload KYC document to Cloudinary
   * Supports images (jpg, png) and PDFs
   */
  async uploadKYCDocument(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    if (!req.file) {
      throw new AppError('No document file provided', 400);
    }

    const { type } = req.body; // 'CAC', 'ID_CARD', 'UTILITY_BILL', 'PASSPORT', 'DRIVERS_LICENSE'

    const validTypes = ['NIN', 'CAC', 'ID_CARD', 'UTILITY_BILL', 'PASSPORT', 'DRIVERS_LICENSE'];
    
    if (!type || !validTypes.includes(type)) {
      throw new AppError(`Invalid document type. Must be one of: ${validTypes.join(', ')}`, 400);
    }

    try {
      // Determine resource type based on file mimetype
      const resourceType = req.file.mimetype === 'application/pdf' ? 'raw' : 'image';

      // Upload to Cloudinary
      const result = await new Promise((resolve, reject) => {
        const uploadOptions: any = {
          folder: `kyc-documents/${req.user?.id}`,
          resource_type: resourceType,
        };

        // For images, add optimization transformation
        if (resourceType === 'image') {
          uploadOptions.transformation = [
            { width: 1500, height: 1500, crop: 'limit', quality: 'auto' }
          ];
        }

        const uploadStream = cloudinary.uploader.upload_stream(
          uploadOptions,
          (error, result) => {
            if (error) reject(error);
            else resolve(result);
          }
        );

        uploadStream.end(req.file!.buffer);
      });

      const cloudinaryResult = result as any;

      logger.info(`KYC document uploaded for user ${req.user?.id}:`, {
        type,
        url: cloudinaryResult.secure_url,
      });

      // Save document to vendor profile immediately
      const vendorProfile = await VendorProfile.findOne({ user: req.user?.id });
      if (vendorProfile) {
        // Remove any existing document of this type, then add the new one
        vendorProfile.kycDocuments = vendorProfile.kycDocuments.filter(
          (doc: any) => doc.type !== type
        );
        vendorProfile.kycDocuments.push({
          type,
          documentUrl: cloudinaryResult.secure_url,
          verificationStatus: 'pending',
        });
        markKycSubmitted(vendorProfile, [type]);
        await vendorProfile.save();
        logger.info(`KYC document saved to vendor profile: ${type}`);
        notifyKycUploaded(vendorProfile, [type], { id: req.user?.id, email: (req.user as any)?.email });
      }

      res.json({
        success: true,
        message: 'Document uploaded successfully',
        data: {
          url: cloudinaryResult.secure_url,
          publicId: cloudinaryResult.public_id,
          type,
          format: cloudinaryResult.format,
          size: cloudinaryResult.bytes,
        },
      });
    } catch (error) {
      logger.error('Upload KYC document error:', error);
      throw new AppError('Failed to upload document', 500);
    }
  }
}

export const uploadController = new UploadController();