import { Response } from 'express';
import { AuthRequest, ApiResponse } from '../types';
import Product from '../models/Product';
import Order from '../models/Order';
import User from '../models/User';
import { AppError } from '../middleware/error';
import { generateLicenseKey } from '../utils/helpers';
import { logger } from '../utils/logger';
import crypto from 'crypto';

export class DigitalProductController {
  /**
   * Upload digital product file
   */
  async uploadDigitalFile(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const { productId } = req.params;
    const { fileUrl, fileName, fileSize, fileType, version } = req.body;

    const product = await Product.findOne({
      _id: productId,
      vendor: req.user?.id,
    });

    if (!product) {
      throw new AppError('Product not found', 404);
    }

    if (product.productType !== 'digital') {
      throw new AppError('Product is not a digital product', 400);
    }

    // Update digital file details
    product.digitalFile = {
      url: fileUrl,
      fileName,
      fileSize,
      fileType,
      version: version || '1.0.0',
      uploadedAt: new Date(),
    };

    await product.save();

    logger.info(`Digital file uploaded for product: ${productId}`);

    res.json({
      success: true,
      message: 'Digital file uploaded successfully',
      data: { product },
    });
  }

  /**
   * Generate license key for digital product
   */
  async generateLicense(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const { orderId, itemId } = req.body;

    const order = await Order.findById(orderId);
    if (!order) {
      throw new AppError('Order not found', 404);
    }

    if (order.paymentStatus !== 'completed') {
      throw new AppError('Order payment not completed', 400);
    }

    // Find the specific item
    const item = order.items.find((i: any) => i._id.toString() === itemId);
    if (!item) {
      throw new AppError('Order item not found', 404);
    }

    const product = await Product.findById(item.product);
    if (!product || product.productType !== 'digital') {
      throw new AppError('Product is not a digital product', 404);
    }

    // Check if license already exists
    if (product.requiresLicense) {
      const existingLicense = (product as any).licenses?.find(
        (l: any) => l.orderId.toString() === orderId && l.userId.toString() === order.user.toString()
      );

      if (existingLicense) {
        res.json({
          success: true,
          message: 'License already exists',
          data: { license: existingLicense },
        });
        return;
      }
    }

    // Generate new license key
    const licenseKey = generateLicenseKey();

    // Store license in product
    if (!product.licenses) {
      (product as any).licenses = [];
    }

    const license = {
      key: licenseKey,
      userId: order.user,
      orderId: order._id,
      activatedAt: null,
      expiresAt: product.licenseType === 'lifetime' ? null : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      isActive: true,
      deviceInfo: null,
    };

    (product as any).licenses.push(license);
    await product.save();

    logger.info(`License generated: ${licenseKey} for order ${orderId}`);

    res.json({
      success: true,
      message: 'License key generated successfully',
      data: { license },
    });
  }

  /**
   * Activate license key
   */
  async activateLicense(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const { licenseKey, deviceInfo } = req.body;

    // Find product with this license
    const product = await Product.findOne({
      'licenses.key': licenseKey,
    });

    if (!product) {
      throw new AppError('Invalid license key', 404);
    }

    const license = (product as any).licenses.find((l: any) => l.key === licenseKey);

    if (!license) {
      throw new AppError('License not found', 404);
    }

    if (license.userId.toString() !== req.user?.id) {
      throw new AppError('License does not belong to you', 403);
    }

    if (!license.isActive) {
      throw new AppError('License is deactivated', 400);
    }

    if (license.expiresAt && new Date() > license.expiresAt) {
      throw new AppError('License has expired', 400);
    }

    // Activate license
    if (!license.activatedAt) {
      license.activatedAt = new Date();
    }

    license.deviceInfo = deviceInfo;
    await product.save();

    logger.info(`License activated: ${licenseKey}`);

    res.json({
      success: true,
      message: 'License activated successfully',
      data: {
        license: {
          key: license.key,
          activatedAt: license.activatedAt,
          expiresAt: license.expiresAt,
          isActive: license.isActive,
        },
        product: {
          id: product._id,
          name: product.name,
          version: product.digitalFile?.version,
        },
      },
    });
  }

  /**
   * Get download link for purchased digital product
   */
  async getDownloadLink(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const { orderId, itemId } = req.params;

    const order = await Order.findOne({
      _id: orderId,
      user: req.user?.id,
    });

    if (!order) {
      throw new AppError('Order not found', 404);
    }

    if (order.paymentStatus !== 'completed') {
      throw new AppError('Order payment not completed', 400);
    }

    // Find the specific item
    const item = order.items.find((i: any) => i._id.toString() === itemId);
    if (!item) {
      throw new AppError('Order item not found', 404);
    }

    const product = await Product.findById(item.product);
    if (!product || product.productType !== 'digital') {
      throw new AppError('Product is not a digital product', 404);
    }

    if (!product.digitalFile?.url) {
      throw new AppError('Digital file not available', 404);
    }

    // For external links, return the URL directly without generating a token
    if ((product.digitalFile as any).isExternalLink) {
      logger.info(`External link accessed for order ${orderId}, product ${product._id}`);
      res.json({
        success: true,
        message: 'Access link retrieved',
        data: {
          downloadUrl: product.digitalFile.url,
          fileName: product.digitalFile.fileName,
          fileSize: product.digitalFile.fileSize,
          version: product.digitalFile.version,
        },
      });
      return;
    }

    // Generate temporary download token (valid for 1 hour)
    const downloadToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // Store download token (in production, use Redis or database)
    const downloadLink = {
      token: downloadToken,
      productId: product._id,
      userId: req.user?.id,
      orderId: order._id,
      expiresAt,
      url: product.digitalFile.url,
    };

    // Log download
    logger.info(`Download link generated for order ${orderId}, product ${product._id}`);

    res.json({
      success: true,
      message: 'Download link generated',
      data: {
        downloadUrl: `${process.env.API_URL}/api/v1/digital/download/${downloadToken}`,
        expiresAt,
        fileName: product.digitalFile.fileName,
        fileSize: product.digitalFile.fileSize,
        version: product.digitalFile.version,
      },
    });
  }

  /**
   * Process download (with token validation)
   */
  async processDownload(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const { token } = req.params;

    // In production, retrieve download info from Redis/database
    // For now, we'll validate the token format
    if (!token || token.length !== 64) {
      throw new AppError('Invalid download token', 400);
    }

    // This would redirect to the actual file or serve it
    // Implementation depends on file storage (S3, Cloudinary, etc.)

    logger.info(`Download processed with token: ${token}`);

    res.json({
      success: true,
      message: 'Download started',
      data: {
        status: 'processing',
      },
    });
  }

  /**
   * Get user's digital products
   */
  async getUserDigitalProducts(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    // Find all orders with completed payment
    const orders = await Order.find({
      user: req.user?.id,
      paymentStatus: 'completed',
    }).populate('items.product');

    // Extract digital products
    const digitalProducts: any[] = [];

    orders.forEach((order) => {
      order.items.forEach((item: any) => {
        if (item.product && item.product.type === 'digital') {
          digitalProducts.push({
            orderId: order._id,
            orderNumber: order.orderNumber,
            itemId: item._id,
            product: {
              id: item.product._id,
              name: item.product.name,
              slug: item.product.slug,
              image: item.product.images[0],
              type: item.product.type,
              version: item.product.digitalFile?.version,
              requiresLicense: item.product.requiresLicense,
            },
            purchasedAt: (order as any).createdAt,
          });
        }
      });
    });

    res.json({
      success: true,
      data: { digitalProducts },
    });
  }

  /**
   * Get user's licenses
   */
  async getUserLicenses(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    // Find all products where user has licenses
    const products = await Product.find({
      'licenses.userId': req.user?.id,
    }).select('name slug licenses');

    const userLicenses = products
      .map((product) => {
        const licenses = (product as any).licenses.filter(
          (l: any) => l.userId.toString() === req.user?.id
        );

        return licenses.map((license: any) => ({
          productId: product._id,
          productName: product.name,
          productSlug: product.slug,
          licenseKey: license.key,
          activatedAt: license.activatedAt,
          expiresAt: license.expiresAt,
          isActive: license.isActive,
        }));
      })
      .flat();

    res.json({
      success: true,
      data: { licenses: userLicenses },
    });
  }

  /**
   * Verify license (for software validation)
   */
  async verifyLicense(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const { licenseKey, productId } = req.body;

    const product = await Product.findById(productId);
    if (!product) {
      throw new AppError('Product not found', 404);
    }

    const license = (product as any).licenses?.find((l: any) => l.key === licenseKey);

    if (!license) {
      res.json({
        success: false,
        message: 'Invalid license key',
        data: { valid: false },
      });
      return;
    }

    // Check expiry
    if (license.expiresAt && new Date() > license.expiresAt) {
      res.json({
        success: false,
        message: 'License has expired',
        data: { valid: false, expired: true },
      });
      return;
    }

    // Check if active
    if (!license.isActive) {
      res.json({
        success: false,
        message: 'License is deactivated',
        data: { valid: false, deactivated: true },
      });
      return;
    }

    res.json({
      success: true,
      message: 'License is valid',
      data: {
        valid: true,
        license: {
          key: license.key,
          activatedAt: license.activatedAt,
          expiresAt: license.expiresAt,
        },
        product: {
          name: product.name,
          version: product.digitalFile?.version,
        },
      },
    });
  }

  /**
   * Deactivate license (Admin or Owner)
   */
  async deactivateLicense(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const { licenseKey } = req.body;

    const product = await Product.findOne({
      'licenses.key': licenseKey,
    });

    if (!product) {
      throw new AppError('License not found', 404);
    }

    const license = (product as any).licenses.find((l: any) => l.key === licenseKey);

    if (!license) {
      throw new AppError('License not found', 404);
    }

    license.isActive = false;
    await product.save();

    logger.info(`License deactivated: ${licenseKey}`);

    res.json({
      success: true,
      message: 'License deactivated successfully',
    });
  }

  /**
   * Get digital product analytics (Vendor)
   */
  async getDigitalProductAnalytics(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const { productId } = req.params;

    const product = await Product.findOne({
      _id: productId,
      vendor: req.user?.id,
      type: 'digital',
    });

    if (!product) {
      throw new AppError('Product not found', 404);
    }

    // Get orders containing this product
    const orders = await Order.find({
      'items.product': productId,
      paymentStatus: 'completed',
    });

    const totalSales = orders.length;
    const totalRevenue = orders.reduce((sum, order) => {
      const item = order.items.find((i) => i.product.toString() === productId);
      return sum + (item ? item.price * item.quantity : 0);
    }, 0);

    // License statistics
    const totalLicenses = (product as any).licenses?.length || 0;
    const activeLicenses =
      (product as any).licenses?.filter((l: any) => l.isActive).length || 0;
    const activatedLicenses =
      (product as any).licenses?.filter((l: any) => l.activatedAt).length || 0;

    res.json({
      success: true,
      data: {
        product: {
          id: product._id,
          name: product.name,
          version: product.digitalFile?.version,
        },
        sales: {
          total: totalSales,
          revenue: totalRevenue,
        },
        licenses: {
          total: totalLicenses,
          active: activeLicenses,
          activated: activatedLicenses,
          activationRate:
            totalLicenses > 0 ? ((activatedLicenses / totalLicenses) * 100).toFixed(2) : 0,
        },
      },
    });
  }
}

export const digitalProductController = new DigitalProductController();
