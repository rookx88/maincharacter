import mongoose, { Schema, Document } from 'mongoose';
import { ChatMessage, ConversationState, NodeType, AgentType, ConversationNodeType } from '../types/conversation.js';
import { MemoryService } from '../services/memoryService.js';
import { AIMemory } from '../types/aiMemory.js';

// Schema for individual messages
const messageSchema = new mongoose.Schema<ChatMessage>({
    role: { 
        type: String, 
        required: true, 
        enum: ['system', 'user', 'assistant']
    },
    content: { type: String, required: true },
    timestamp: { type: Date, default: Date.now }
});

export interface IConversation extends Document {
    userId: string;
    agentId: string;
    agentSlug: string;
    active: boolean;
    messages: Array<{
        role: 'user' | 'assistant';
        content: string;
        timestamp: Date;
    }>;
    currentNode: string;
    conversationState: ConversationState;
    createdAt: Date;
    updatedAt: Date;
}

export type IConversationDocument = IConversation & Document;

const ConversationSchema = new Schema({
    userId: { type: String, required: true },
    agentId: { type: String, required: true },
    agentSlug: { type: String, required: true },
    active: { type: Boolean, default: true },
    messages: [{
        role: { type: String, enum: ['user', 'assistant'], required: true },
        content: { type: String, required: true },
        timestamp: { type: Date, default: Date.now }
    }],
    currentNode: { 
        type: String, 
        default: 'entry',
        required: true 
    },
    conversationState: {
        storyProgress: {
            potentialScore: { type: Number, default: 0 },
            keyElements: [String],
            significantMoments: [String]
        },
        revealProgress: {
            isRevealed: { type: Boolean, default: false },
            revealTimestamp: Date,
            activityStarted: { type: Boolean, default: false }
        },
        emotionalState: {
            engagement: { type: Number, default: 0 },
            rapport: { type: Number, default: 0 },
            interest: { type: Number, default: 0 }
        }
    }
}, {
    timestamps: true
});

// Indexes for efficient querying
ConversationSchema.index({ userId: 1, agentId: 1, active: 1 });
ConversationSchema.index({ agentSlug: 1 });

interface IConversationModel extends mongoose.Model<IConversation> {}

ConversationSchema.post<IConversation & { _id: unknown } & { __v: number }>('save', async function(doc) {
    if (!doc.active) {
        const memoryService = new MemoryService();
        await memoryService.createFromConversation(doc);
    }
});

const Conversation = mongoose.model<IConversation, IConversationModel>('Conversation', ConversationSchema);
export default Conversation; 