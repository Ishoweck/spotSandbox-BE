// routes/address.routes.ts
import { Router } from 'express';
import { addressController } from '../controllers/address.controller';
import { authenticate } from '../middleware/auth';
import { asyncHandler } from '../middleware/error';
import { body } from 'express-validator';
import { validate } from '../middleware/validation';

const router = Router();

// All address routes require authentication
router.use(authenticate);

const createAddressValidation = [
  body('fullName').notEmpty().withMessage('Full name is required'),
  body('phone').notEmpty().withMessage('Phone number is required'),
  body('street').notEmpty().withMessage('Street address is required'),
  body('city').notEmpty().withMessage('City is required'),
  body('state').notEmpty().withMessage('State is required'),
  body('label').optional().isIn(['Home', 'Office', 'Other']).withMessage('Invalid label'),
  body('applyToAllProducts').optional().isBoolean().withMessage('applyToAllProducts must be boolean'),
];

const updateAddressValidation = [
  body('fullName').optional().notEmpty().withMessage('Full name cannot be empty'),
  body('phone').optional().notEmpty().withMessage('Phone cannot be empty'),
  body('street').optional().notEmpty().withMessage('Street cannot be empty'),
  body('city').optional().notEmpty().withMessage('City cannot be empty'),
  body('state').optional().notEmpty().withMessage('State cannot be empty'),
  body('label').optional().isIn(['Home', 'Office', 'Other']).withMessage('Invalid label'),
  body('revalidate').optional().isBoolean().withMessage('Revalidate must be boolean'),
];

const validateAddressValidation = [
  body('fullName').notEmpty().withMessage('Full name is required'),
  body('phone').notEmpty().withMessage('Phone number is required'),
  body('street').notEmpty().withMessage('Street address is required'),
  body('city').notEmpty().withMessage('City is required'),
  body('state').notEmpty().withMessage('State is required'),
];

// Get all addresses
router.get('/', asyncHandler(addressController.getAddresses.bind(addressController)));

// Validate address (without saving)
router.post(
  '/validate',
  validate(validateAddressValidation),
  asyncHandler(addressController.validateAddress.bind(addressController))
);

// Count vendor products shipping from this address
router.get('/:id/product-count', asyncHandler(addressController.getAddressProductCount.bind(addressController)));

// Get single address
router.get('/:id', asyncHandler(addressController.getAddress.bind(addressController)));

// Create new address
router.post(
  '/',
  validate(createAddressValidation),
  asyncHandler(addressController.createAddress.bind(addressController))
);

// Update address
router.put(
  '/:id',
  validate(updateAddressValidation),
  asyncHandler(addressController.updateAddress.bind(addressController))
);

// Delete address
router.delete('/:id', asyncHandler(addressController.deleteAddress.bind(addressController)));

// Set default address
router.patch('/:id/default', asyncHandler(addressController.setDefaultAddress.bind(addressController)));

export default router;