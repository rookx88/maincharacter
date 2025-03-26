import { Document, Types } from 'mongoose';
import { AIMemory } from './aiMemory.js';

// Message structure
export interface Message {
    role: 'system' | 'user' | 'assistant';
    content: string;
    timestamp: Date;
}

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
    timestamp: Date;
}

// Base conversation interface
export interface IConversation {
    userId: string;
    agentId: Types.ObjectId;
    agentSlug: string;
    messages: ChatMessage[];
    currentNode: ConversationNodeType;
    memories?: AIMemory[];
    state?: ConversationState;
}

// Document interface for Mongoose
export interface ConversationDocument extends Document {
    userId: string;
    agentId: string;
    messages: Array<{
        role: string;
        content: string;
        timestamp: Date;
    }>;
    context: {
        memories: string[];
        significance: number;
        topics: string[];
        emotions: string[];
    };
    metadata: {
        lastAccessed: Date;
        memoryCreated: boolean;
        fragmentCreated: boolean;
    };
    active: boolean;
    createdAt: Date;
    updatedAt: Date;
}

export interface MessageGroup {
    context: string;
    messages: ChatMessage[];
    emotion?: string;
    timestamp: Date;
    significance?: number;
}

export enum NodeType {
    ENTRY = 'entry',
    INTRODUCTION = 'introduction',
    STORY_DISCOVERY = 'story_discovery',
    EVALUATION = 'evaluation',
    DEEPENING = 'deepening',
    REVEAL = 'reveal',
    ACTIVITY = 'activity'
}

export enum AgentType {
    PODCAST_HOST = 'podcast_host',
    CHEF = 'chef',
    STYLIST = 'stylist'
}

export enum ConversationNodeType {
    ENTRY = 'entry',
    FIRST_MEETING = 'first_meeting',
    CASUAL_CONVERSATION = 'casual_conversation',
    REVEAL_OPPORTUNITY = 'reveal_opportunity',
    MINI_GAME = 'mini_game'
}

export interface ConversationState {
    currentNode: ConversationNodeType;
    hasMetBefore: boolean;
    engagementLevel: number;
    revealMade: boolean;
    userAcceptedActivity: boolean;
    lastInteractionDate: Date;
}

export interface NodeContent {
    type: NodeType;
    content: string;
    responses?: string[];
    conditions?: {
        requiredScore?: number;
        requiredElements?: string[];
        emotionalThresholds?: {
            engagement?: number;
            rapport?: number;
        };
    };
}

export interface AgentSpecificContent {
    [AgentType.PODCAST_HOST]: NodeContent;
    [AgentType.CHEF]: NodeContent;
    [AgentType.STYLIST]: NodeContent;
}

export interface ConversationNode {
    id: ConversationNodeType;
    nodeType: 'greeting' | 'dialogue';
    content: string;
    responses: string[];
    nextNodes: ConversationNodeType[];
    handler: (message: string, state: ConversationState, context: any) => Promise<{
        response: string;
        nextNode: ConversationNodeType;
        updatedState: Partial<ConversationState>;
    }>;
}

export interface AgentNarrativeState {
    hasCompletedIntroduction: boolean;
    relationshipStage: 'stranger' | 'acquaintance' | 'friend';
    knownTopics: string[];
    sharedStories: string[];
    lastInteractionTimestamp: Date;
    agentSpecificState: Record<string, any>;
    introStage?: IntroductionStage;
}

export enum IntroductionStage {
    INITIAL_GREETING = 'initial_greeting',
    ESTABLISH_SCENARIO = 'establish_scenario',
    REVEAL_CAPABILITIES = 'reveal_capabilities',
    REQUEST_ASSISTANCE = 'request_assistance',
    EXPRESS_GRATITUDE = 'express_gratitude',
    ESTABLISH_RELATIONSHIP = 'establish_relationship'
} 