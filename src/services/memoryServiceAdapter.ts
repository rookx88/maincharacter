// src/services/memoryServiceAdapter.ts
import { AIMemoryService } from './aiMemoryService.js';
import { IMemoryService } from '../types/services.js';
import { logger } from '../utils/logger.js';
import { ConversationCheckpoint } from '../utils/conversationCheckpoints.js';

// This adapter makes AIMemoryService compatible with IMemoryService
export class MemoryServiceAdapter implements IMemoryService {
  constructor(private aiMemoryService: AIMemoryService) {}
  
  async getRelevantMemories(userId: string, agentId: string, message: string, limit: number = 5): Promise<any[]> {
    return this.aiMemoryService.getRelevantMemories(userId, agentId, message, limit);
  }
  
  async createMemoryFromMessage(
    userId: string, 
    agentId: string, 
    message: string, 
    conversationId?: string
  ): Promise<any> {
    // Adapt to AIMemoryService's expected parameter order
    // Note: AIMemoryService expects (message, userId, agentId, checkpoint)
    // We're omitting the checkpoint parameter since it's not in our interface
    return this.aiMemoryService.createMemoryFromMessage(
      message,
      userId,
      agentId,
      // Use a default checkpoint or omit it if not required
      'entry' as ConversationCheckpoint
    );
  }
  
  async updateMemoryWithDetails(memoryId: string, additionalDetails: string): Promise<any> {
    // Implement as needed - this could be a stub if AIMemoryService doesn't support this
    logger.warn('[ADAPTER] updateMemoryWithDetails not fully implemented in AIMemoryService');
    return null;
  }
  
  async searchMemories(userId: string, agentId: string, query: string, limit: number = 5): Promise<any[]> {
    return this.aiMemoryService.getRelevantMemories(userId, agentId, query, limit);
  }
  
  async getMemoriesInTimeframe(userId: string, timeframe: any): Promise<any[]> {
    // Implement as needed
    logger.warn('[ADAPTER] getMemoriesInTimeframe not implemented in AIMemoryService');
    return [];
  }
  
  async analyzeMemorySignificance(content: string): Promise<number> {
    return this.aiMemoryService.analyzeSignificance(content);
  }
  
  async extractThemes(message: string): Promise<string[]> {
    // Implement as needed - this could return empty array if not supported
    logger.warn('[ADAPTER] extractThemes not implemented in AIMemoryService');
    return [];
  }
  
  async createFromConversation(conversation: any): Promise<any> {
    // Implement conversion from conversation to memory
    return this.aiMemoryService.createFromConversation(conversation);
  }
}