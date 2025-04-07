import express from 'express';
import { services } from '../services/index.js';
import isAuthenticated from '../middleware/authMiddleware.js';
import AgentModel from '../models/agentModel.js';
import agentService from '../services/agentService.js';

const router = express.Router();

router.get('/', isAuthenticated, async (req, res) => {
    try {
        console.log('GET /api/agents - Starting request');
        const agents = await services.agentService.listProfiles();
        console.log('GET /api/agents - Raw response:', agents);
        res.json(agents);
    } catch (error) {
        console.error('GET /api/agents - Error:', error);
        res.status(500).json({ error: 'Failed to fetch agents' });
    }
});

router.get('/slug/:slug', async (req, res) => {
    try {
        const agent = await AgentModel.findOne({ slug: req.params.slug });
        if (!agent) {
            return res.status(404).json({ error: 'Agent not found' });
        }
        res.json(agent);
    } catch (error) {
        console.error('Agent fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch agent' });
    }
});

router.get("/by-slug/:slug", async (req, res) => {
    try {
        const agent = await agentService.getAgentIdentity(req.params.slug);
        res.json(agent);
    } catch (error) {
        res.status(404).json({ error: "Agent not found" });
    }
});

export default router;