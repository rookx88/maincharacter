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

// New schema for narrative state
const narrativeStateSchema = new mongoose.Schema({
    hasCompletedIntroduction: { type: Boolean, default: false },
    relationshipStage: { 
        type: String, 
        enum: ['stranger', 'acquaintance', 'friend'],
        default: 'stranger'
    },
    knownTopics: [String],
    sharedStories: [String],
    lastInteractionTimestamp: { type: Date, default: Date.now },
    agentSpecificState: { type: Schema.Types.Mixed, default: {} }
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
    narrativeState: {
        hasCompletedIntroduction: boolean;
        relationshipStage: 'stranger' | 'acquaintance' | 'friend';
        knownTopics: string[];
        sharedStories: string[];
        lastInteractionTimestamp: Date;
        agentSpecificState: Record<string, any>;
    };
    createdAt: Date;
    updatedAt: Date;
}

export type IConversationDocument = IConversation & Document;

const ConversationSchema = new Schema<IConversation>({
    userId: { type: String, required: true },
    agentId: { type: String, required: true },
    agentSlug: { type: String, required: true },
    active: { type: Boolean, default: true },
    messages: [messageSchema],
    currentNode: { type: String, default: 'entry' },
    conversationState: {
        currentNode: { type: String, default: 'entry' },
        hasMetBefore: { type: Boolean, default: false },
        engagementLevel: { type: Number, default: 0 },
        revealMade: { type: Boolean, default: false },
        userAcceptedActivity: { type: Boolean, default: false },
        lastInteractionDate: { type: Date, default: Date.now },
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
    },
    // Add the narrative state to the schema
    narrativeState: {
        type: narrativeStateSchema,
        default: () => ({
            hasCompletedIntroduction: false,
            relationshipStage: 'stranger',
            knownTopics: [],
            sharedStories: [],
            lastInteractionTimestamp: new Date(),
            agentSpecificState: {}
        })
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