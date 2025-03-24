import { Router } from 'express';
import { ConversationController } from '../controllers/conversationController.js';
import authMiddleware from '../middleware/authMiddleware.js';
import { services } from '../services/index.js';

const router = Router();
const conversationController = new ConversationController();

// Get list of available conversation agents
router.get("/agents", async (req, res) => {
    try {
        const agents = await services.conversationService.getAgents();
        res.json(agents);
    } catch (error) {
        console.error('Error fetching agents:', error);
        res.status(500).json({ error: 'Failed to fetch agents' });
    }
});

// Start or continue a conversation
router.post("/start", authMiddleware, async (req, res) => {
    try {
        await conversationController.startConversation(req, res);
    } catch (error) {
        console.error('Conversation creation error:', error);
        res.status(500).json({ 
            error: 'Failed to start conversation',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// Send a message to the AI
router.post('/message', authMiddleware, async (req, res) => {
    try {
        await conversationController.chat(req, res);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ 
            error: 'Failed to process message',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

export default router;
