import { Router } from 'express';
import ConversationController from '../controllers/conversationController.js';
import authMiddleware from '../middleware/authMiddleware.js';
import Conversation from '../models/conversationModel.js';
import { ConversationNodeType, IntroductionStage } from '../types/conversation.js';
import agentService from '../services/agentService.js';

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

// Reset a conversation with mode - COMBINED IMPLEMENTATION
router.post('/reset', authMiddleware, async (req, res) => {
  try {
    const { agentSlug, mode } = req.body;
    const userId = req.user?.id;
    
    if (!userId || !agentSlug) {
      return res.status(400).json({ error: 'User ID and agent slug are required' });
    }
    
    console.log(`Resetting conversation for user ${userId} and agent ${agentSlug} to mode: ${mode || 'default'}`);
    
    // Find and delete any existing conversations
    await Conversation.deleteMany({
      userId,
      agentSlug,
      active: true
    });
    
    // If we're creating a casual conversation (skip intro)
    if (mode === 'casual') {
      // Create a new conversation with completed introduction
      const agent = await agentService.getAgentBySlug(agentSlug);
      
      if (agent) {
        // Create a new conversation with hasCompletedIntroduction set to true
        const newConversation = new Conversation({
          userId,
          agentId: agent._id.toString(),
          agentSlug,
          currentNode: ConversationNodeType.CASUAL_CONVERSATION,
          narrativeState: {
            hasCompletedIntroduction: true,
            relationshipStage: 'acquaintance',
            knownTopics: [],
            sharedStories: [],
            lastInteractionTimestamp: new Date(),
            agentSpecificState: {}
          },
          messages: [{
            role: 'assistant',
            content: `Hi there! I'm ${agent.name}. What would you like to talk about today?`,
            timestamp: new Date()
          }],
          active: true
        });
        
        await newConversation.save();
        console.log(`Created new casual conversation: ${newConversation._id}`);
        
        return res.status(200).json({
          success: true,
          message: 'Casual conversation created successfully',
          conversation: newConversation
        });
      }
    }
    
    // For introduction mode or default, just return success
    return res.status(200).json({ 
      success: true, 
      message: `Conversation reset to ${mode || 'default'} mode`
    });
  } catch (error) {
    console.error('Error resetting conversation:', error);
    res.status(500).json({ error: 'Failed to reset conversation' });
  }
});
  
export default router;