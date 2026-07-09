// models/ProductQuestion.ts
import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IProductQuestion extends Document {
  product: Types.ObjectId;
  user: Types.ObjectId;
  question: string;
  answer?: string;
  answeredBy?: Types.ObjectId;
  answeredAt?: Date;
  isPublic: boolean;
  helpful: number;
  helpfulBy: Types.ObjectId[];
  reported: boolean;
  reportReason?: string;
  questionRemindersSent: number[];
  createdAt: Date;
  updatedAt: Date;
}

const ProductQuestionSchema = new Schema<IProductQuestion>(
  {
    product: {
      type: Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
      index: true,
    },
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    question: {
      type: String,
      required: [true, 'Question is required'],
      trim: true,
      maxlength: [1000, 'Question cannot exceed 1000 characters'],
    },
    answer: {
      type: String,
      trim: true,
      maxlength: [2000, 'Answer cannot exceed 2000 characters'],
    },
    answeredBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    answeredAt: {
      type: Date,
    },
    isPublic: {
      type: Boolean,
      default: true,
    },
    helpful: {
      type: Number,
      default: 0,
    },
    helpfulBy: [
      {
        type: Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    reported: {
      type: Boolean,
      default: false,
    },
    reportReason: {
      type: String,
    },
    questionRemindersSent: {
      type: [Number],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for efficient queries
ProductQuestionSchema.index({ product: 1, createdAt: -1 });
ProductQuestionSchema.index({ product: 1, answeredAt: -1 });

export default mongoose.model<IProductQuestion>('ProductQuestion', ProductQuestionSchema);