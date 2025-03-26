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

type Message = {
    role: "system" | "user" | "assistant";
    content: string;
    timestamp: Date;
};

export class AIService {
    private graphCache: Map<string, EnhancedLangGraph> = new Map();
    private openai: OpenAI;
    private memoryService: AIMemoryService;

    constructor() {
        this.openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });
        this.memoryService = new AIMemoryService();
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
        console.log(`\n=== AIService: Processing message with graph ===`);
        
        const agent = await agentService.getAgentBySlug(agentSlug);
        if (!agent) throw new Error('Agent not found');

        const cacheKey = `${userId}-${agent._id.toString()}`;
        let graph = this.graphCache.get(cacheKey);
        
        if (!graph) {
            console.log(`Creating new graph for ${cacheKey}`);
            graph = await this.getOrCreateGraph(agent._id.toString(), userId, currentNode);
            this.graphCache.set(cacheKey, graph);
        } else {
            console.log(`Using existing graph for ${cacheKey}`);
            graph.updateState({ currentNode });
        }

        const memories = await this.getRelevantMemories(userId, agent._id.toString(), message);
        const conversationHistory = await this.getConversationHistory(userId, agent._id.toString());
        
        const result = await graph.processInput(message, {
            agent,
            userId,
            memories,
            conversationHistory
        });
        
        return result;
    }

    private async getConversationHistory(userId: string, agentId: string): Promise<ChatMessage[]> {
        const conversation = await ConversationModel.findOne({
            userId,
            agentId,
            active: true
        }).sort({ 'messages.timestamp': -1 });

        // Add logging to debug conversation history
        console.log(`Retrieved ${conversation?.messages?.length || 0} messages from conversation history`);
        if (conversation?.messages && conversation.messages.length > 0) {
            const lastIndex = conversation.messages.length - 1;
            console.log(`Last message: ${conversation.messages[lastIndex]?.content || 'No content'}`);
        }

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

    private async getOrCreateGraph(agentId: string, userId: string, currentNode: ConversationNodeType): Promise<EnhancedLangGraph> {
        const cacheKey = `${userId}-${agentId}`;
        
        if (!this.graphCache.has(cacheKey)) {
            console.log(`Creating new graph for ${cacheKey}, starting at node: ${currentNode}`);
            
            // Get conversation from database to initialize with correct state
            const conversation = await Conversation.findOne({
                userId,
                agentId,
                active: true
            });
            
            const agent = await agentService.getAgentById(agentId);
            if (!agent) throw new Error('Agent not found');
            
            // Use existing state from database or create default
            const initialNode = conversation?.currentNode || currentNode;
            
            const graph = new EnhancedLangGraph(agentId, {
                initialNode: initialNode as ConversationNodeType,
                nodes: new Map(),
                edges: new Map(),
                memories: [],
                agent
            });
            
            // If we have existing conversation state, update the graph
            if (conversation?.conversationState) {
                graph.updateState({
                    currentNode: initialNode as ConversationNodeType,
                    hasMetBefore: true,
                    // Add other state properties from conversation.conversationState
                });
            }
            
            this.graphCache.set(cacheKey, graph);
        } else {
            // Update the current node in the existing graph
            const graph = this.graphCache.get(cacheKey)!;
            console.log(`Using cached graph for ${cacheKey}, updating to node: ${currentNode}`);
            
            // Update the graph's current node
            graph.updateState({ currentNode });
        }
        
        return this.graphCache.get(cacheKey)!;
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
        return this.memoryService.getRelevantMemories(userId, agentId, query);
    }
} 
