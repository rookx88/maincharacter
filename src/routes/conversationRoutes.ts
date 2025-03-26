import { Router } from 'express';
import { ConversationController } from '../controllers/conversationController.js';
import authMiddleware from '../middleware/authMiddleware.js';
import { services } from '../services/index.js';
import Conversation from '../models/conversationModel.js';
import { agentService } from '../services/agentService.js';

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

router.delete('/:agentSlug', authMiddleware, conversationController.deleteConversation);

// Get messages for a specific agent
router.get('/:agentSlug/messages', authMiddleware, async (req, res) => {
    try {
        const { agentSlug } = req.params;
        const userId = req.user?.id;

        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        console.log(`Getting messages - User: ${userId}, Agent: ${agentSlug}`);
        
        const agent = await agentService.getAgentBySlug(agentSlug);
        if (!agent) {
            return res.status(404).json({ error: 'Agent not found' });
        }

        const conversation = await Conversation.findOne({
            userId,
            agentSlug,
            active: true
        }).sort({ updatedAt: -1 });

        if (!conversation) {
            return res.status(200).json({ messages: [] });
        }

        console.log(`Found conversation with ${conversation.messages.length} messages`);
        
        return res.status(200).json({ 
            messages: conversation.messages,
            conversationId: conversation._id
        });
    } catch (error) {
        console.error('Error getting messages:', error);
        return res.status(500).json({ error: 'Failed to get messages' });
    }
});

export default router;
