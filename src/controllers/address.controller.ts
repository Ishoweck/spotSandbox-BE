// controllers/address.controller.ts
import { Response } from 'express';
import { AuthRequest, ApiResponse } from '../types';
import User from '../models/User';
import Product from '../models/Product';
import { AppError } from '../middleware/error';
import { shipBubbleService } from '../services/shipbubble.service';
import { logger } from '../utils/logger';
import mongoose from 'mongoose';

/**
 * Products store a frozen snapshot of the vendor's chosen pickup address, and
 * that snapshot is what ShipBubble uses as the sender. Re-point every product
 * that was copied from `source` at `target` (or clear it so the product falls
 * back to the vendor's business address when `target` is null).
 *
 * Snapshots created before addressId was recorded are matched on
 * street/city/state of the source address instead.
 */
function pickupSnapshotFilter(
  vendorId: any,
  source: { _id?: any; street?: string; city?: string; state?: string },
) {
  return {
    vendor: vendorId,
    $or: [
      { 'pickupAddress.addressId': source._id },
      {
        'pickupAddress.addressId': { $exists: false },
        'pickupAddress.street': source.street,
        'pickupAddress.city': source.city,
        'pickupAddress.state': source.state,
      },
    ],
  };
}

function pickupSnapshotFrom(address: any) {
  return {
    addressId: address._id,
    street: address.street,
    city: address.city,
    state: address.state,
    country: address.country || 'Nigeria',
    fullName: address.fullName || '',
    phone: address.phone || '',
    shipBubble: address.shipBubble,
  };
}

async function syncProductPickupSnapshots(
  vendorId: any,
  source: { _id?: any; street?: string; city?: string; state?: string },
  target: any | null,
): Promise<number> {
  const update = target
    ? { $set: { pickupAddress: pickupSnapshotFrom(target) } }
    : { $unset: { pickupAddress: 1 } };

  const result = await Product.updateMany(pickupSnapshotFilter(vendorId, source), update);
  return result.modifiedCount;
}

export class AddressController {
  /**
   * Get all addresses for current user
   */
  async getAddresses(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const user = await User.findById(req.user?.id);
    
    if (!user) {
      throw new AppError('User not found', 404);
    }

    res.json({
      success: true,
      data: {
        addresses: user.addresses || [],
      },
    });
  }

  /**
   * Get single address by index/id
   */
  async getAddress(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const { id } = req.params;
    
    const user = await User.findById(req.user?.id);
    
    if (!user) {
      throw new AppError('User not found', 404);
    }

    // Find address by matching the generated _id
    const address = user.addresses?.find(addr => addr._id?.toString() === id);
    
    if (!address) {
      throw new AppError('Address not found', 404);
    }

    res.json({
      success: true,
      data: { address },
    });
  }

  /**
   * Create new address with ShipBubble validation
   */
  async createAddress(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const { label, fullName, phone, street, city, state, country, postalCode, isDefault, applyToAllProducts } = req.body;
    
    const user = await User.findById(req.user?.id);
    
    if (!user) {
      throw new AppError('User not found', 404);
    }

    // Validate address with ShipBubble
    let shipBubbleData;
    try {
      logger.info('📍 Validating address with ShipBubble:', {
        fullName,
        street,
        city,
        state,
      });

      // Construct full address string for better validation
      const fullAddress = `${street}, ${city}, ${state}, ${country || 'Nigeria'}`;

      const validationResult = await shipBubbleService.validateAddress({
        name: fullName,
        email: user.email,
        phone: phone,
        address: fullAddress,
      });

      shipBubbleData = {
        addressCode: validationResult.address_code,
        formattedAddress: validationResult.formatted_address,
        city: validationResult.city,
        state: validationResult.state,
        country: validationResult.country,
        postalCode: validationResult.postal_code,
        latitude: validationResult.latitude,
        longitude: validationResult.longitude,
      };

      logger.info('✅ Address validated with ShipBubble:', {
        addressCode: shipBubbleData.addressCode,
        formattedAddress: shipBubbleData.formattedAddress,
      });
    } catch (error: any) {
      logger.error('❌ ShipBubble address validation failed:', error.message);
      res.status(422).json({
        success: false,
        code: 'SHIPBUBBLE_VALIDATION_FAILED',
        message: 'Our delivery carrier couldn\'t confirm this location. Please update your city and state, then try again.',
      });
      return;
    }

    // Vendors are limited to 2 saved addresses (pickup locations)
    if (user.role === 'vendor' && user.addresses && user.addresses.length >= 2) {
      res.status(400).json({
        success: false,
        message: 'Vendors can only save up to 2 addresses. Please delete an existing address before adding a new one.',
      });
      return;
    }

    // If this is set as default, unset other defaults
    if (isDefault) {
      user.addresses?.forEach(addr => {
        addr.isDefault = false;
      });
    }

    // If this is the first address, make it default
    const shouldBeDefault = isDefault || !user.addresses || user.addresses.length === 0;

    // Create new address object
    const newAddress = {
      _id: new mongoose.Types.ObjectId(),
      label: label || 'Home',
      fullName,
      phone,
      street,
      city: shipBubbleData?.city || city,
      state: shipBubbleData?.state || state,
      country: shipBubbleData?.country || country || 'Nigeria',
      postalCode: shipBubbleData?.postalCode || postalCode,
      isDefault: shouldBeDefault,
      // Store ShipBubble data for faster rate fetching
      shipBubble: shipBubbleData ? {
        addressCode: shipBubbleData.addressCode,
        formattedAddress: shipBubbleData.formattedAddress,
        latitude: shipBubbleData.latitude,
        longitude: shipBubbleData.longitude,
      } : undefined,
    };

    // Add to user's addresses
    if (!user.addresses) {
      user.addresses = [];
    }
    user.addresses.push(newAddress as any);
    
    await user.save();

    // Vendor opted to ship every product from the new address
    let productsUpdated = 0;
    if (user.role === 'vendor' && applyToAllProducts === true) {
      const result = await Product.updateMany(
        { vendor: user._id },
        { $set: { pickupAddress: pickupSnapshotFrom(newAddress) } },
      );
      productsUpdated = result.modifiedCount;
    }

    res.status(201).json({
      success: true,
      message: 'Address created and validated successfully',
      data: {
        address: newAddress,
        validated: true,
        productsUpdated,
      },
    });
  }

  /**
   * Update address with optional ShipBubble revalidation
   */
  async updateAddress(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const { id } = req.params;
    const { label, fullName, phone, street, city, state, country, postalCode, isDefault, revalidate } = req.body;
    
    const user = await User.findById(req.user?.id);
    
    if (!user || !user.addresses) {
      throw new AppError('User not found', 404);
    }

    const addressIndex = user.addresses.findIndex(addr => addr._id?.toString() === id);
    
    if (addressIndex === -1) {
      throw new AppError('Address not found', 404);
    }

    const address = user.addresses[addressIndex];
    const previous = { _id: address._id, street: address.street, city: address.city, state: address.state };

    // Check if address details changed (requires revalidation)
    const addressChanged = 
      (street && street !== address.street) ||
      (city && city !== address.city) ||
      (state && state !== address.state) ||
      (country && country !== address.country);

    // Revalidate with ShipBubble if requested or if address changed
    if ((revalidate || addressChanged) && (street || city || state)) {
      try {
        const fullAddress = `${street || address.street}, ${city || address.city}, ${state || address.state}, ${country || address.country || 'Nigeria'}`;

        logger.info('📍 Revalidating address with ShipBubble:', { fullAddress });

        const validationResult = await shipBubbleService.validateAddress({
          name: fullName || (address as any).fullName,
          email: user.email,
          phone: phone || (address as any).phone,
          address: fullAddress,
        });

        // Update with validated data
        (address as any).shipBubble = {
          addressCode: validationResult.address_code,
          formattedAddress: validationResult.formatted_address,
          latitude: validationResult.latitude,
          longitude: validationResult.longitude,
        };

        // Update city/state/postal from validation
        address.city = validationResult.city;
        address.state = validationResult.state;
        address.country = validationResult.country;
        (address as any).postalCode = validationResult.postal_code;

        logger.info('✅ Address revalidated successfully');
      } catch (error: any) {
        logger.error('❌ ShipBubble revalidation failed:', error.message);
        res.status(422).json({
          success: false,
          code: 'SHIPBUBBLE_VALIDATION_FAILED',
          message: 'Our delivery carrier couldn\'t confirm this location. Please check your city and state, then try again.',
        });
        return;
      }
    }

    // If setting as default, unset others
    if (isDefault) {
      user.addresses.forEach(addr => {
        addr.isDefault = false;
      });
    }

    // Update address fields — city/state/country/postalCode already set from ShipBubble
    // if revalidation ran; only update them from user input when no revalidation occurred
    if (label !== undefined) address.label = label;
    if (fullName !== undefined) (address as any).fullName = fullName;
    if (phone !== undefined) (address as any).phone = phone;
    if (street !== undefined) address.street = street;
    if (isDefault !== undefined) address.isDefault = isDefault;
    // Only apply user-supplied location fields when address did not change (no revalidation)
    if (!addressChanged) {
      if (city !== undefined) address.city = city;
      if (state !== undefined) address.state = state;
      if (country !== undefined) address.country = country;
      if (postalCode !== undefined) (address as any).postalCode = postalCode;
    }

    user.markModified('addresses');
    await user.save();

    let productsUpdated = 0;
    if (user.role === 'vendor') {
      try {
        productsUpdated = await syncProductPickupSnapshots(user._id, previous, user.addresses[addressIndex]);
        if (productsUpdated > 0) logger.info(`Resynced pickup address on ${productsUpdated} product(s) after address update`, { userId: user._id });
      } catch (err: any) {
        logger.error('Failed to resync product pickup addresses after update', { error: err.message });
      }
    }

    res.json({
      success: true,
      message: 'Address updated successfully',
      data: { address: user.addresses[addressIndex], productsUpdated },
    });
  }

  /**
   * Delete address (and from ShipBubble if needed)
   */
  async deleteAddress(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const { id } = req.params;
    
    const user = await User.findById(req.user?.id);
    
    if (!user || !user.addresses) {
      throw new AppError('User not found', 404);
    }

    const addressIndex = user.addresses.findIndex(addr => addr._id?.toString() === id);
    
    if (addressIndex === -1) {
      throw new AppError('Address not found', 404);
    }

    // Note: ShipBubble doesn't have a delete address endpoint
    // The addresses remain in their system but won't be used

    const removed = user.addresses[addressIndex];
    const removedSnapshot = { _id: removed._id, street: removed.street, city: removed.city, state: removed.state };

    // Remove address
    user.addresses.splice(addressIndex, 1);
    
    // If deleted address was default and there are other addresses, make the first one default
    if (user.addresses.length > 0) {
      const hasDefault = user.addresses.some(addr => addr.isDefault);
      if (!hasDefault) {
        user.addresses[0].isDefault = true;
      }
    }

    await user.save();

    // Products that shipped from the deleted address move to the address the
    // vendor picked (?moveProductsTo=<id>), else their default address; with
    // none left they fall back to the business address.
    let productsUpdated = 0;
    if (user.role === 'vendor') {
      try {
        const moveTo = typeof req.query.moveProductsTo === 'string' ? req.query.moveProductsTo : undefined;
        const target =
          (moveTo && user.addresses.find(addr => addr._id?.toString() === moveTo)) ||
          user.addresses.find(addr => addr.isDefault) ||
          null;
        productsUpdated = await syncProductPickupSnapshots(user._id, removedSnapshot, target);
        if (productsUpdated > 0) logger.info(`Re-pointed pickup address on ${productsUpdated} product(s) after address delete`, { userId: user._id });
      } catch (err: any) {
        logger.error('Failed to re-point product pickup addresses after delete', { error: err.message });
      }
    }

    res.json({
      success: true,
      message: 'Address deleted successfully',
      data: { productsUpdated },
    });
  }

  /**
   * Count the vendor's products that ship from this saved address, so the app
   * can warn before an edit or delete moves them.
   */
  async getAddressProductCount(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const { id } = req.params;

    const user = await User.findById(req.user?.id);
    const address = user?.addresses?.find(addr => addr._id?.toString() === id);

    if (!user || !address) {
      throw new AppError('Address not found', 404);
    }

    const count = user.role === 'vendor'
      ? await Product.countDocuments(pickupSnapshotFilter(user._id, address))
      : 0;

    res.json({
      success: true,
      message: 'Product count retrieved',
      data: { count },
    });
  }

  /**
   * Set default address
   */
  async setDefaultAddress(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const { id } = req.params;
    
    const user = await User.findById(req.user?.id);
    
    if (!user || !user.addresses) {
      throw new AppError('User not found', 404);
    }

    const addressIndex = user.addresses.findIndex(addr => addr._id?.toString() === id);
    
    if (addressIndex === -1) {
      throw new AppError('Address not found', 404);
    }

    // Unset all defaults
    user.addresses.forEach(addr => {
      addr.isDefault = false;
    });

    // Set this as default
    user.addresses[addressIndex].isDefault = true;

    await user.save();

    res.json({
      success: true,
      message: 'Default address updated successfully',
      data: { address: user.addresses[addressIndex] },
    });
  }

  /**
   * Validate address without saving (useful for address verification UI)
   */
  async validateAddress(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const { fullName, phone, street, city, state, country } = req.body;

    if (!fullName || !phone || !street || !city || !state) {
      throw new AppError('Missing required fields for validation', 400);
    }

    const user = await User.findById(req.user?.id);
    if (!user) {
      throw new AppError('User not found', 404);
    }

    try {
      const fullAddress = `${street}, ${city}, ${state}, ${country || 'Nigeria'}`;

      logger.info('📍 Validating address with ShipBubble:', { fullAddress });

      const validationResult = await shipBubbleService.validateAddress({
        name: fullName,
        email: user.email,
        phone: phone,
        address: fullAddress,
      });

      res.json({
        success: true,
        message: 'Address validated successfully',
        data: {
          original: {
            street,
            city,
            state,
            country: country || 'Nigeria',
          },
          validated: {
            formattedAddress: validationResult.formatted_address,
            city: validationResult.city,
            state: validationResult.state,
            country: validationResult.country,
            postalCode: validationResult.postal_code,
            latitude: validationResult.latitude,
            longitude: validationResult.longitude,
            addressCode: validationResult.address_code,
          },
        },
      });
    } catch (error: any) {
      logger.error('❌ Address validation failed:', error.message);
      throw new AppError('Failed to validate address. Please check the address details.', 400);
    }
  }
}

export const addressController = new AddressController();