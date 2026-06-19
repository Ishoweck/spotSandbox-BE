import { Queue } from 'bullmq';
import { NotificationType } from '../types';
export interface PushJobData {
    notificationId: string;
    userId: string;
    type: NotificationType;
    title: string;
    message: string;
    data?: Record<string, any>;
    link?: string;
    referenceId: string;
}
export interface BroadcastChunkData {
    userIds: string[];
    type: NotificationType;
    title: string;
    message: string;
    data?: Record<string, any>;
    link?: string;
    referenceId: string;
}
export declare const pushQueue: Queue<PushJobData, any, string, PushJobData, any, string>;
export declare const broadcastQueue: Queue<BroadcastChunkData, any, string, BroadcastChunkData, any, string>;
//# sourceMappingURL=notification.queue.d.ts.map