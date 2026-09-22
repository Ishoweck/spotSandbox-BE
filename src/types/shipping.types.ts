// types/shipping.types.ts
import { Types } from 'mongoose';

export interface VendorGroup {
  vendorId: string;
  vendorName: string;
  vendorLogo?: string;
  isVerified?: boolean;
  vendorAddress: {
    street: string;
    city: string;
    state: string;
    country: string;
  };
  pickupAddress?: {
    street: string;
    city: string;
    state: string;
    country: string;
    fullName?: string;
    phone?: string;
    shipBubble?: {
      addressCode?: number;
      formattedAddress?: string;
      latitude?: number;
      longitude?: number;
    };
  };
  // Vendor-configured delivery options (setup screen). Only these modes are
  // shown to the buyer at checkout for items in this group.
  deliveryModes: ('VENDORSPOT_DELIVERY' | 'SELF_DELIVERY' | 'PICKUP')[];
  // Per-state self-delivery pricing. SELF_DELIVERY is only offered when the
  // buyer's state appears here; the fee shown at checkout is the entry's fee.
  selfDeliveryPricing: { state: string; fee: number }[];
  vendorPickupAddress?: {
    street: string;
    city: string;
    state: string;
    country: string;
    landmark?: string;
    instructions?: string;
    status: 'PENDING' | 'APPROVED' | 'REJECTED';
  };
  items: {
    productId: string;
    productName: string;
    image?: string;
    variant?: string;
    quantity: number;
    weight: number;
    isPhysical: boolean;
    price: number;
  }[];
  totalWeight: number;
}

export interface VendorRateGroup {
  vendorId: string;
  vendorName: string;
  vendorLogo?: string;
  isVerified?: boolean;
  pickupCity?: string | null;
  products: {
    productId: string;
    name: string;
    image?: string;
    variant?: string;
    price: number;
    quantity: number;
  }[];
  rates: {
    id: string;
    type: string;
    name: string;
    description: string;
    price: number;
    estimatedDays: string;
    courier: string;
    logo?: string;
  }[];
  // Delivery modes the vendor supports and are ready to be picked at checkout.
  // Already filtered against the buyer's shipping state — SELF_DELIVERY is
  // dropped when the buyer is outside the vendor's service area.
  deliveryModes: ('VENDORSPOT_DELIVERY' | 'SELF_DELIVERY' | 'PICKUP')[];
  // Flat fee charged when the buyer picks Vendor-to-deliver
  selfDeliveryFee: number;
  // Present only when PICKUP mode is offered AND the vendor's location is admin-approved.
  vendorPickupAddress?: {
    street: string;
    city: string;
    state: string;
    country: string;
    landmark?: string;
    instructions?: string;
    status: 'PENDING' | 'APPROVED' | 'REJECTED';
  };
}

export interface VendorDeliveryRate {
  vendorId: string;
  vendorName: string;
  rates: {
    type: string;
    name: string;
    description: string;
    price: number;
    estimatedDays: string;
    courier: string;
    logo?: string;
  }[];
  success: boolean;
}

export interface DeliveryRateResponse {
  type: string;
  name: string;
  description: string;
  price: number;
  estimatedDays: string;
  courier: string;
  logo?: string;
  pickupAddress?: string;
  vendorBreakdown?: {
    vendorId: string;
    vendorName: string;
    price: number;
    courier: string;
  }[];
}