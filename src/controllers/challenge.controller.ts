import { Response } from 'express';
import { AuthRequest, ApiResponse, UserRole } from '../types';
import { Challenge } from '../models/Additional';
import User from '../models/User';
import Order from '../models/Order';
import Product from '../models/Product';
import { Wallet } from '../models/Additional';
import { AppError } from '../middleware/error';
import { logger } from '../utils/logger';
import { notificationService } from '../services/notification.service';

export class ChallengeController {
  /**
   * Create challenge (Admin only)
   */
  async createChallenge(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const {
      title,
      description,
      type,
      targetType,
      targetValue,
      rewardType,
      rewardValue,
      startDate,
      endDate,
      isRecurring,
      recurringPeriod,
    } = req.body;

    const challenge = await Challenge.create({
      title,
      description,
      type,
      targetType,
      targetValue,
      rewardType,
      rewardValue,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      isRecurring,
      recurringPeriod,
    });

    logger.info(`Challenge created: ${challenge.title}`);

    // Notify all relevant users about the new challenge
    notificationService.newChallengeCreated(
      challenge._id.toString(),
      challenge.title,
      challenge.description,
      challenge.type as 'buyer' | 'seller' | 'affiliate'
    ).catch((err) => logger.error('Failed to send new challenge notifications:', err.message));

    res.status(201).json({
      success: true,
      message: 'Challenge created successfully',
      data: { challenge },
    });
  }

  /**
   * Get active challenges
   */
  async getActiveChallenges(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const now = new Date();

    const filter: any = {
      isActive: true,
      startDate: { $lte: now },
      endDate: { $gte: now },
    };

    // Filter by challenge type based on user role
    const user = await User.findById(req.user?.id);
    if (user?.role === UserRole.CUSTOMER) {
      filter.type = 'buyer';
    } else if (user?.role === UserRole.VENDOR) {
      filter.type = 'seller';
    } else if (user?.isAffiliate) {
      filter.type = 'affiliate';
    }

    const challenges = await Challenge.find(filter).sort({ createdAt: -1 });

    // Get user's progress for each challenge
    const challengesWithProgress = challenges.map((challenge) => {
      const participation = challenge.participants.find(
        (p: any) => p.user.toString() === req.user?.id
      );

      return {
        ...challenge.toObject(),
        userProgress: participation
          ? {
              progress: participation.progress,
              completed: participation.completed,
              completedAt: participation.completedAt,
            }
          : {
              progress: 0,
              completed: false,
            },
      };
    });

    res.json({
      success: true,
      data: { challenges: challengesWithProgress },
    });
  }

  /**
   * Get user's challenge progress
   */
  async getUserChallenges(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const challenges = await Challenge.find({
      'participants.user': req.user?.id,
    });

    const userChallenges = challenges.map((challenge) => {
      const participation = challenge.participants.find(
        (p: any) => p.user.toString() === req.user?.id
      );

      return {
        challenge: {
          id: challenge._id,
          title: challenge.title,
          description: challenge.description,
          type: challenge.type,
          targetType: challenge.targetType,
          targetValue: challenge.targetValue,
          rewardType: challenge.rewardType,
          rewardValue: challenge.rewardValue,
          startDate: challenge.startDate,
          endDate: challenge.endDate,
        },
        progress: participation?.progress || 0,
        completed: participation?.completed || false,
        completedAt: participation?.completedAt,
        rewardClaimed: participation?.rewardClaimed || false,
      };
    });

    // Separate into active and completed
    const activeChallenges = userChallenges.filter((c) => !c.completed);
    const completedChallenges = userChallenges.filter((c) => c.completed);

    res.json({
      success: true,
      data: {
        active: activeChallenges,
        completed: completedChallenges,
        totalCompleted: completedChallenges.length,
      },
    });
  }

  /**
   * Join challenge
   */
  async joinChallenge(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const { challengeId } = req.params;

    const challenge = await Challenge.findById(challengeId);
    if (!challenge) {
      throw new AppError('Challenge not found', 404);
    }

    if (!challenge.isActive) {
      throw new AppError('Challenge is not active', 400);
    }

    const now = new Date();
    if (now < challenge.startDate || now > challenge.endDate) {
      throw new AppError('Challenge is not currently running', 400);
    }

    // Check if already participating
    const alreadyParticipating = challenge.participants.some(
      (p: any) => p.user.toString() === req.user?.id
    );

    if (alreadyParticipating) {
      throw new AppError('Already participating in this challenge', 400);
    }

    // Add participant
    challenge.participants.push({
      user: req.user?.id as any,
      progress: 0,
      completed: false,
      rewardClaimed: false,
    });

    await challenge.save();

    res.json({
      success: true,
      message: 'Successfully joined challenge',
      data: { challenge },
    });
  }

  /**
   * Update challenge progress (called internally or by cron)
   */
  async updateChallengeProgress(
    userId: string,
    challengeType: string,
    progressValue: number
  ): Promise<void> {
    const challenges = await Challenge.find({
      type: challengeType,
      isActive: true,
      'participants.user': userId,
    });

    for (const challenge of challenges) {
      const participation = challenge.participants.find(
        (p: any) => p.user.toString() === userId
      );

      if (participation && !participation.completed) {
        participation.progress += progressValue;

        // Check if challenge is completed
        if (participation.progress >= challenge.targetValue) {
          participation.completed = true;
          participation.completedAt = new Date();

          logger.info(`Challenge completed: ${challenge.title} by user ${userId}`);

          // Notify user that they completed the challenge
          notificationService.challengeCompleted(
            userId,
            challenge._id.toString(),
            challenge.title
          ).catch((err) => logger.error('Failed to send challenge completion notification:', err.message));
        }

        await challenge.save();
      }
    }
  }

  /**
   * Claim reward
   */
  async claimReward(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const { challengeId } = req.params;

    const challenge = await Challenge.findById(challengeId);
    if (!challenge) {
      throw new AppError('Challenge not found', 404);
    }

    const participation = challenge.participants.find(
      (p: any) => p.user.toString() === req.user?.id
    );

    if (!participation) {
      throw new AppError('Not participating in this challenge', 400);
    }

    if (!participation.completed) {
      throw new AppError('Challenge not yet completed', 400);
    }

    if (participation.rewardClaimed) {
      throw new AppError('Reward already claimed', 400);
    }

    // Process reward based on type
    if (challenge.rewardType === 'cash') {
      // Add to wallet
      let wallet = await Wallet.findOne({ user: req.user?.id });
      if (!wallet) {
        wallet = await Wallet.create({ user: req.user?.id });
      }

      wallet.balance += challenge.rewardValue;
      wallet.totalEarned += challenge.rewardValue;
      wallet.transactions.push({
        type: 'credit',
        amount: challenge.rewardValue,
        purpose: 'reward',
        reference: `CHALLENGE-${challenge._id}`,
        description: `Reward for completing: ${challenge.title}`,
        status: 'completed',
        timestamp: new Date(),
      } as any);

      await wallet.save();
    } else if (challenge.rewardType === 'points') {
      const { rewardController } = await import('./reward.controller');
      await rewardController.awardPoints(
        req.user?.id as string,
        challenge.rewardValue,
        'bonus',
        `Reward for completing: ${challenge.title}`,
        { challengeId: challenge._id.toString() }
      );
    }

    // Mark reward as claimed
    participation.rewardClaimed = true;
    await challenge.save();

    logger.info(`Reward claimed: ${challenge.title} by user ${req.user?.id}`);

    // Notify user that their reward has been credited
    notificationService.challengeRewardClaimed(
      req.user?.id as string,
      challenge._id.toString(),
      challenge.title,
      challenge.rewardType,
      challenge.rewardValue
    ).catch((err) => logger.error('Failed to send reward claimed notification:', err.message));

    res.json({
      success: true,
      message: 'Reward claimed successfully',
      data: {
        rewardType: challenge.rewardType,
        rewardValue: challenge.rewardValue,
      },
    });
  }

  /**
   * Get challenge leaderboard
   */
  async getChallengeLeaderboard(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const { challengeId } = req.params;

    const challenge = await Challenge.findById(challengeId).populate(
      'participants.user',
      'firstName lastName'
    );

    if (!challenge) {
      throw new AppError('Challenge not found', 404);
    }

    // Sort participants by progress
    const leaderboard = challenge.participants
      .map((p: any) => ({
        user: {
          id: p.user._id,
          name: `${p.user.firstName} ${p.user.lastName}`,
        },
        progress: p.progress,
        completed: p.completed,
        completedAt: p.completedAt,
      }))
      .sort((a, b) => b.progress - a.progress)
      .slice(0, 50); // Top 50

    // Add ranks
    const rankedLeaderboard = leaderboard.map((entry, index) => ({
      ...entry,
      rank: index + 1,
    }));

    res.json({
      success: true,
      data: {
        challenge: {
          id: challenge._id,
          title: challenge.title,
          targetValue: challenge.targetValue,
          targetType: challenge.targetType,
        },
        leaderboard: rankedLeaderboard,
      },
    });
  }

  /**
   * Get all challenges (Admin only)
   */
  async getAllChallenges(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    const filter: any = {};
    if (req.query.type) {
      filter.type = req.query.type;
    }
    if (req.query.isActive !== undefined) {
      filter.isActive = req.query.isActive === 'true';
    }

    const challenges = await Challenge.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Challenge.countDocuments(filter);

    // Add participation stats
    const challengesWithStats = challenges.map((challenge) => ({
      ...challenge.toObject(),
      stats: {
        totalParticipants: challenge.participants.length,
        completedCount: challenge.participants.filter((p: any) => p.completed).length,
        completionRate:
          challenge.participants.length > 0
            ? (challenge.participants.filter((p: any) => p.completed).length /
                challenge.participants.length) *
              100
            : 0,
      },
    }));

    res.json({
      success: true,
      data: { challenges: challengesWithStats },
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  }

  /**
   * Update challenge (Admin only)
   */
  async updateChallenge(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const { challengeId } = req.params;

    const challenge = await Challenge.findById(challengeId);
    if (!challenge) {
      throw new AppError('Challenge not found', 404);
    }

    const allowedUpdates = [
      'title',
      'description',
      'targetValue',
      'rewardValue',
      'endDate',
      'isActive',
    ];

    Object.keys(req.body).forEach((key) => {
      if (allowedUpdates.includes(key)) {
        (challenge as any)[key] = req.body[key];
      }
    });

    await challenge.save();

    res.json({
      success: true,
      message: 'Challenge updated successfully',
      data: { challenge },
    });
  }

  /**
   * Delete challenge (Admin only)
   */
  async deleteChallenge(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const { challengeId } = req.params;

    const challenge = await Challenge.findById(challengeId);
    if (!challenge) {
      throw new AppError('Challenge not found', 404);
    }

    if (challenge.participants.length > 0) {
      throw new AppError('Cannot delete challenge with participants', 400);
    }

    await challenge.deleteOne();

    res.json({
      success: true,
      message: 'Challenge deleted successfully',
    });
  }
}

export const challengeController = new ChallengeController();
