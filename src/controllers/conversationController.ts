// src/controllers/conversationController.ts
import { Request, Response } from "express";
import Conversation from "../models/conversationModel.js";
import { ConversationService } from '../services/conversationService.js';
import { MemoryService } from '../services/memoryService.js';
import { AgentService } from '../services/agentService.js';
import { AIService } from '../services/aiService.js';
import { logger } from '../utils/logger.js';
import { AppError, handleError } from '../utils/errorHandler.js';
import mongoose from 'mongoose';

export class ConversationController {
  constructor(
    private conversationService: ConversationService,
    private agentService: AgentService,
    private memoryService: MemoryService
  ) {}

  /**
   * Get available conversation agents
   */
  async getAgents(req: Request, res: Response) {
    try {
      logger.info('[API] Getting conversation agents');
      
      const agents = await this.agentService.listProfiles();
      
      return res.status(200).json(agents);
    } catch (error) {
      logger.error('[API] Failed to get agents', error);
      return handleError(res, error);
    }
  }

  /**
   * Start or continue a conversation
   */
  async startConversation(req: Request, res: Response) {
    try {
      const { agentSlug } = req.body;
      const userId = req.user?.id;
      
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      
      logger.info('[API] Starting conversation', { userId, agentSlug });
      
      // Check if agent exists
      const agent = await this.agentService.getAgentBySlug(agentSlug);
      if (!agent) {
        return res.status(404).json({ error: 'Agent not found' });
      }
      
      // Get or create conversation
      const { conversation, isNew } = await this.conversationService.getOrCreateConversation(
        userId,
        agentSlug
      );
      
      // Log whether it's a new or existing conversation
      logger.info(`[API] ${isNew ? 'Created new' : 'Retrieved existing'} conversation`, {
        conversationId: conversation._id instanceof mongoose.Types.ObjectId ? 
          conversation._id.toString() : 
          String(conversation._id)
      });
      
      // Return the conversation with messages
      return res.status(200).json({
        _id: conversation._id,
        agentSlug: conversation.agentSlug,
        messages: conversation.messages,
        currentNode: conversation.currentNode,
        isNew
      });
    } catch (error) {
      logger.error('[API] Failed to start conversation', error);
      return handleError(res, error);
    }
  }

  /**
   * Send a message to the agent
   */
  async chat(req: Request, res: Response) {
    try {
      const { message, agentSlug } = req.body;
      const userId = req.user?.id;
      
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      
      if (!message || !agentSlug) {
        return res.status(400).json({ error: 'Message and agentSlug are required' });
      }
      
      logger.info('[API] Processing chat message', {
        userId,
        agentSlug,
        messagePreview: message.substring(0, 50) + (message.length > 50 ? '...' : '')
      });
      
      // Process the message
      const result = await this.conversationService.processMessage(
        userId,
        agentSlug,
        message
      );
      
      logger.info('[API] Chat message processed', {
        responsePreview: result.response.substring(0, 50) + (result.response.length > 50 ? '...' : '')
      });
      
      // Return the response
      return res.status(200).json({
        message: result.response,
        suggestedResponses: result.metadata?.suggestedResponses || [],
        conversationEnded: result.metadata?.conversationEnded || false,
        memoryFragmentId: result.metadata?.memoryFragmentId
      });
    } catch (error) {
      logger.error('[API] Failed to process message', error);
      return handleError(res, error);
    }
  }

  /**
   * Get messages for a specific agent
   */
  async getMessages(req: Request, res: Response) {
    try {
      const { agentSlug } = req.params;
      const userId = req.user?.id;
      
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      
      logger.info('[API] Getting messages', { userId, agentSlug });
      
      // Get the conversation for this agent
      const { conversation } = await this.conversationService.getOrCreateConversation(
        userId,
        agentSlug
      );
      
      logger.info('[API] Found conversation', {
        conversationId: conversation._id instanceof mongoose.Types.ObjectId ? 
          conversation._id.toString() : 
          String(conversation._id),
        messageCount: conversation.messages.length
      });
      
      // Return all messages
      return res.status(200).json({
        messages: conversation.messages,
        conversationId: conversation._id
      });
    } catch (error) {
      logger.error('[API] Failed to get messages', error);
      return handleError(res, error);
    }
  }

  /**
   * Delete a conversation
   */
  async deleteConversation(req: Request, res: Response) {
    try {
      const { agentSlug } = req.params;
      const userId = req.user?.id;
      
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      
      logger.info('[API] Deleting conversation', { userId, agentSlug });
      
      // Find and delete all conversations with this agent
      const result = await Conversation.deleteMany({
        userId,
        agentSlug
      });
      
      logger.info('[API] Conversation deleted', {
        deletedCount: result.deletedCount
      });
      
      return res.status(200).json({
        message: 'Conversation deleted successfully',
        deletedCount: result.deletedCount
      });
    } catch (error) {
      logger.error('[API] Failed to delete conversation', error);
      return handleError(res, error);
    }
  }

  /**
   * Get memory fragments for a user
   */
  /**
 * Get memory fragments for a user
 */
async getMemoryFragments(req: Request, res: Response) {
    try {
      const { userId } = req.params;
      
      if (req.user?.id !== userId) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      
      logger.info('[API] Getting memory fragments', { userId });
      
      // Use our existing memoryService instead of creating a new service
      const fragments = await this.memoryService.getRelevantMemories(
        userId,
        '', // Empty string for agentId since we want all fragments
        '', // Empty string for message since we want all fragments
        50 // Limit to 50 fragments
      );
      
      logger.info('[API] Found memory fragments', {
        count: fragments.length
      });
      
      return res.status(200).json(fragments);
    } catch (error) {
      logger.error('[API] Failed to get memory fragments', error);
      return handleError(res, error);
    }
  
  }
}

// Create instance with singleton services
import ConversationServiceInstance from '../services/conversationService.js';
import AIServiceInstance from '../services/aiService.js';
import MemoryServiceInstance from '../services/memoryService.js';
import AgentServiceInstance from '../services/agentService.js';
import { MemoryFragmentService } from '../services/memoryFragmentService.js';

export default new ConversationController(
  ConversationServiceInstance,
  AgentServiceInstance,
  MemoryServiceInstance
);