import { AIService } from './aiService.js';
import { ConversationService } from './conversationService.js';
import { AgentService } from './agentService.js';
import { MemoryService } from './memoryService.js';

interface ServiceContainer {
    memoryService: MemoryService;
    agentService: AgentService;
    aiService: AIService;
    conversationService: ConversationService;
}

// Initialize services in dependency order
const memoryService = new MemoryService();
const agentService = new AgentService();
const aiService = new AIService();

export const services: ServiceContainer = {
    memoryService,
    agentService,
    aiService,
    conversationService: new ConversationService(
        aiService,
        memoryService,
        agentService
    )
};