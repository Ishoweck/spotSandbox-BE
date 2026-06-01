"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.challengeController = exports.ChallengeController = void 0;
const types_1 = require("../types");
const Additional_1 = require("../models/Additional");
const User_1 = __importDefault(require("../models/User"));
const Additional_2 = require("../models/Additional");
const error_1 = require("../middleware/error");
const logger_1 = require("../utils/logger");
const notification_service_1 = require("../services/notification.service");
class ChallengeController {
    /**
     * Create challenge (Admin only)
     */
    async createChallenge(req, res) {
        const { title, description, type, targetType, targetValue, rewardType, rewardValue, startDate, endDate, isRecurring, recurringPeriod, } = req.body;
        const challenge = await Additional_1.Challenge.create({
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
        logger_1.logger.info(`Challenge created: ${challenge.title}`);
        // Notify all relevant users about the new challenge
        notification_service_1.notificationService.newChallengeCreated(challenge._id.toString(), challenge.title, challenge.description, challenge.type).catch((err) => logger_1.logger.error('Failed to send new challenge notifications:', err.message));
        res.status(201).json({
            success: true,
            message: 'Challenge created successfully',
            data: { challenge },
        });
    }
    /**
     * Get active challenges
     */
    async getActiveChallenges(req, res) {
        const now = new Date();
        const filter = {
            isActive: true,
            startDate: { $lte: now },
            endDate: { $gte: now },
        };
        // Filter by challenge type based on user role
        const user = await User_1.default.findById(req.user?.id);
        if (user?.role === types_1.UserRole.CUSTOMER) {
            filter.type = 'buyer';
        }
        else if (user?.role === types_1.UserRole.VENDOR) {
            filter.type = 'seller';
        }
        else if (user?.isAffiliate) {
            filter.type = 'affiliate';
        }
        const challenges = await Additional_1.Challenge.find(filter).sort({ createdAt: -1 });
        // Get user's progress for each challenge
        const challengesWithProgress = challenges.map((challenge) => {
            const participation = challenge.participants.find((p) => p.user.toString() === req.user?.id);
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
    async getUserChallenges(req, res) {
        const challenges = await Additional_1.Challenge.find({
            'participants.user': req.user?.id,
        });
        const userChallenges = challenges.map((challenge) => {
            const participation = challenge.participants.find((p) => p.user.toString() === req.user?.id);
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
    async joinChallenge(req, res) {
        const { challengeId } = req.params;
        const challenge = await Additional_1.Challenge.findById(challengeId);
        if (!challenge) {
            throw new error_1.AppError('Challenge not found', 404);
        }
        if (!challenge.isActive) {
            throw new error_1.AppError('Challenge is not active', 400);
        }
        const now = new Date();
        if (now < challenge.startDate || now > challenge.endDate) {
            throw new error_1.AppError('Challenge is not currently running', 400);
        }
        // Check if already participating
        const alreadyParticipating = challenge.participants.some((p) => p.user.toString() === req.user?.id);
        if (alreadyParticipating) {
            throw new error_1.AppError('Already participating in this challenge', 400);
        }
        // Add participant
        challenge.participants.push({
            user: req.user?.id,
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
    async updateChallengeProgress(userId, challengeType, progressValue) {
        const challenges = await Additional_1.Challenge.find({
            type: challengeType,
            isActive: true,
            'participants.user': userId,
        });
        for (const challenge of challenges) {
            const participation = challenge.participants.find((p) => p.user.toString() === userId);
            if (participation && !participation.completed) {
                participation.progress += progressValue;
                // Check if challenge is completed
                if (participation.progress >= challenge.targetValue) {
                    participation.completed = true;
                    participation.completedAt = new Date();
                    logger_1.logger.info(`Challenge completed: ${challenge.title} by user ${userId}`);
                    // Notify user that they completed the challenge
                    notification_service_1.notificationService.challengeCompleted(userId, challenge._id.toString(), challenge.title).catch((err) => logger_1.logger.error('Failed to send challenge completion notification:', err.message));
                }
                await challenge.save();
            }
        }
    }
    /**
     * Claim reward
     */
    async claimReward(req, res) {
        const { challengeId } = req.params;
        const challenge = await Additional_1.Challenge.findById(challengeId);
        if (!challenge) {
            throw new error_1.AppError('Challenge not found', 404);
        }
        const participation = challenge.participants.find((p) => p.user.toString() === req.user?.id);
        if (!participation) {
            throw new error_1.AppError('Not participating in this challenge', 400);
        }
        if (!participation.completed) {
            throw new error_1.AppError('Challenge not yet completed', 400);
        }
        if (participation.rewardClaimed) {
            throw new error_1.AppError('Reward already claimed', 400);
        }
        // Process reward based on type
        if (challenge.rewardType === 'cash') {
            // Add to wallet
            let wallet = await Additional_2.Wallet.findOne({ user: req.user?.id });
            if (!wallet) {
                wallet = await Additional_2.Wallet.create({ user: req.user?.id });
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
            });
            await wallet.save();
        }
        else if (challenge.rewardType === 'points') {
            const { rewardController } = await Promise.resolve().then(() => __importStar(require('./reward.controller')));
            await rewardController.awardPoints(req.user?.id, challenge.rewardValue, 'bonus', `Reward for completing: ${challenge.title}`, { challengeId: challenge._id.toString() });
        }
        // Mark reward as claimed
        participation.rewardClaimed = true;
        await challenge.save();
        logger_1.logger.info(`Reward claimed: ${challenge.title} by user ${req.user?.id}`);
        // Notify user that their reward has been credited
        notification_service_1.notificationService.challengeRewardClaimed(req.user?.id, challenge._id.toString(), challenge.title, challenge.rewardType, challenge.rewardValue).catch((err) => logger_1.logger.error('Failed to send reward claimed notification:', err.message));
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
    async getChallengeLeaderboard(req, res) {
        const { challengeId } = req.params;
        const challenge = await Additional_1.Challenge.findById(challengeId).populate('participants.user', 'firstName lastName');
        if (!challenge) {
            throw new error_1.AppError('Challenge not found', 404);
        }
        // Sort participants by progress
        const leaderboard = challenge.participants
            .map((p) => ({
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
    async getAllChallenges(req, res) {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const skip = (page - 1) * limit;
        const filter = {};
        if (req.query.type) {
            filter.type = req.query.type;
        }
        if (req.query.isActive !== undefined) {
            filter.isActive = req.query.isActive === 'true';
        }
        const challenges = await Additional_1.Challenge.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);
        const total = await Additional_1.Challenge.countDocuments(filter);
        // Add participation stats
        const challengesWithStats = challenges.map((challenge) => ({
            ...challenge.toObject(),
            stats: {
                totalParticipants: challenge.participants.length,
                completedCount: challenge.participants.filter((p) => p.completed).length,
                completionRate: challenge.participants.length > 0
                    ? (challenge.participants.filter((p) => p.completed).length /
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
    async updateChallenge(req, res) {
        const { challengeId } = req.params;
        const challenge = await Additional_1.Challenge.findById(challengeId);
        if (!challenge) {
            throw new error_1.AppError('Challenge not found', 404);
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
                challenge[key] = req.body[key];
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
    async deleteChallenge(req, res) {
        const { challengeId } = req.params;
        const challenge = await Additional_1.Challenge.findById(challengeId);
        if (!challenge) {
            throw new error_1.AppError('Challenge not found', 404);
        }
        if (challenge.participants.length > 0) {
            throw new error_1.AppError('Cannot delete challenge with participants', 400);
        }
        await challenge.deleteOne();
        res.json({
            success: true,
            message: 'Challenge deleted successfully',
        });
    }
}
exports.ChallengeController = ChallengeController;
exports.challengeController = new ChallengeController();
//# sourceMappingURL=challenge.controller.js.map