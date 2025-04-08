import { Router } from 'express';
import ConversationController from '../controllers/conversationController.js';
import authMiddleware from '../middleware/authMiddleware.js';
import Conversation from '../models/conversationModel.js';

const router = Router();

// Get all available agents
router.get('/agents', ConversationController.getAgents.bind(ConversationController));

// Start or continue a conversation
router.post('/start', authMiddleware, ConversationController.startConversation.bind(ConversationController));

// Send a message to the agent
router.post('/message', authMiddleware, ConversationController.chat.bind(ConversationController));

// Get messages for a specific agent
router.get('/:agentSlug/messages', authMiddleware, ConversationController.getMessages.bind(ConversationController));

// Delete a conversation
router.delete('/:agentSlug', authMiddleware, ConversationController.deleteConversation.bind(ConversationController));

// Get memory fragments for a user
router.get('/memories/:userId', authMiddleware, ConversationController.getMemoryFragments.bind(ConversationController));

// Add this to src/routes/conversationRoutes.ts

// Reset a conversation for testing purposes
router.post('/reset', authMiddleware, async (req, res) => {
    try {
      const { agentSlug } = req.body;
      const userId = req.user?.id;
      
      if (!userId || !agentSlug) {
        return res.status(400).json({ error: 'User ID and agent slug are required' });
      }
      
      // Find and delete any existing conversations
      await Conversation.deleteMany({
        userId,
        agentSlug,
        active: true
      });
      
      console.log(`Reset conversation for user ${userId} and agent ${agentSlug}`);
      
      // Return success
      res.status(200).json({ 
        success: true, 
        message: 'Conversation reset successfully'
      });
    } catch (error) {
      console.error('Error resetting conversation:', error);
      res.status(500).json({ error: 'Failed to reset conversation' });
    }
  });
  
export default router;