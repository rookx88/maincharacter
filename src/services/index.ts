import { AIService } from './aiService.js';
import { ConversationService } from './conversationService.js';
import { AgentService } from './agentService.js';
import { AIMemoryService } from './aiMemoryService.js';

interface ServiceContainer {
    memoryService: AIMemoryService;
    agentService: AgentService;
    aiService: AIService;
    conversationService: ConversationService;
}

// Initialize services in dependency order
const memoryService = new AIMemoryService();
const agentService = new AgentService();
const aiService = new AIService();

export const services: ServiceContainer = {
    memoryService,
    agentService,
    aiService,
    conversationService: new ConversationService(
        aiService,
        memoryService
    )
}; 