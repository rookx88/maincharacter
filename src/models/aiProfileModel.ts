import mongoose, { Schema, Document, Model } from "mongoose";
import { generateSlug } from "../utils/slugUtils.js";
import { AgentType } from "../types/conversation.js";

interface IAIProfileBase {
    _id: mongoose.Types.ObjectId;
    name: string;
    bio: string[];
    systemPrompt: string;
    category: string;
    description: string;
    traits: {
        core: string[];
        personality: string[];
        adaptive: {
            warmth: number;
            creativity: number;
            enthusiasm: number;
            empathy: number;
            formality: number;
            observation: number;
            curiosity: number;
            adaptability: number;
            expressiveness: number;
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
        background: string[];
        specialties: string[];
    };
    interests: string[];
    emotionalBaseline: {
        default: string;
        range: string[];
    };
    avatar: string;
    memories: {
        content: string;
        timestamp: Date;
        significance: number;
        timePeriod: string;
        yearEstimate: number;
    }[];
    model: string;
    temperature: number;
    presence_penalty: number;
    frequency_penalty: number;
    slug: string;
}

export interface IAIProfile extends Omit<Document<any>, 'model'> {
    name: string;
    bio: string[];
    systemPrompt: string;
    category: string;
    description: string;
    traits: {
        core: string[];
        personality: string[];
        adaptive: {
            warmth: number;
            creativity: number;
            enthusiasm: number;
            empathy: number;
            formality: number;
            observation: number;
            curiosity: number;
            adaptability: number;
            expressiveness: number;
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
        background: string[];
        specialties: string[];
    };
    interests: string[];
    emotionalBaseline: {
        default: string;
        range: string[];
    };
    avatar: string;
    memories: {
        content: string;
        timestamp: Date;
        significance: number;
        timePeriod: string;
        yearEstimate: number;
    }[];
    slug: string;
    temperature: number;
    presence_penalty: number;
    frequency_penalty: number;
    model: string;
}

export type IAIProfileModel = Model<IAIProfile>;

const aiProfileSchema = new Schema<IAIProfile>({
    name: String,
    bio: [String],
    systemPrompt: String,
    category: String,
    description: String,
    traits: {
        core: [String],
        personality: [String],
        adaptive: {
            warmth: Number,
            creativity: Number,
            enthusiasm: Number,
            empathy: Number,
            formality: Number,
            observation: Number,
            curiosity: Number,
            adaptability: Number,
            expressiveness: Number
        }
    },
    style: {
        speaking: [String],
        patterns: [String],
        tone: [String],
        greeting: String
    },
    expertise: {
        topics: [String],
        background: [String],
        specialties: [String]
    },
    interests: [String],
    emotionalBaseline: {
        default: String,
        range: [String]
    },
    avatar: String,
    memories: [{
        content: String,
        timestamp: Date,
        significance: Number,
        timePeriod: String,
        yearEstimate: Number
    }],
    slug: String,
    temperature: Number,
    presence_penalty: Number,
    frequency_penalty: Number,
    model: String
}, {
    timestamps: true
});

aiProfileSchema.pre('validate', function(next) {
    if (!this.slug) {
        this.slug = generateSlug(this.name, []);
    }
    next();
});

export default mongoose.model<IAIProfile>('AIProfile', aiProfileSchema); 