import { ConversationCheckpoint } from '../utils/conversationCheckpoints.js';
import { AIMemory } from '../types/aiMemory.js';
import { ChatMessage } from '../types/conversation.js';
import { OpenAIEmbeddings } from '@langchain/openai';
import { similarity } from '../utils/vectorUtils.js';
import AIMemoryModel from '../models/aiMemoryModel.js';
import Conversation from '../models/conversationModel.js';
import { OpenAI } from 'openai';
import MemoryModel from '../models/memoryModel.js';

export class AIMemoryService {
    private embeddings = new OpenAIEmbeddings();
    private openai: OpenAI;

    constructor() {
        this.openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });
    }

    async getCheckpointMemories(
        userId: string,
        agentId: string,
        checkpoint: ConversationCheckpoint,
        currentMessage: string
    ): Promise<{
        relevantMemories: AIMemory[];
        recentContext: ChatMessage[];
        significance: number;
    }> {
        // Get message embedding for similarity comparison
        const messageEmbedding = await this.embeddings.embedQuery(currentMessage);

        // Get memories based on checkpoint requirements
        const memories = await this.getMemoriesByCheckpoint(
            userId,
            agentId,
            checkpoint
        );

        // Calculate memory relevance
        const scoredMemories = await this.scoreMemories(
            memories,
            messageEmbedding
        );

        // Get recent conversation context
        const recentContext = await this.getRecentContext(userId, agentId);

        // Calculate overall significance for checkpoint progression
        const significance = this.calculateSignificance(
            scoredMemories,
            checkpoint
        );

        return {
            relevantMemories: scoredMemories
                .sort((a, b) => b.score - a.score)
                .slice(0, 3)
                .map(m => m.memory),
            recentContext,
            significance
        };
    }

    private async getMemoriesByCheckpoint(
        userId: string,
        agentId: string,
        checkpoint: ConversationCheckpoint
    ): Promise<AIMemory[]> {
        const baseQuery = {
            userId,
            agentId,
            significance: { $gt: 0.5 }
        };

        switch (checkpoint) {
            case ConversationCheckpoint.STORY_DISCOVERY:
                return await AIMemoryModel.find({
                    ...baseQuery,
                    type: 'story_element',
                    significance: { $gt: 0.7 }
                }).sort({ timestamp: -1 }).limit(5);

            case ConversationCheckpoint.DEEPENING:
                return await AIMemoryModel.find({
                    ...baseQuery,
                    type: 'significant_moment',
                    significance: { $gt: 0.8 }
                }).sort({ significance: -1 }).limit(3);

            case ConversationCheckpoint.REVEAL_PREP:
                return await AIMemoryModel.find({
                    ...baseQuery,
                    type: ['story_element', 'significant_moment'],
                    significance: { $gt: 0.9 }
                }).sort({ significance: -1 }).limit(2);

            default:
                return await AIMemoryModel.find(baseQuery)
                    .sort({ timestamp: -1 })
                    .limit(3);
        }
    }

    private async scoreMemories(
        memories: AIMemory[],
        messageEmbedding: number[]
    ): Promise<Array<{ memory: AIMemory; score: number }>> {
        const memoryEmbeddings = await Promise.all(
            memories.map(memory => 
                this.embeddings.embedQuery(memory.content)
            )
        );

        return memories.map((memory, index) => ({
            memory,
            score: similarity(messageEmbedding, memoryEmbeddings[index])
        }));
    }

    private async getRecentContext(
        userId: string,
        agentId: string
    ): Promise<ChatMessage[]> {
        const conversation = await Conversation.findOne(
            { userId, agentId, active: true },
            { messages: { $slice: -5 } }
        );

        return conversation?.messages || [];
    }

    private calculateSignificance(
        scoredMemories: Array<{ memory: AIMemory; score: number }>,
        checkpoint: ConversationCheckpoint
    ): number {
        const averageScore = scoredMemories.reduce(
            (acc, { score }) => acc + score, 0
        ) / scoredMemories.length;

        const checkpointMultipliers: Record<ConversationCheckpoint, number> = {
            [ConversationCheckpoint.ENTRY]: 1.0,
            [ConversationCheckpoint.FIRST_MEETING]: 1.0,
            [ConversationCheckpoint.RETURNING]: 1.0,
            [ConversationCheckpoint.STORY_DISCOVERY]: 1.2,
            [ConversationCheckpoint.DEEPENING]: 1.5,
            [ConversationCheckpoint.REVEAL_PREP]: 2.0,
            [ConversationCheckpoint.REVEAL]: 1.0,
            [ConversationCheckpoint.ACTIVITY]: 1.0
        };

        return Math.min(1.0, averageScore * (checkpointMultipliers[checkpoint]));
    }

    async createMemoryFromMessage(
        message: string,
        userId: string,
        agentId: string,
        checkpoint: ConversationCheckpoint
    ): Promise<AIMemory> {
        const significance = await this.analyzeSignificance(message);
        
        return await AIMemoryModel.create({
            userId,
            agentId,
            content: message,
            type: this.getMemoryType(checkpoint),
            significance,
            timestamp: new Date()
        });
    }

    private async analyzeSignificance(message: string): Promise<number> {
        // Implement significance analysis using LLM
        // For now, return a placeholder
        return 0.7;
    }

    private getMemoryType(checkpoint: ConversationCheckpoint): string {
        switch (checkpoint) {
            case ConversationCheckpoint.STORY_DISCOVERY:
                return 'story_element';
            case ConversationCheckpoint.DEEPENING:
                return 'significant_moment';
            default:
                return 'general';
        }
    }

    async storeMemory(memory: AIMemory) {
        return await AIMemoryModel.create(memory);
    }

    async getRelevantMemories(
        userId: string,
        agentId: string,
        message: string,
        limit: number = 5
    ): Promise<AIMemory[]> {
        try {
            // Get most significant memories first
            const memories = await MemoryModel.find({
                userId,
                agentId
            })
            .sort({ significance: -1 })
            .limit(limit);

            if (!memories.length) return [];

            // Return most significant memories
            return memories as unknown as AIMemory[];

        } catch (error) {
            console.error('Error getting relevant memories:', error);
            return [];
        }
    }

    async updateLastAccessed(memoryId: string) {
        await AIMemoryModel.findByIdAndUpdate(memoryId, {
            lastAccessed: new Date()
        });
    }

    async cleanupOldMemories(userId: string, agentId: string, maxAge = 30) {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - maxAge);

        await AIMemoryModel.deleteMany({
            userId,
            agentId,
            lastAccessed: { $lt: cutoff },
            significance: { $lt: 0.7 } // Keep highly significant memories
        });
    }

    async createFromConversation(conversation: any) {
        // Implement conversation to memory logic
        console.log('Creating memory from conversation:', conversation);
        // TODO: Implement actual memory creation
        return null;
    }
} 