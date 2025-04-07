import express from 'express';
import { MemoryController } from '../controllers/memoryController.js';
import { authenticateToken } from '../middleware/auth.js';
import Conversation from '../models/conversationModel.js';

const router = express.Router();
const memoryController = new MemoryController();

// Batch create endpoint
router.post('/batch', authenticateToken, memoryController.createMemoriesBatch);

// Memory viewer endpoint
router.get('/user/:userId/memories', authenticateToken, (req, res, next) => {
    console.log('Memory route hit with userId:', req.params.userId);
    next();
}, memoryController.getMemoryFragments);

router.post('/from-conversation/:id', 
  authenticateToken,
  async (req, res) => {
    try {
      const conversation = await Conversation.findById(req.params.id);
      if (!conversation) {
          return res.status(404).json({ error: 'Conversation not found' });
      }
      
      // Import the service directly
      const MemoryService = (await import('../services/memoryService.js')).default;
      const memory = await MemoryService.createFromConversation(conversation);
      res.status(201).json(memory);
    } catch (error) {
      res.status(500).json({ error: 'Memory creation failed' });
    }
  }
);

export default router;