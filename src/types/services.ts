// src/types/services.ts
export interface IMemoryService {
    // Core memory retrieval
    getRelevantMemories(userId: string, agentId: string, message: string, limit?: number): Promise<any[]>;
    
    // Memory creation
    createMemoryFromMessage(userId: string, agentId: string, message: string, conversationId?: string): Promise<any>;
    
    // Memory updating
    updateMemoryWithDetails(memoryId: string, additionalDetails: string): Promise<any>;
    
    // Memory querying
    searchMemories(userId: string, agentId: string, query: string, limit?: number): Promise<any[]>;
    getMemoriesInTimeframe(userId: string, timeframe: any): Promise<any[]>;
    
    // Memory analysis
    analyzeMemorySignificance(content: string): Promise<number>;
    extractThemes(message: string): Promise<string[]>;
    
    // For compatibility with existing code
    createFromConversation(conversation: any): Promise<any>;
  }