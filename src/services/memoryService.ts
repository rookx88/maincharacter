import mongoose from 'mongoose';
import { OpenAI } from 'openai';
import { getTimePeriod } from '../utils/timeUtils.js';
import { DateRange, TimePeriod } from '../types/common.js';
import MemoryFragmentModel, { MemoryFragmentDocument } from '../models/memoryFragmentModel.js';
import AIMemoryModel from '../models/aiMemoryModel.js';
import { AIMemory } from '../types/aiMemory.js';
import { logger } from "../utils/logger.js";

// Simplified interface for memory details
interface MemoryDetails {
  title?: string;
  description?: string;
  date?: {
    timestamp?: Date;
    approximateDate?: string;
  };
  location?: {
    name?: string;
  };
  people?: Array<{
    name: string;
    relationship?: string;
  }>;
  emotions?: string[];
  significance?: number;
  themes?: string[];
  tags?: string[];
}

export class MemoryService {
  private openai: OpenAI;

  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
  }

  /**
   * Create memory fragment from user message
   */
  async createMemoryFromMessage(
    userId: string, 
    agentId: string, 
    message: string, 
    conversationId?: string
  ): Promise<MemoryFragmentDocument> {
    logger.info('[MEMORY] Creating memory from message', {
      userId,
      agentId,
      messageExcerpt: message.substring(0, 50) + (message.length > 50 ? '...' : '')
    });

    try {
      // Extract memory details using AI
      const details = await this.extractMemoryDetails(message);
      
      // Create the memory fragment
      const memory = new MemoryFragmentModel({
        title: details.title || "Conversation Memory",
        description: message,
        date: {
          timestamp: new Date(),
          timePeriod: getTimePeriod(new Date())
        },
        location: {
          name: details.location?.name || "Unknown location"
        },
        people: details.people || [],
        tags: details.themes || [],
        context: {
          emotions: details.emotions || ["neutral"],
          significance: details.significance || 3,
          themes: details.themes || ["conversation"]
        },
        system: {
          userId,
          created: new Date(),
          updatedAt: new Date(),
          version: 1
        },
        status: "needs_details",
        missingFields: this.identifyMissingFields(details),
        aiMemoryKey: `${agentId}_${Date.now()}`,
        conversationId: conversationId ? new mongoose.Types.ObjectId(conversationId) : undefined
      });

      // If we have an approximate date, store it in a custom field
      if (details.date?.approximateDate) {
        memory.date = {
          ...memory.date,
          // @ts-ignore - Add approximate date even if not in the type
          approximateDate: details.date.approximateDate
        };
      }

      await memory.save();
      logger.info('[MEMORY] Successfully created memory fragment', { id: memory._id.toString() });
      
      return memory;
    } catch (error) {
      logger.error('[MEMORY] Failed to create memory fragment', error);
      throw new Error('Failed to create memory fragment');
    }
  }

  /**
   * Update memory with additional details
   */
  async updateMemoryWithDetails(
    memoryId: string, 
    additionalDetails: string
  ): Promise<MemoryFragmentDocument | null> {
    logger.info('[MEMORY] Updating memory with additional details', { memoryId });
    
    try {
      // Extract details from additional text
      const details = await this.extractStoryDetails(additionalDetails);
      
      // Find the memory
      const memory = await MemoryFragmentModel.findById(memoryId);
      if (!memory) {
        logger.warn('[MEMORY] Memory not found', { memoryId });
        return null;
      }
      
      // Update fields
      if (details.location?.name) memory.location.name = details.location.name;
      
      // Handle approximate date with ts-ignore to bypass type checking
      if (details.date?.approximateDate) {
        // @ts-ignore - Add approximate date even if not in the type
        memory.date.approximateDate = details.date.approximateDate;
      }
      
      if (details.emotions && details.emotions.length > 0) {
        memory.context.emotions = [...new Set([...memory.context.emotions, ...details.emotions])];
      }
      if (details.people && details.people.length > 0) {
        // Use spread with type assertion to handle potential undefined
        memory.people = [...(memory.people || []), ...details.people];
      }
      if (details.themes && details.themes.length > 0) {
        memory.context.themes = [...new Set([...(memory.context.themes || []), ...details.themes])];
      }
      if (details.tags && details.tags.length > 0) {
        memory.tags = [...new Set([...(memory.tags || []), ...details.tags])];
      }
      
      // Append additional details to description
      memory.description += "\n\nAdditional details: " + additionalDetails;
      
      // Update status if we have enough details
      const missingFields = this.identifyMissingFields(details);
      if (missingFields.length === 0) {
        memory.status = "complete";
        memory.missingFields = [];
      } else {
        memory.missingFields = missingFields;
      }
      
      // Update version and modified date
      memory.system.updatedAt = new Date();
      memory.system.version = (memory.system.version || 1) + 1;
      
      await memory.save();
      logger.info('[MEMORY] Successfully updated memory fragment', { id: memory._id.toString() });
      
      return memory;
    } catch (error) {
      logger.error('[MEMORY] Failed to update memory fragment', error);
      return null;
    }
  }

  /**
   * Get relevant memories for conversation context
   */
  async getRelevantMemories(
    userId: string, 
    agentId: string, 
    message: string,
    limit: number = 5
  ): Promise<MemoryFragmentDocument[]> {
    logger.info('[MEMORY] Getting relevant memories', { userId, agentId });
    
    try {
      // Extract key themes from message
      const themes = await this.extractThemes(message);
      
      // Find memories with matching themes
      const memories = await MemoryFragmentModel.find({
        "system.userId": userId,
        $or: [
          { tags: { $in: themes } },
          { "context.themes": { $in: themes } }
        ]
      })
      .sort({ "context.significance": -1 })
      .limit(limit);
      
      logger.info('[MEMORY] Found relevant memories', { count: memories.length });
      return memories;
    } catch (error) {
      logger.error('[MEMORY] Failed to get relevant memories', error);
      return [];
    }
  }

  /**
   * Search memories by AIMemory model (compatibility)
   */
  async searchMemories(
    userId: string, 
    agentId: string, 
    query: string,
    limit: number = 5
  ): Promise<AIMemory[]> {
    logger.info('[MEMORY] Searching AI memories', { userId, agentId });
    
    try {
      // Get memories from AIMemoryModel
      const memories = await AIMemoryModel.find({
        userId,
        agentId
      })
      .sort({ significance: -1 })
      .limit(limit);
      
      logger.info('[MEMORY] Found AI memories', { count: memories.length });
      return memories;
    } catch (error) {
      logger.error('[MEMORY] Failed to search AI memories', error);
      return [];
    }
  }

  /**
   * Get memories in a specific timeframe
   */
  async getMemoriesInTimeframe(
    userId: string, 
    timeframe: DateRange
  ): Promise<MemoryFragmentDocument[]> {
    return MemoryFragmentModel.find({
      'system.userId': userId,
      'date.timestamp': {
        $gte: timeframe.from,
        $lte: timeframe.to
      }
    });
  }

  /**
   * Create an AIMemory record (compatibility)
   */
  async createMemory(memoryData: {
    userId: string;
    agentId: string;
    content: string;
    source: string;
    type: string;
    metadata: any;
    importance: number;
    createdAt: Date;
  }): Promise<AIMemory> {
    try {
      const memory = new AIMemoryModel({
        userId: memoryData.userId,
        agentId: memoryData.agentId,
        content: memoryData.content,
        type: memoryData.type || 'general',
        significance: memoryData.importance / 10 || 0.5,
        timestamp: memoryData.createdAt || new Date(),
        lastAccessed: new Date()
      });
      
      await memory.save();
      return memory;
    } catch (error) {
      logger.error('[MEMORY] Failed to create AI memory', error);
      throw error;
    }
  }

  /**
   * Analyze a memory for significance
   */
  async analyzeMemorySignificance(content: string): Promise<number> {
    try {
      const prompt = `On a scale of 0 to 1, how significant is this memory in terms of personal importance and emotional impact:
      "${content}"
      
      Respond with a single number between 0 and 1.`;
      
      const response = await this.openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: 10
      });
      
      const significanceText = response.choices[0].message.content || "0.5";
      const significance = parseFloat(significanceText.trim());
      
      return isNaN(significance) ? 0.5 : Math.max(0, Math.min(1, significance));
    } catch (error) {
      logger.error('[MEMORY] Failed to analyze memory significance', error);
      return 0.5;
    }
  }

  /**
   * Extract memory details using OpenAI
   */
  private async extractMemoryDetails(text: string): Promise<MemoryDetails> {
    const prompt = `Extract key details from this personal story:
      "${text}"
      
      Return a JSON object with these fields:
      - title: A short, descriptive title for this memory
      - date: { 
          approximateDate: A text description of when it happened (e.g., "Summer of 2019", "Early 90s")
        }
      - location: { 
          name: Where this happened 
        }
      - people: Array of objects with {name, relationship} for people mentioned
      - emotions: Array of emotions expressed or implied
      - significance: A number from 1-5 indicating how significant this memory seems
      - themes: Array of themes present in the story
      
      Only include fields if they can be reasonably inferred from the text.`;
    
    try {
      const completion = await this.openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        response_format: { type: "json_object" }
      });
      
      const content = completion.choices[0].message.content;
      if (!content) return {};
      
      try {
        return JSON.parse(content) as MemoryDetails;
      } catch (e) {
        logger.error('[MEMORY] Failed to parse memory details', e);
        return {};
      }
    } catch (error) {
      logger.error('[MEMORY] OpenAI extraction failed', error);
      return {};
    }
  }

  /**
   * Extract additional story details
   */
  private async extractStoryDetails(text: string): Promise<MemoryDetails> {
    // Similar to extractMemoryDetails but focused on additional details
    return this.extractMemoryDetails(text);
  }

  /**
   * Extract themes from text
   */
  private async extractThemes(text: string): Promise<string[]> {
    const prompt = `Extract 3-5 key themes or topics from this text. Return ONLY a JSON array of theme words or short phrases:
      "${text}"
      
      Example response format:
      ["theme1", "theme2", "theme3"]`;
    
    try {
      const completion = await this.openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        response_format: { type: "json_object" }
      });
      
      const content = completion.choices[0].message.content;
      if (!content) return [];
      
      try {
        // The response might be a JSON object containing the array, or directly an array
        const parsed = JSON.parse(content);
        return Array.isArray(parsed) ? parsed : (parsed.themes || []);
      } catch (e) {
        logger.error('[MEMORY] Failed to parse themes', e);
        return [];
      }
    } catch (error) {
      logger.error('[MEMORY] Theme extraction failed', error);
      return [];
    }
  }

  /**
   * Identify missing fields in memory details
   */
  private identifyMissingFields(details: MemoryDetails): string[] {
    const missingFields: string[] = [];
    
    if (!details.date?.approximateDate) missingFields.push("date");
    if (!details.location?.name) missingFields.push("location");
    if (!details.people || details.people.length === 0) missingFields.push("people");
    
    return missingFields;
  }
}

export default new MemoryService();