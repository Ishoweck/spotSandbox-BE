import { GROQ_MODEL, GROQ_REASONING_EFFORT } from '../config/ai';
import Groq from 'groq-sdk';
import Ticket from '../models/Ticket';
import { ChatMessage } from '../models/Additional';
import { logger } from '../utils/logger';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const CATEGORIES = [
  'Delivery Issue',
  'Payment Issue',
  'Account Issue',
  'Product Issue',
  'Order Issue',
  'Technical Issue',
  'General Inquiry',
  'Other',
];

async function generateTicketId(): Promise<string> {
  const count = await Ticket.countDocuments();
  return `TK-${String(count + 1).padStart(4, '0')}`;
}

async function summarizeConversation(
  conversationId: string,
  startedAt: Date,
  endedAt: Date
): Promise<{ summary: string; category: string; priority: 'low' | 'medium' | 'high' | 'urgent' }> {
  const messages = await ChatMessage.find({
    conversationId,
    deleted: { $ne: true },
    messageType: { $ne: 'system' },
    createdAt: { $gte: startedAt, $lte: endedAt },
  })
    .populate('sender', 'firstName lastName role')
    .sort({ createdAt: 1 })
    .limit(80);

  if (messages.length === 0) {
    return { summary: 'No conversation messages found.', category: 'General Inquiry', priority: 'low' };
  }

  const transcript = messages
    .map((m) => {
      const sender = m.sender as any;
      const isAdmin = ['admin', 'super_admin', 'financial_admin'].includes(sender?.role);
      const name = isAdmin ? 'Support Agent' : `${sender?.firstName || 'User'}`;
      return `${name}: ${m.message}`;
    })
    .join('\n');

  const prompt = `You are a support ticket analyzer for VendorSpot, a Nigerian e-commerce platform.

Given the following customer support conversation transcript, respond ONLY with valid JSON (no markdown, no explanation):

{
  "summary": "2-3 sentence summary of the issue and outcome",
  "category": "one of: ${CATEGORIES.join(', ')}",
  "priority": "low | medium | high | urgent"
}

Priority guide: low = general question, medium = standard issue, high = financial or order problem, urgent = account locked or fraud.

Conversation:
${transcript}`;

  try {
    const completion = await groq.chat.completions.create({
      model: GROQ_MODEL,
      reasoning_effort: GROQ_REASONING_EFFORT,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 300,
      temperature: 0.3,
    });

    const raw = completion.choices[0]?.message?.content?.trim() || '';
    const parsed = JSON.parse(raw);

    return {
      summary: parsed.summary || 'Could not generate summary.',
      category: CATEGORIES.includes(parsed.category) ? parsed.category : 'General Inquiry',
      priority: ['low', 'medium', 'high', 'urgent'].includes(parsed.priority)
        ? parsed.priority
        : 'medium',
    };
  } catch (err: any) {
    logger.error('Groq ticket summarization failed:', err.message);
    return { summary: 'AI summarization unavailable.', category: 'General Inquiry', priority: 'medium' };
  }
}

export const ticketService = {
  async createFromSession(params: {
    sessionId: string;
    userId: string;
    adminId: string;
    conversationId: string;
    startedAt: Date;
    endedAt: Date;
  }) {
    const { summary, category, priority } = await summarizeConversation(
      params.conversationId,
      params.startedAt,
      params.endedAt
    );
    const ticketId = await generateTicketId();

    const ticket = await Ticket.create({
      ticketId,
      userId: params.userId,
      adminId: params.adminId,
      sessionId: params.sessionId,
      conversationId: params.conversationId,
      summary,
      category,
      priority,
      status: 'open',
    });

    return ticket;
  },

  async getTickets(filters: {
    search?: string;
    status?: string;
    priority?: string;
    page: number;
    limit: number;
  }) {
    const { search, status, priority, page, limit } = filters;
    const skip = (page - 1) * limit;

    const query: any = {};
    if (status) query.status = status;
    if (priority) query.priority = priority;
    if (search) {
      query.$or = [
        { ticketId: { $regex: search, $options: 'i' } },
      ];
    }

    const [tickets, total] = await Promise.all([
      Ticket.find(query)
        .populate('userId', 'firstName lastName email avatar')
        .populate('adminId', 'firstName lastName')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Ticket.countDocuments(query),
    ]);

    return { tickets, total, page, totalPages: Math.ceil(total / limit) };
  },

  async getTicket(ticketId: string) {
    return Ticket.findOne({ ticketId })
      .populate('userId', 'firstName lastName email avatar')
      .populate('adminId', 'firstName lastName')
      .populate('resolvedBy', 'firstName lastName');
  },

  async updateTicket(ticketId: string, updates: {
    status?: string;
    priority?: string;
    notes?: string;
    resolvedBy?: string;
  }) {
    const set: any = {};
    if (updates.status) set.status = updates.status;
    if (updates.priority) set.priority = updates.priority;
    if (updates.notes !== undefined) set.notes = updates.notes;
    if (updates.status === 'resolved' || updates.status === 'closed') {
      set.resolvedAt = new Date();
      if (updates.resolvedBy) set.resolvedBy = updates.resolvedBy;
    }

    return Ticket.findOneAndUpdate({ ticketId }, { $set: set }, { new: true })
      .populate('userId', 'firstName lastName email avatar')
      .populate('adminId', 'firstName lastName')
      .populate('resolvedBy', 'firstName lastName');
  },

  async getStats() {
    const [open, in_progress, resolved, closed, urgent] = await Promise.all([
      Ticket.countDocuments({ status: 'open' }),
      Ticket.countDocuments({ status: 'in_progress' }),
      Ticket.countDocuments({ status: 'resolved' }),
      Ticket.countDocuments({ status: 'closed' }),
      Ticket.countDocuments({ priority: 'urgent', status: { $in: ['open', 'in_progress'] } }),
    ]);
    return { open, in_progress, resolved, closed, urgent };
  },
};
