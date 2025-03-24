import mongoose from 'mongoose';

export const agentSchema = new mongoose.Schema({
    name: { type: String, required: true },
    slug: { type: String, required: true },
    category: String,
    description: String,
    avatar: String,
    interests: [String],
    emotionalBaseline: {
        default: String,
        range: [String]
    },
    bio: [String],
    lastInteraction: Date,
    lastMessage: String,
    lastResponse: String,
    traits: {
        core: [String],
        personality: [String],
        adaptive: {
            warmth: { type: Number, default: 0.5 },
            creativity: { type: Number, default: 0.5 },
            enthusiasm: { type: Number, default: 0.7 },
            empathy: { type: Number, default: 0.8 },
            formality: { type: Number, default: 0.6 },
            observation: { type: Number, default: 0.5 },
            curiosity: { type: Number, default: 0.7 },
            adaptability: { type: Number, default: 0.6 },
            expressiveness: { type: Number, default: 0.5 }
        }
    },
    style: {
        speaking: [String],
        patterns: [String],
        tone: [String],
        greeting: { type: String, default: 'Hello!' }
    },
    expertise: {
        topics: [String],
        specialties: [String]
    },
    systemPrompt: String
}, {
    timestamps: true
});

const AgentModel = mongoose.model('Agent', agentSchema, 'agents');
export default AgentModel; 