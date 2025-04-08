import mongoose, { Schema, Document, Model } from 'mongoose';
import { ChatMessage, ConversationState, IntroductionStage } from '../types/conversation.js';

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

// Memory details schema
const memoryDetailsSchema = new mongoose.Schema({
    fragmentId: { type: String },
    content: { type: String }
});

// Updated schema for narrative state with explicit fields for introduction flow
const narrativeStateSchema = new mongoose.Schema({
    hasCompletedIntroduction: { type: Boolean, default: false },
    relationshipStage: { 
        type: String, 
        enum: ['stranger', 'acquaintance', 'friend'],
        default: 'stranger'
    },
    // Add these explicit fields for the introduction flow
    introStage: { 
        type: String, 
        enum: Object.values(IntroductionStage),
        default: IntroductionStage.INITIAL_GREETING
    },
    stageRepeatCount: { type: Number, default: 0 },
    memoryDetails: { type: memoryDetailsSchema, default: () => ({}) },
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
        role: 'user' | 'assistant' | 'system';
        content: string;
        timestamp: Date;
    }>;
    currentNode: string;
    conversationState: ConversationState;
    narrativeState: {
        hasCompletedIntroduction: boolean;
        relationshipStage: 'stranger' | 'acquaintance' | 'friend';
        // Add these to the interface as well
        introStage?: IntroductionStage;
        stageRepeatCount?: number;
        memoryDetails?: {
            fragmentId?: string;
            content?: string;
        };
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
    // Updated narrative state with the explicit schema
    narrativeState: {
        type: narrativeStateSchema,
        default: () => ({
            hasCompletedIntroduction: false,
            relationshipStage: 'stranger',
            introStage: IntroductionStage.INITIAL_GREETING,
            stageRepeatCount: 0,
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

// Post-save hook to create memory from conversation when inactive
ConversationSchema.post<IConversation & { _id: unknown } & { __v: number }>('save', async function(doc) {
    if (!doc.active) {
        try {
            // Import the service directly to avoid circular dependencies
            const { default: memoryService } = await import('../services/memoryService.js');
            await memoryService.createFromConversation(doc);
        } catch (error) {
            console.error('Error creating memory from conversation:', error);
        }
    }
});

// Define the model interface
interface IConversationModel extends Model<IConversation> {}

const Conversation = mongoose.model<IConversation, IConversationModel>('Conversation', ConversationSchema);
export default Conversation;