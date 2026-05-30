// controllers/question.controller.ts
import { Response } from 'express';
import { AuthRequest, ApiResponse, NotificationType } from '../types';
import ProductQuestion from '../models/ProductQuestion';
import Product from '../models/Product';
import User from '../models/User';
import { AppError } from '../middleware/error';
import { notificationService } from '../services/notification.service';
import { logger } from '../utils/logger';

export class QuestionController {
  /**
   * Ask a question about a product
   */
  async askQuestion(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const { productId, question } = req.body;

    // Check product exists
    const product = await Product.findById(productId);
    if (!product) {
      throw new AppError('Product not found', 404);
    }

    // Prevent duplicate questions from same user (within last 24 hours)
    const recentQuestion = await ProductQuestion.findOne({
      product: productId,
      user: req.user?.id,
      question: { $regex: new RegExp(`^${question.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
      createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    });

    if (recentQuestion) {
      throw new AppError('You already asked this question recently', 400);
    }

    const newQuestion = await ProductQuestion.create({
      product: productId,
      user: req.user?.id,
      question: question.trim(),
    });

    // Populate user info for response
    await newQuestion.populate('user', 'firstName lastName avatar profileImage');

    logger.info(`Question asked: ${newQuestion._id} for product ${productId} by user ${req.user?.id}`);

    // Notify vendor
    try {
      const asker = await User.findById(req.user?.id).select('firstName lastName');
      const vendorId = product.vendor?.toString();
      if (asker && vendorId) {
        const preview = question.trim().length > 60
          ? question.trim().substring(0, 60) + '…'
          : question.trim();
        await notificationService.send({
          userId: vendorId,
          type: NotificationType.REVIEW,
          title: `New Question on "${product.name}"`,
          message: `${asker.firstName} ${asker.lastName} asked: "${preview}"`,
          data: { productId, questionId: newQuestion._id.toString() },
        });
      }
    } catch (err: any) {
      logger.error('Error sending question notification:', err.message);
    }

    res.status(201).json({
      success: true,
      message: 'Question submitted successfully',
      data: { question: this.formatQuestion(newQuestion) },
    });
  }

  /**
   * Get questions for a product
   */
  async getProductQuestions(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const { productId } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;
    const filter = (req.query.filter as string) || 'all'; // all | answered | unanswered

    const query: any = { product: productId, isPublic: true };

    if (filter === 'answered') {
        query.answer = { $exists: true, $nin: [null, ''] };
    } else if (filter === 'unanswered') {
      query.$or = [
        { answer: { $exists: false } },
        { answer: null },
        { answer: '' },
      ];
    }

    const questions = await ProductQuestion.find(query)
      .populate('user', 'firstName lastName avatar profileImage')
      .populate('answeredBy', 'firstName lastName avatar profileImage')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await ProductQuestion.countDocuments(query);
    const totalAnswered = await ProductQuestion.countDocuments({
      product: productId,
      isPublic: true,
      answer: { $exists: true, $nin: [null, ''] },
    });
    const totalUnanswered = total - totalAnswered;

    const formattedQuestions = questions.map((q) => this.formatQuestion(q));

    res.json({
      success: true,
      data: {
        questions: formattedQuestions,
        stats: {
          total,
          answered: totalAnswered,
          unanswered: totalUnanswered,
        },
      },
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  }

  /**
   * Answer a question (vendor only)
   */
  async answerQuestion(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const { questionId } = req.params;
    const { answer } = req.body;

    const question = await ProductQuestion.findById(questionId).populate('product', 'vendor');

    if (!question) {
      throw new AppError('Question not found', 404);
    }

    // Only the product vendor can answer
    const product = question.product as any;
    if (product.vendor?.toString() !== req.user?.id) {
      throw new AppError('Only the product vendor can answer questions', 403);
    }

    question.answer = answer.trim();
    question.answeredBy = req.user?.id as any;
    question.answeredAt = new Date();
    await question.save();

    await question.populate('user', 'firstName lastName avatar profileImage');
    await question.populate('answeredBy', 'firstName lastName avatar profileImage');

    logger.info(`Question ${questionId} answered by vendor ${req.user?.id}`);

    res.json({
      success: true,
      message: 'Question answered successfully',
      data: { question: this.formatQuestion(question) },
    });
  }

  /**
   * Update a question (only by the asker)
   */
  async updateQuestion(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const { questionId } = req.params;
    const { question } = req.body;

    const existing = await ProductQuestion.findOne({
      _id: questionId,
      user: req.user?.id,
    });

    if (!existing) {
      throw new AppError('Question not found', 404);
    }

    // Can only edit unanswered questions
    if (existing.answer) {
      throw new AppError('Cannot edit a question that has been answered', 400);
    }

    existing.question = question.trim();
    await existing.save();

    await existing.populate('user', 'firstName lastName avatar profileImage');

    res.json({
      success: true,
      message: 'Question updated successfully',
      data: { question: this.formatQuestion(existing) },
    });
  }

  /**
   * Delete a question (only by the asker, or vendor)
   */
  async deleteQuestion(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const { questionId } = req.params;

    const question = await ProductQuestion.findById(questionId).populate('product', 'vendor');

    if (!question) {
      throw new AppError('Question not found', 404);
    }

    const product = question.product as any;
    const isAsker = question.user.toString() === req.user?.id;
    const isVendor = product.vendor?.toString() === req.user?.id;

    if (!isAsker && !isVendor) {
      throw new AppError('Not authorized to delete this question', 403);
    }

    await question.deleteOne();

    res.json({
      success: true,
      message: 'Question deleted successfully',
    });
  }

  /**
   * Mark question as helpful
   */
  async markHelpful(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const { questionId } = req.params;

    const question = await ProductQuestion.findById(questionId);
    if (!question) {
      throw new AppError('Question not found', 404);
    }

    if (question.helpfulBy.includes(req.user?.id as any)) {
      throw new AppError('You have already marked this question as helpful', 400);
    }

    question.helpful += 1;
    question.helpfulBy.push(req.user?.id as any);
    await question.save();

    res.json({
      success: true,
      message: 'Question marked as helpful',
      data: { helpful: question.helpful },
    });
  }

  /**
   * Report a question
   */
  async reportQuestion(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const { questionId } = req.params;
    const { reason } = req.body;

    const question = await ProductQuestion.findById(questionId);
    if (!question) {
      throw new AppError('Question not found', 404);
    }

    question.reported = true;
    question.reportReason = reason;
    await question.save();

    logger.info(`Question reported: ${questionId} by user ${req.user?.id}`);

    res.json({
      success: true,
      message: 'Question reported successfully',
    });
  }

  /**
   * Get user's questions
   */
  async getMyQuestions(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    const questions = await ProductQuestion.find({ user: req.user?.id })
      .populate('product', 'name slug images price')
      .populate('answeredBy', 'firstName lastName')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await ProductQuestion.countDocuments({ user: req.user?.id });

    const formattedQuestions = questions.map((q) => this.formatQuestion(q));

    res.json({
      success: true,
      data: { questions: formattedQuestions },
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  }

  /**
   * Get vendor's unanswered questions
   */
  async getVendorQuestions(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;
    const filter = (req.query.filter as string) || 'unanswered';

    // Get all product IDs for this vendor
    const vendorProducts = await Product.find({ vendor: req.user?.id }).select('_id');
    const productIds = vendorProducts.map((p) => p._id);

    const query: any = { product: { $in: productIds } };

    if (filter === 'answered') {
      query.answer = { $exists: true, $nin: [null, ''] };
    } else if (filter === 'unanswered') {
      query.$or = [
        { answer: { $exists: false } },
        { answer: null },
        { answer: '' },
      ];
    }

    const questions = await ProductQuestion.find(query)
      .populate('user', 'firstName lastName avatar profileImage')
      .populate('product', 'name slug images price')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await ProductQuestion.countDocuments(query);

    const formattedQuestions = questions.map((q) => this.formatQuestion(q));

    res.json({
      success: true,
      data: { questions: formattedQuestions },
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  }

  /**
   * Format question for response
   */
  private formatQuestion(question: any): any {
    const user = question.user;
    const answeredBy = question.answeredBy;

    return {
      _id: question._id.toString(),
      product: question.product,
      user: user
        ? {
            _id: user._id?.toString() || user.toString(),
            firstName: user.firstName || '',
            lastName: user.lastName || '',
            avatar: user.avatar || user.profileImage || '',
          }
        : null,
      question: question.question,
      answer: question.answer || null,
      answeredBy: answeredBy
        ? {
            _id: answeredBy._id?.toString() || answeredBy.toString(),
            firstName: answeredBy.firstName || '',
            lastName: answeredBy.lastName || '',
            avatar: answeredBy.avatar || answeredBy.profileImage || '',
          }
        : null,
      answeredAt: question.answeredAt || null,
      isPublic: question.isPublic,
      helpful: question.helpful,
      createdAt: question.createdAt,
      updatedAt: question.updatedAt,
    };
  }
}

export const questionController = new QuestionController();