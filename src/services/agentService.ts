// src/services/agentService.ts
import { AIAgent } from '../types/agent.js';
import AgentModel from '../models/agentModel.js';
import { logger } from '../utils/logger.js';
import mongoose from 'mongoose';

export class AgentService {
  /**
   * Get an agent by slug
   */
  async getAgentBySlug(slug: string): Promise<AIAgent | null> {
    logger.info('[AGENT] Getting agent by slug', { slug });
    
    try {
      const agent = await AgentModel.findOne({ slug }).lean();
      
      if (!agent) {
        logger.warn('[AGENT] Agent not found', { slug });
        return null;
      }
      
      logger.info('[AGENT] Found agent', { name: agent.name });
      
      // Create a new object with explicit properties and correct nesting
      const aiAgent = this.createAIAgentFromDocument(agent);
      
      return aiAgent;
    } catch (error) {
      logger.error('[AGENT] Failed to get agent by slug', error);
      return null;
    }
  }

  /**
   * Get an agent by ID
   */
  async getAgentById(id: string): Promise<AIAgent | null> {
    logger.info('[AGENT] Getting agent by ID', { id });
    
    try {
      const agent = await AgentModel.findById(id).lean();
      
      if (!agent) {
        logger.warn('[AGENT] Agent not found', { id });
        return null;
      }
      
      logger.info('[AGENT] Found agent', { name: agent.name });
      
      // Create a new object with explicit properties and correct nesting
      const aiAgent = this.createAIAgentFromDocument(agent);
      
      return aiAgent;
    } catch (error) {
      logger.error('[AGENT] Failed to get agent by ID', error);
      return null;
    }
  }

  /**
   * List all agent profiles
   */
  async listProfiles(): Promise<AIAgent[]> {
    logger.info('[AGENT] Listing all agent profiles');
    
    try {
      const agents = await AgentModel.find({}).lean();
      
      logger.info('[AGENT] Found agents', { count: agents.length });
      
      // Map each agent to an AIAgent with explicit properties
      return agents.map(agent => this.createAIAgentFromDocument(agent));
    } catch (error) {
      logger.error('[AGENT] Failed to list profiles', error);
      return [];
    }
  }

  /**
   * Helper method to create an AIAgent from a document
   */
  private createAIAgentFromDocument(doc: any): AIAgent {
    // Create default nested objects
    const defaultTraits = {
      core: [] as string[],
      personality: [] as string[],
      adaptive: {
        warmth: 0.5,
        creativity: 0.5,
        enthusiasm: 0.5,
        empathy: 0.5,
        formality: 0.5,
        observation: 0.5,
        curiosity: 0.5,
        adaptability: 0.5,
        expressiveness: 0.5
      }
    };
    
    const defaultStyle = {
      speaking: [] as string[],
      patterns: [] as string[],
      tone: [] as string[],
      greeting: ""
    };
    
    const defaultExpertise = {
      topics: [] as string[],
      specialties: [] as string[]
    };
    
    // Handle optional nesting by checking each level
    const traits = {
      core: doc.traits?.core || defaultTraits.core,
      personality: doc.traits?.personality || defaultTraits.personality,
      adaptive: {
        warmth: doc.traits?.adaptive?.warmth ?? defaultTraits.adaptive.warmth,
        creativity: doc.traits?.adaptive?.creativity ?? defaultTraits.adaptive.creativity,
        enthusiasm: doc.traits?.adaptive?.enthusiasm ?? defaultTraits.adaptive.enthusiasm,
        empathy: doc.traits?.adaptive?.empathy ?? defaultTraits.adaptive.empathy,
        formality: doc.traits?.adaptive?.formality ?? defaultTraits.adaptive.formality,
        observation: doc.traits?.adaptive?.observation ?? defaultTraits.adaptive.observation,
        curiosity: doc.traits?.adaptive?.curiosity ?? defaultTraits.adaptive.curiosity,
        adaptability: doc.traits?.adaptive?.adaptability ?? defaultTraits.adaptive.adaptability,
        expressiveness: doc.traits?.adaptive?.expressiveness ?? defaultTraits.adaptive.expressiveness
      }
    };
    
    const style = {
      speaking: doc.style?.speaking || defaultStyle.speaking,
      patterns: doc.style?.patterns || defaultStyle.patterns,
      tone: doc.style?.tone || defaultStyle.tone,
      greeting: doc.style?.greeting || defaultStyle.greeting
    };
    
    const expertise = {
      topics: doc.expertise?.topics || defaultExpertise.topics,
      specialties: doc.expertise?.specialties || defaultExpertise.specialties
    };
    
    // Create the AIAgent object with all required properties
    return {
      _id: doc._id,
      name: doc.name || "",
      slug: doc.slug || "",
      category: doc.category || "",
      description: doc.description || "",
      bio: doc.bio || [],
      systemPrompt: doc.systemPrompt || "",
      traits: traits,
      style: style,
      expertise: expertise,
      interests: doc.interests || [],
      model: "gpt-3.5-turbo",
      temperature: 0.7,
      presence_penalty: 0.6,
      frequency_penalty: 0.3
    } as AIAgent;
  }
  // Add to AgentService class
// Add to AgentService class in src/services/agentService.ts
async getAgentIdentity(slug: string): Promise<any> {
  logger.info('[AGENT] Getting agent identity by slug', { slug });
  
  try {
    const agent = await this.getAgentBySlug(slug);
    
    if (!agent) {
      logger.warn('[AGENT] Agent identity not found', { slug });
      return null;
    }
    
    // Return a simpler version with just the needed fields
    return {
      id: agent._id,
      name: agent.name,
      slug: agent.slug,
      category: agent.category,
      description: agent.description
    };
  } catch (error) {
    logger.error('[AGENT] Failed to get agent identity', error);
    return null;
  }
}
}

export default new AgentService();