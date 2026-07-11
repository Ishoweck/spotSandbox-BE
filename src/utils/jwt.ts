import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import { UserRole } from '../types';
import dotenv from "dotenv"


dotenv.config()

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '30d';

if (!JWT_SECRET || !JWT_REFRESH_SECRET) {
  throw new Error('JWT_SECRET and JWT_REFRESH_SECRET must be defined in environment variables');
}

export interface TokenPayload {
  id: string;
  email: string;
  role: UserRole;
  tokenVersion?: number;
}

export const generateAccessToken = (payload: TokenPayload): string => {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  } as jwt.SignOptions);
};

export const generateRefreshToken = (payload: TokenPayload): string => {
  return jwt.sign(payload, JWT_REFRESH_SECRET, {
    expiresIn: JWT_REFRESH_EXPIRES_IN,
  } as jwt.SignOptions);
};

export const verifyAccessToken = (token: string): TokenPayload => {
  try {
    return jwt.verify(token, JWT_SECRET) as TokenPayload;
  } catch (error) {
    throw new Error('Invalid or expired token');
  }
};

export const verifyRefreshToken = (token: string): TokenPayload => {
  try {
    return jwt.verify(token, JWT_REFRESH_SECRET) as TokenPayload;
  } catch (error) {
    throw new Error('Invalid or expired refresh token');
  }
};

// Short-lived token issued after password check, valid only for face verification step
export const generateFaceVerifyToken = (userId: string, email: string): string => {
  return jwt.sign({ id: userId, email, type: 'face_verify' }, JWT_SECRET, {
    expiresIn: '5m',
  } as jwt.SignOptions);
};

export const verifyFaceVerifyToken = (token: string): { id: string; email: string } => {
  const payload = jwt.verify(token, JWT_SECRET) as any;
  if (payload.type !== 'face_verify') {
    throw new Error('Invalid token type');
  }
  return { id: payload.id, email: payload.email };
};

export const generateTokens = (userId: Types.ObjectId, email: string, role: UserRole, tokenVersion = 0) => {
  const payload: TokenPayload = {
    id: userId.toString(),
    email,
    role,
    tokenVersion,
  };

  return {
    accessToken: generateAccessToken(payload),
    refreshToken: generateRefreshToken(payload),
  };
};
