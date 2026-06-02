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