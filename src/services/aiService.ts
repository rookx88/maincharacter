import ConversationModel from '../models/conversationModel.js';
import { ConversationError } from '../utils/conversationError.js';

import { ChatMessage } from '../types/conversation.js';
import { TimePeriod } from '../types/common.js';
import { OpenAI } from 'openai';
import { AIAgent } from '../types/agent.js';
import Conversation from '../models/conversationModel.js';
import { AIMemory } from '../types/aiMemory.js';
import { agentService } from './agentService.js';
import { EnhancedLangGraph, EnhancedLangGraphConfig } from '../utils/enhancedLangGraph.js';
import { AIMemoryService } from './aiMemoryService.js';
import { ConversationCheckpoint } from '../utils/conversationCheckpoints.js';
import { AgentType, ConversationState, ConversationNodeType } from '../types/conversation.js';
import mongoose from 'mongoose';
import { ConversationNode } from '../types/conversation.js';
import AgentModel from '../models/agentModel.js';
import { MemoryService } from './memoryService.js';
import { logger } from '../utils/logger.js';

type Message = {
    role: "system" | "user" | "assistant";
    content: string;
    timestamp: Date;
};

export class AIService {
    private graphCache: Map<string, EnhancedLangGraph> = new Map();
    private openai: OpenAI;
    private memoryService: MemoryService;

    constructor() {
        this.openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });
        this.memoryService = new MemoryService();
    }

    async getOrCreateGraph(
        agentId: string, 
        userId: string, 
        currentNode: ConversationNodeType
    ): Promise<EnhancedLangGraph> {
        const cacheKey = `${userId}-${agentId}`;
        
        if (!this.graphCache.has(cacheKey)) {
            // Get conversation from database to initialize with correct state
            const conversation = await Conversation.findOne({
                userId,
                agentId,
                active: true
            });
            
            const agent = await agentService.getAgentById(agentId);
            if (!agent) throw new Error('Agent not found');
            
            // Use existing state from database or create default
            // IMPORTANT: For new conversations, always start with ENTRY node
            const initialNode = conversation?.currentNode || ConversationNodeType.ENTRY;
            
            logger.info(`[GRAPH] Creating new graph`, {
                userId,
                agentId,
                initialNode,
                isExistingConversation: !!conversation
            });
            
            const graph = new EnhancedLangGraph(agentId, {
                initialNode: initialNode as ConversationNodeType,
                nodes: new Map(),
                edges: new Map(),
                memories: [],
                agent,
                conversation
            });
            
            this.graphCache.set(cacheKey, graph);
        }
        
        return this.graphCache.get(cacheKey)!;
    }

    async processMessageWithGraph(
        userId: string,
        message: string,
        agentSlug: string,
        currentNode: ConversationNodeType
    ): Promise<{
        response: string;
        nextNode: ConversationNodeType;
        updatedState: ConversationState;
        metadata?: { conversationEnded?: boolean };
    }> {
        logger.info(`[API] Processing message with graph`, {
            userId,
            agentSlug,
            currentNode,
            messagePreview: message.substring(0, 50) + (message.length > 50 ? '...' : '')
        });

        const agent = await agentService.getAgentBySlug(agentSlug);
        if (!agent) throw new Error('Agent not found');

        // Get or create the graph
        const graph = await this.getOrCreateGraph(agent._id.toString(), userId, currentNode);
        
        // Get conversation history once
        const conversationHistory = await this.getConversationHistory(userId, agent._id.toString());
        
        // Get relevant memories once
        const memories = await this.getRelevantMemories(userId, agent._id.toString(), message);
        
        // Process the input with all context in one call
        const result = await graph.processInput(message, {
            agent,
            userId,
            memories,
            conversationHistory,
            currentNode
        });
        
        logger.info(`[API] Graph processing result`, {
            nextNode: result.nextNode,
            responsePreview: result.response.substring(0, 50) + (result.response.length > 50 ? '...' : ''),
            metadata: result.metadata
        });
        
        return result;
    }

    async getConversationHistory(userId: string, agentId: string): Promise<ChatMessage[]> {
        const conversation = await ConversationModel.findOne({
            userId,
            agentId,
            active: true
        }).sort({ 'messages.timestamp': -1 });
        
        return conversation?.messages || [];
    }

    private async loadProfile(agentId: string): Promise<AIAgent> {
        const agent = await agentService.getAgentById(agentId);
        if (!agent) throw new Error('Agent not found');
        return agent;
    }

    private constructSystemMessage(profile: AIAgent, context: Message[]): string {
        const isFirstEncounter = context.length === 0;
        
        return `You are ${profile.name}. ${profile.bio[0]}

${isFirstEncounter ? 'This is your first conversation with this user.' : 'Continue the existing conversation naturally.'}

Your personality traits are: ${profile.traits?.core?.join(', ') || 'friendly and helpful'}`;
    }

    async getUserConversations(userId: string) {
        try {
            const conversations = await ConversationModel.find({ 
                userId: userId 
            }).sort({ 
                'messages.timestamp': 1
            });

            if (!conversations) {
                return [];
            }

            return conversations.map(conv => ({
                _id: conv._id,
                agentSlug: conv.agentSlug,
                messages: conv.messages.map(msg => ({
                    content: msg.content,
                    timestamp: msg.timestamp,
                    role: msg.role
                }))
            }));
        } catch (error) {
            console.error('Error fetching user conversations:', error);
            throw new ConversationError('Failed to fetch conversations', 500);
        }
    }

    async findBySlug(slug: string) {
        return agentService.getAgentBySlug(slug);
    }

    async getAgentProfile(agentId: string) {
        return await agentService.getAgentById(agentId);
    }

    async getConversationContext(userId: string, agentId: string): Promise<Message[]> {
        try {
            // Get previous messages from the database
            const conversation = await ConversationModel.findOne({
                userId,
                agentId,
                active: true
            }).sort({ 'messages.timestamp': -1 });

            console.log('Retrieved conversation context:', {
                userId,
                agentId,
                hasConversation: !!conversation,
                messageCount: conversation?.messages?.length || 0
            });

            return conversation?.messages || [];
        } catch (error) {
            console.error('Error getting conversation context:', error);
            return [];
        }
    }

    async chat(agentId: string, userId: string, message: string) {
        console.log("AIService processing:", { agentId, userId, message });
        
        const agent = await this.loadProfile(agentId);
        if (!agent) throw new Error('Agent not found');

        return await this.processMessageWithGraph(
            userId,
            message,
            agent.slug,
            ConversationNodeType.ENTRY
        );
    }

    public async getRelevantMemories(userId: string, agentId: string, query: string): Promise<AIMemory[]> {
        return this.memoryService.searchMemories(userId, agentId, query);
    }
} 
