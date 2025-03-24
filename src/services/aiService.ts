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

interface AIProfileResponse {
    _id: string;
    name: string;
    bio: string[];
    systemPrompt: string;
    category: string;
    memories: Array<{
        content: string;
        timestamp: Date;
        significance: number;
        timePeriod: TimePeriod;
        yearEstimate: number;
    }>;
}

interface AgentPersonality {
    systemPrompt: string;
    traits: string[];
    style: string;
    checkpointPrompts: Record<ConversationCheckpoint, string>;
}

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
    ) {
        const agent = await agentService.getAgentBySlug(agentSlug);
        if (!agent) throw new Error('Agent not found');

        const graph = await this.getOrCreateGraph(agent._id.toString(), {
            initialNode: currentNode,
            nodes: new Map(),
            edges: new Map(),
            memories: [],
            agent
        });

        const result = await graph.processInput(message, {
            agent,
            userId,
            memories: await this.memoryService.getRelevantMemories(userId, agent._id.toString(), message),
            conversationHistory: await this.getConversationHistory(userId, agent._id.toString())
        });

        return result;
    }

    private async getConversationHistory(userId: string, agentId: string): Promise<ChatMessage[]> {
        const conversation = await ConversationModel.findOne({
            userId,
            agentId,
            active: true
        }).sort({ 'messages.timestamp': -1 })
        .limit(10);

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

    private async generateResponse(
        message: string, 
        agent: AIAgent, 
        context: { recentMessages: ChatMessage[]; relevantMemories: AIMemory[] }
    ): Promise<string> {
        const prompt = this.constructPrompt(message, agent, context);

        const completion = await this.openai.chat.completions.create({
            model: agent.model,
            messages: [{ role: "user", content: prompt }],
            temperature: agent.temperature,
            presence_penalty: agent.presence_penalty,
            frequency_penalty: 0.5
        });

        return completion.choices[0]?.message?.content || "I'm not sure how to respond to that.";
    }

    private constructPrompt(message: string, agent: AIAgent, context: { recentMessages: ChatMessage[]; relevantMemories: AIMemory[] }): string {
        return `You are ${agent.name}. ${agent.bio?.[0] || ''}\n\n` +
            `User message: ${message}\n\n` +
            `Respond in character as ${agent.name}.`;
    }

    private createGraphFromAgent(agent: AIAgent): EnhancedLangGraph {
        const graph = new EnhancedLangGraph(agent._id.toString() || 'default', {
            initialNode: ConversationNodeType.ENTRY,
            nodes: new Map(),
            edges: new Map(),
            memories: []
        });

        // Add basic conversation flow nodes
        graph.addNode({
            id: ConversationNodeType.ENTRY,
            nodeType: 'greeting',
            content: "Welcome! How can I help you today?",
            responses: ["Nice to meet you!"],
            nextNodes: [ConversationNodeType.FIRST_MEETING],
            handler: async (_message, state, _context) => ({
                response: "Welcome! How can I help you today?",
                nextNode: ConversationNodeType.FIRST_MEETING,
                updatedState: state
            })
        });

        return graph;
    }

    private async fetchConversationMemories(
        userId: string,
        agentId: string
    ): Promise<AIMemory[]> {
        // Implement memory retrieval logic
        return []; // Placeholder
    }

    private getAgentPersonality(agent: AIAgent): AgentPersonality {
        switch(this.determineAgentType(agent)) {
            case AgentType.PODCAST_HOST:
                return {
                    systemPrompt: `You are Alex Rivers, an engaging podcast host known for discovering unique stories. 
                        ${agent.bio[0]}
                        Your personality is warm, curious, and encouraging.`,
                    traits: ['curious', 'engaging', 'empathetic'],
                    style: 'conversational and engaging',
                    checkpointPrompts: {
                        [ConversationCheckpoint.ENTRY]: "Welcome! I'm excited to meet new people and hear their stories.",
                        [ConversationCheckpoint.FIRST_MEETING]: "Let's get to know each other! What brings you here today?",
                        [ConversationCheckpoint.RETURNING]: "Great to see you again! What's been happening in your world?",
                        [ConversationCheckpoint.STORY_DISCOVERY]: "As a podcast host, I'm genuinely interested in people's stories. Tell me more!",
                        [ConversationCheckpoint.DEEPENING]: "That's fascinating! Let's explore that further.",
                        [ConversationCheckpoint.REVEAL_PREP]: "Your story has such interesting elements.",
                        [ConversationCheckpoint.REVEAL]: "I think this would make for an amazing podcast episode.",
                        [ConversationCheckpoint.ACTIVITY]: "Let's plan out how we could share your story."
                    }
                };
            case AgentType.CHEF:
                return {
                    systemPrompt: `You are Chef Isabella, a passionate culinary expert who loves discovering people's food stories. 
                        ${agent.bio[0]}
                        Your personality is passionate, encouraging, and detail-oriented.`,
                    traits: ['passionate', 'knowledgeable', 'encouraging'],
                    style: 'warm and enthusiastic',
                    checkpointPrompts: {
                        [ConversationCheckpoint.ENTRY]: "Welcome! I'm excited to meet new people and hear their stories.",
                        [ConversationCheckpoint.FIRST_MEETING]: "Let's get to know each other! What brings you here today?",
                        [ConversationCheckpoint.RETURNING]: "Great to see you again! What's been happening in your world?",
                        [ConversationCheckpoint.STORY_DISCOVERY]: "As a chef, explore their food experiences and preferences with genuine interest.",
                        [ConversationCheckpoint.DEEPENING]: "You've found an interesting food connection. Explore their culinary journey.",
                        [ConversationCheckpoint.REVEAL_PREP]: "Their food story has potential. Begin hinting at personalized cooking experiences.",
                        [ConversationCheckpoint.REVEAL]: "I think this would make for an amazing food podcast episode.",
                        [ConversationCheckpoint.ACTIVITY]: "Let's plan out how we could share their food story."
                    }
                };
            case AgentType.STYLIST:
                return {
                    systemPrompt: `You are Morgan Chase, a stylish and fashionable stylist known for her impeccable taste and style. 
                        ${agent.bio[0]}
                        Your personality is confident, fashionable, and detail-oriented.`,
                    traits: ['confident', 'fashionable', 'detail-oriented'],
                    style: 'confident and fashionable',
                    checkpointPrompts: {
                        [ConversationCheckpoint.ENTRY]: "Welcome! I'm excited to meet new people and hear their stories.",
                        [ConversationCheckpoint.FIRST_MEETING]: "Let's get to know each other! What brings you here today?",
                        [ConversationCheckpoint.RETURNING]: "Great to see you again! What's been happening in your world?",
                        [ConversationCheckpoint.STORY_DISCOVERY]: "As a stylist, you're genuinely interested in people's style stories. Ask engaging follow-up questions.",
                        [ConversationCheckpoint.DEEPENING]: "You've identified an interesting style element. Dive deeper with thoughtful questions.",
                        [ConversationCheckpoint.REVEAL_PREP]: "Their style story has potential. Start subtly steering towards style relevance.",
                        [ConversationCheckpoint.REVEAL]: "I think this would make for an amazing style podcast episode.",
                        [ConversationCheckpoint.ACTIVITY]: "Let's plan out how we could share their style story."
                    }
                };
            default:
                throw new Error(`Unsupported agent type: ${agent.slug}`);
        }
    }

    private createContextualPrompt(
        personality: AgentPersonality,
        checkpoint: ConversationCheckpoint,
        context: {
            relevantMemories: AIMemory[];
            recentContext: ChatMessage[];
        }
    ): string {
        const memoryContext = context.relevantMemories
            .map(m => `Previous relevant interaction: ${m.content}`)
            .join('\n');

        return `${personality.systemPrompt}

Current Conversation Phase: ${checkpoint}
${personality.checkpointPrompts[checkpoint]}

Style Guide:
- Maintain ${personality.style} communication style
- Embody traits: ${personality.traits.join(', ')}

Context:
${memoryContext}

Recent Conversation:
${context.recentContext.map(m => `${m.role}: ${m.content}`).join('\n')}`;
    }

    private determineAgentType(agent: AIAgent): AgentType {
        const typeMap: { [key: string]: AgentType } = {
            'alex-rivers': AgentType.PODCAST_HOST,
            'chef-isabella': AgentType.CHEF,
            'morgan-chase': AgentType.STYLIST
        };

        const agentType = typeMap[agent.slug];
        if (!agentType) {
            throw new Error(`Unknown agent type for slug: ${agent.slug}`);
        }

        return agentType;
    }

    private async getConversationState(
        userId: string,
        agentId: string
    ): Promise<ConversationState> {
        const conversation = await Conversation.findOne({
            userId,
            agentId,
            active: true
        });

        if (!conversation?.conversationState) {
            return {
                currentNode: ConversationNodeType.ENTRY,
                hasMetBefore: false,
                engagementLevel: 0,
                revealMade: false,
                userAcceptedActivity: false,
                lastInteractionDate: new Date()
            };
        }

        return conversation.conversationState;
    }

    private async updateConversationState(
        userId: string,
        agentId: string,
        state: ConversationState,
        checkpoint: ConversationCheckpoint
    ): Promise<void> {
        await Conversation.findOneAndUpdate(
            {
                userId,
                agentId,
                active: true
            },
            {
                $set: {
                    conversationState: state,
                    currentNode: checkpoint
                }
            },
            { upsert: true }
        );
    }

    private nodeToCheckpoint(node: ConversationNodeType): ConversationCheckpoint {
        const mapping: Record<ConversationNodeType, ConversationCheckpoint> = {
            [ConversationNodeType.ENTRY]: ConversationCheckpoint.ENTRY,
            [ConversationNodeType.FIRST_MEETING]: ConversationCheckpoint.FIRST_MEETING,
            [ConversationNodeType.CASUAL_CONVERSATION]: ConversationCheckpoint.STORY_DISCOVERY,
            [ConversationNodeType.REVEAL_OPPORTUNITY]: ConversationCheckpoint.REVEAL,
            [ConversationNodeType.MINI_GAME]: ConversationCheckpoint.ACTIVITY
        };
        return mapping[node];
    }

    private async getOrCreateGraph(agentId: string, config: EnhancedLangGraphConfig): Promise<EnhancedLangGraph> {
        if (!this.graphCache.has(agentId)) {
            const graph = new EnhancedLangGraph(agentId, config);
            this.graphCache.set(agentId, graph);
        }
        return this.graphCache.get(agentId)!;
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
} 
