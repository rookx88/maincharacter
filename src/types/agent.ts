import { TimePeriod } from './common.js';
import { InferSchemaType, Types } from 'mongoose';
import { agentSchema } from '../models/agentModel.js';

export interface IAIProfile {
    _id?: string;
    name: string;
    slug: string;
    category: string;
    description: string;
    avatar?: string;
    interests: string[];
    emotionalBaseline: {
        default: string;
        range: string[];
    };
    bio: string[];
    lastInteraction?: Date;
    lastMessage?: string;
    lastResponse?: string;
    traits: {
        core: string[];
        personality?: string[];
        adaptive: {
            warmth?: number;
            creativity?: number;
            enthusiasm: number;
            empathy?: number;
            formality?: number;
            observation?: number;
            curiosity?: number;
            adaptability?: number;
            expressiveness?: number;
        };
    };
    style: {
        speaking: string[];
        patterns: string[];
        tone: string[];
        greeting: string;
    };
    expertise: {
        topics: string[];
        background?: string[];
        specialties: string[];
    };
    createdAt: Date;
    updatedAt: Date;
    memories?: Array<{
        content: string;
        timestamp: Date;
        significance: number;
        timePeriod: TimePeriod;
        yearEstimate: number;
    }>;
}

// Base type from schema
export type AgentDocument = InferSchemaType<typeof agentSchema> & {
    _id: Types.ObjectId;
};

// OpenAI specific settings
export interface AIAgent extends AgentDocument {
    model: string;
    temperature: number;
    presence_penalty: number;
    frequency_penalty: number;
    responsePreferences?: {
        defaultLength: "short" | "moderate" | "long";
        questionFrequency: "low" | "moderate" | "high";
        emotionalDepth: "low" | "moderate" | "high";
        memoryUsage: "minimal" | "moderate" | "extensive";
    };
}

export interface AgentPersonality {
    name: string;
    role: string;
    traits: string[];
    interests: string[];
    speakingStyle: string[];
    backgroundContext: string;
}

export interface AgentActivity {
    type: string;
    name: string;
    description: string;
    requirements: {
        minEngagement: number;
        requiredTopics: string[];
    };
    revealPrompt: string;
}

export interface Agent {
    id: string;
    slug: string;
    personality: AgentPersonality;
    activity: AgentActivity;
    systemPrompt: string;
    contextRules: {
        memoryThreshold: number;
        topicRelevance: number;
        emotionalEngagement: number;
    };
} 