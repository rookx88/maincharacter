import { AIAgent, AgentDocument } from '../types/agent.js';
import AgentModel from '../models/agentModel.js';
import { getTimeBasedGreeting } from '../utils/timeUtils.js';
import { generateSlug } from '../utils/slugUtils.js';
import { ObjectId } from 'mongodb';
import mongoose from 'mongoose';

export class AgentService {
    async loadProfile(profileId: string): Promise<AIAgent> {
        const profile = await AgentModel.findById(profileId).lean();
        if (!profile) {
            throw new Error(`Profile not found: ${profileId}`);
        }

        const greeting = getTimeBasedGreeting();

        // Core identity and style with null checks
        const basePrompt = `${greeting}! You are ${profile.name}, ${profile.bio?.[0] || ''}

Key Traits: ${profile.traits?.core?.join(', ') || ''}
Style: ${profile.style?.speaking?.join(', ') || ''}`;

        // Return with OpenAI defaults
        return {
            ...profile,
            _id: profile._id,
            model: "gpt-3.5-turbo",
            temperature: 0.7,
            presence_penalty: 0.6,
            frequency_penalty: 0.3,
            systemPrompt: basePrompt
        } as unknown as AIAgent;
    }

    async listProfiles() {
        console.log('AgentService: Starting listProfiles');
        
        // Debug MongoDB connection
        const dbName = mongoose.connection.db?.databaseName;
        console.log('Connected to database:', dbName);
        
        // Debug collections
        const collections = await mongoose.connection.db?.listCollections().toArray();
        console.log('Available collections:', collections?.map(c => c.name));
        
        // Debug agents collection
        const agents = await AgentModel.find({});
        console.log('Raw agents from DB:', JSON.stringify(agents, null, 2));
        console.log('AgentService: Found agents:', agents.length);
        
        return agents;
    }

    async getAgentById(agentId: string): Promise<AIAgent | null> {
        try {
            let agent = null;
            if (mongoose.Types.ObjectId.isValid(agentId)) {
                agent = await AgentModel.findById(agentId).lean();
            }
            if (!agent) {
                agent = await AgentModel.findOne({ slug: agentId }).lean();
            }
            
            if (!agent) return null;

            return {
                ...agent,
                _id: agent._id,
                model: "gpt-3.5-turbo",
                temperature: 0.7,
                presence_penalty: 0.6,
                frequency_penalty: 0.3
            } as unknown as AIAgent;
        } catch (error) {
            console.error('Error in getAgentById:', error);
            throw error;
        }
    }

    async getAgentIdentity(slug: string): Promise<AgentIdentity> {
        const agent = await AgentModel.findOne({ slug }).lean();
        if (!agent) throw new Error('Agent not found');
        
        return {
            id: agent._id,
            slug: agent.slug,
            category: agent.category || ''
        };
    }

    async createOrUpdateProfile(profileData: Partial<AgentDocument>) {
        const existingSlugs = await AgentModel.distinct('slug');
        
        if (!profileData.slug) {
            profileData.slug = generateSlug(profileData.name!, existingSlugs);
        }

        if (existingSlugs.includes(profileData.slug)) {
            throw new Error('Slug must be unique');
        }

        return await AgentModel.findOneAndUpdate(
            { _id: profileData._id },
            profileData,
            { upsert: true, new: true, lean: true }
        );
    }

    async getAgentBySlug(slug: string): Promise<AIAgent | null> {
        const agent = await AgentModel.findOne({ slug }).lean();
        
        if (!agent) return null;

        return {
            ...agent,
            _id: agent._id,
            model: "gpt-3.5-turbo",
            temperature: 0.7,
            presence_penalty: 0.6,
            frequency_penalty: 0.3
        } as unknown as AIAgent;
    }
}

export interface AgentIdentity {
    id: ObjectId;
    slug: string;
    category: string;
}

export const agentService = new AgentService(); 