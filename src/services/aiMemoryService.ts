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

    // Refactored method to match the newer interface pattern
    async createMemoryFromMessage(
        userId: string,
        agentId: string,
        message: string,
        conversationId?: string
    ): Promise<AIMemory> {
        // Determine the memory type/significance
        const significance = await this.analyzeSignificance(message);
        
        // Create a memory object
        return await AIMemoryModel.create({
            userId,
            agentId,
            content: message,
            type: this.getMemoryType(message),
            significance,
            timestamp: new Date(),
            lastAccessed: new Date(),
            conversationId
        });
    }

    // Make analyze significance public so it can be used by adapters
    public async analyzeSignificance(message: string): Promise<number> {
        // Implement significance analysis using LLM
        try {
            const prompt = `On a scale of 0 to 1, how significant is this message in terms of personal information or memorable content:
                "${message}"
                
                Respond with a single number between 0 and 1, with no other text.`;
            
            const completion = await this.openai.chat.completions.create({
                model: "gpt-3.5-turbo",
                messages: [{ role: "user", content: prompt }],
                temperature: 0.1,
                max_tokens: 10
            });
            
            const result = completion.choices[0].message.content || "0.5";
            const significance = parseFloat(result.trim());
            
            return isNaN(significance) ? 0.5 : Math.min(Math.max(significance, 0), 1);
        } catch (error) {
            console.error('Error analyzing significance:', error);
            return 0.5;
        }
    }

    // Helper method to determine memory type based on content
    private getMemoryType(message: string): string {
        // Simple logic to determine memory type
        if (message.length > 200) {
            return 'significant_moment';
        } else if (message.includes('remember') || message.includes('recall')) {
            return 'story_element';
        } else {
            return 'general';
        }
    }

    async getRelevantMemories(
        userId: string,
        agentId: string,
        message: string,
        limit: number = 5
    ): Promise<AIMemory[]> {
        try {
            // Get message embedding for similarity comparison
            const messageEmbedding = await this.embeddings.embedQuery(message);

            // Get memories
            const memories = await AIMemoryModel.find({
                userId,
                agentId
            }).sort({ significance: -1 }).limit(limit * 2);  // Get extra to filter by relevance

            if (memories.length === 0) return [];

            // Score memories by relevance
            const scoredMemories = await this.scoreMemoriesByRelevance(memories, messageEmbedding);

            // Return most relevant memories
            return scoredMemories
                .sort((a, b) => b.score - a.score)
                .slice(0, limit)
                .map(item => item.memory);
        } catch (error) {
            console.error('Error getting relevant memories:', error);
            return [];
        }
    }

    // Helper to score memories by relevance
    private async scoreMemoriesByRelevance(
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
            score: similarity(messageEmbedding, memoryEmbeddings[index]) * memory.significance
        }));
    }

    async updateMemoryWithDetails(
        memoryId: string,
        additionalDetails: string
    ): Promise<AIMemory | null> {
        try {
            const memory = await AIMemoryModel.findById(memoryId);
            if (!memory) return null;

            // Add additional details
            memory.content += "\n\nAdditional details: " + additionalDetails;
            
            // Recalculate significance with additional details
            const newSignificance = await this.analyzeSignificance(memory.content);
            memory.significance = Math.max(memory.significance, newSignificance);
            
            // Update last accessed timestamp
            memory.lastAccessed = new Date();
            
            await memory.save();
            return memory;
        } catch (error) {
            console.error('Error updating memory:', error);
            return null;
        }
    }

    async searchMemories(
        userId: string,
        agentId: string,
        query: string,
        limit: number = 5
    ): Promise<AIMemory[]> {
        // For simple implementation, we'll reuse getRelevantMemories
        return this.getRelevantMemories(userId, agentId, query, limit);
    }

    async getMemoriesInTimeframe(
        userId: string,
        timeframe: { from: Date, to: Date }
    ): Promise<AIMemory[]> {
        try {
            return await AIMemoryModel.find({
                userId,
                timestamp: {
                    $gte: timeframe.from,
                    $lte: timeframe.to
                }
            }).sort({ timestamp: -1 });
        } catch (error) {
            console.error('Error getting memories in timeframe:', error);
            return [];
        }
    }

    async createFromConversation(conversation: any): Promise<AIMemory | null> {
        try {
            // Extract relevant information from conversation
            const userId = conversation.userId;
            const agentId = conversation.agentId;
            
            // Get the last user message
            const messages = conversation.messages || [];
            const lastUserMessage = messages
                .filter((m: { role: string; content: string }) => m.role === 'user')
                .reverse()[0]?.content;
                
            if (!lastUserMessage) {
                console.warn('No user messages found in conversation');
                return null;
            }
            
            // Create memory from the last user message
            return this.createMemoryFromMessage(
                userId, 
                agentId, 
                lastUserMessage,
                conversation._id?.toString()
            );
        } catch (error) {
            console.error('Error creating memory from conversation:', error);
            return null;
        }
    }

    // Additional helper methods for compatibility with existing code can be added here
}

export default new AIMemoryService();