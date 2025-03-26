import { Request, Response } from 'express';
import { agentService } from '../services/agentService.js';
import { ConversationService } from '../services/conversationService.js';
import ConversationModel from '../models/conversationModel.js';
import { AIService } from '../services/aiService.js';
import { AIMemoryService } from '../services/aiMemoryService.js';

// Create the required services
const aiMemoryService = new AIMemoryService();
const aiService = new AIService();

// Create an instance of ConversationService with proper dependencies
const conversationService = new ConversationService(aiService, aiMemoryService);

class ConversationController {
    async startConversation(req: Request, res: Response) {
        try {
            const { agentSlug } = req.body;
            const userId = req.user?.id;

            if (!userId) {
                return res.status(401).json({ error: 'Unauthorized' });
            }

            console.log(`Starting conversation - User: ${userId}, Agent: ${agentSlug}`);
            
            const agent = await agentService.getAgentBySlug(agentSlug);
            if (!agent) {
                return res.status(404).json({ error: 'Agent not found' });
            }

            const conversation = await conversationService.startConversation(
                userId,
                agent._id.toString(),
                agentSlug
            );
            
            console.log(`Conversation started - ID: ${conversation._id}`);
            console.log(`Initial message: "${conversation.messages[0]?.content}"`);
            
            return res.status(200).json(conversation);
        } catch (error) {
            console.error('Error starting conversation:', error);
            return res.status(500).json({ error: 'Failed to start conversation' });
        }
    }

    async deleteConversation(req: Request, res: Response) {
        try {
            const { agentSlug } = req.params;
            const userId = req.user?.id;

            if (!userId) {
                return res.status(401).json({ error: 'Unauthorized' });
            }

            console.log(`Deleting conversation - User: ${userId}, Agent: ${agentSlug}`);
            
            await ConversationModel.deleteMany({ userId, agentSlug });
            
            return res.status(200).json({ message: 'Conversation deleted successfully' });
        } catch (error) {
            console.error('Error deleting conversation:', error);
            return res.status(500).json({ error: 'Failed to delete conversation' });
        }
    }
}

export default new ConversationController(); 