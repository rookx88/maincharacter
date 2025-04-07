import { Request, Response, NextFunction } from 'express';
import agentService from '../services/agentService.js';
import { handleError } from '../utils/errorHandler.js';
import AgentModel from '../models/agentModel.js';
import { Document } from 'mongoose';
import { IAIProfile } from '../models/aiProfileModel.js';


interface AgentRequestBody {
    agentSlug: string;
    [key: string]: any;
}

// Central agent resolution
export const resolveAgent = async (req: Request, res: Response, next: NextFunction) => {
    try {
        // Check both possible field names
        const agentSlug = req.body.agentSlug || req.body.agentId;
        
        if (!agentSlug) {
            return res.status(400).json({ error: 'Agent identifier required' });
        }

        console.log('Looking up agent by slug:', agentSlug);
        const agent = await AgentModel.findOne({ slug: agentSlug });
        
        if (!agent) {
            console.error('No agent found for slug:', agentSlug);
            return res.status(404).json({ error: 'Agent not found' });
        }

        console.log('Found agent:', agent._id);
        req.agent = {
            id: agent._id,
            slug: agent.slug,
            category: agent.category || ''
        };
        next();
    } catch (error) {
        console.error('Agent resolution error:', error);
        res.status(500).json({ error: 'Failed to resolve agent' });
    }
};