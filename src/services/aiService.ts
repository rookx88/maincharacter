import { OpenAI } from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { AIAgent } from '../types/agent.js';
import { ChatMessage } from '../types/conversation.js';
import { logger } from '../utils/logger.js';

export class AIService {
  private openai: OpenAI;

  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
  }

  /**
   * Generate AI response based on given context
   */
  async generateResponse(
    prompt: string,
    context: {
      userMessage: string;
      agent: AIAgent;
      conversationHistory?: ChatMessage[];
    }
  ): Promise<string> {
    logger.info('[AI] Generating response', {
      agent: context.agent.name,
      messageExcerpt: context.userMessage.substring(0, 50) + (context.userMessage.length > 50 ? '...' : '')
    });

    try {
      // Create system message with agent's persona
      const systemPrompt = `You are ${context.agent.name}, a ${context.agent.category} professional.
Your personality: ${context.agent.traits?.core?.join(', ') || 'friendly and helpful'}
Your speaking style: ${context.agent.style?.speaking?.join(', ') || 'natural and engaging'}

${prompt}

Stay in character as ${context.agent.name} at all times. Be natural and conversational.`;
      
      // Build conversation history for context
      const messages: ChatCompletionMessageParam[] = [
        { role: "system", content: systemPrompt }
      ];
      
      // Add up to 10 recent messages from conversation history if available
      if (context.conversationHistory && context.conversationHistory.length > 0) {
        const recentHistory = context.conversationHistory.slice(-10);
        recentHistory.forEach(msg => {
          if (msg.role === 'user' || msg.role === 'assistant' || msg.role === 'system') {
            messages.push({
              role: msg.role,
              content: msg.content
            });
          }
        });
      }
      
      // Add the current user message
      messages.push({ role: "user", content: context.userMessage });
      
      // Generate response
      const completion = await this.openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages,
        temperature: context.agent.temperature || 0.7,
        max_tokens: 500
      });
      
      const response = completion.choices[0].message.content || "I'm not sure how to respond to that.";
      logger.info('[AI] Generated response', {
        responseExcerpt: response.substring(0, 50) + (response.length > 50 ? '...' : '')
      });
      
      return response;
    } catch (error) {
      logger.error('[AI] Failed to generate response', error);
      return "I'm having trouble processing that right now. Can we try something else?";
    }
  }

  /**
   * Analyze message significance
   */
  async analyzeSignificance(message: string): Promise<number> {
    logger.info('[AI] Analyzing message significance');
    
    try {
      const prompt = `On a scale of 0 to 1, how significant is this message in terms of personal information or memorable content:
        "${message}"
        
        Respond with a single number between 0 and 1, with no other text.`;
      
      const messages: ChatCompletionMessageParam[] = [
        { role: "user", content: prompt }
      ];
      
      const completion = await this.openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages,
        temperature: 0.1,
        max_tokens: 10
      });
      
      const result = completion.choices[0].message.content || "0.5";
      const significance = parseFloat(result);
      
      logger.info('[AI] Significance analysis complete', { significance });
      return isNaN(significance) ? 0.5 : significance;
    } catch (error) {
      logger.error('[AI] Failed to analyze significance', error);
      return 0.5;
    }
  }

  /**
   * Detect emotions in a message
   */
  async detectEmotions(message: string): Promise<string[]> {
    logger.info('[AI] Detecting emotions');
    
    try {
      const prompt = `Identify the top 3 emotions expressed in this message. Return only a comma-separated list of emotion words:
        "${message}"`;
      
      const messages: ChatCompletionMessageParam[] = [
        { role: "user", content: prompt }
      ];
      
      const completion = await this.openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages,
        temperature: 0.3,
        max_tokens: 50
      });
      
      const content = completion.choices[0].message.content || "neutral";
      const emotions = content.split(',').map(e => e.trim()).filter(Boolean);
      
      return emotions.length > 0 ? emotions : ["neutral"];
    } catch (error) {
      logger.error('[AI] Failed to detect emotions', error);
      return ["neutral"];
    }
  }

  /**
   * Extract key themes from a message
   */
  async extractThemes(message: string): Promise<string[]> {
    logger.info('[AI] Extracting themes');
    
    try {
      const prompt = `Extract 3-5 key themes or topics from this text. Return only a comma-separated list of theme words or short phrases:
        "${message}"`;
      
      const messages: ChatCompletionMessageParam[] = [
        { role: "user", content: prompt }
      ];
      
      const completion = await this.openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages,
        temperature: 0.3,
        max_tokens: 100
      });
      
      const content = completion.choices[0].message.content || "";
      const themes = content.split(',').map(t => t.trim()).filter(Boolean);
      
      return themes;
    } catch (error) {
      logger.error('[AI] Theme extraction failed', error);
      return [];
    }
  }

  /**
   * Generate a memory title based on content
   */
  async generateMemoryTitle(content: string): Promise<string> {
    logger.info('[AI] Generating memory title');
    
    try {
      const prompt = `Create a short, descriptive title (5-8 words) for this memory:
        "${content}"
        
        Return just the title, nothing else.`;
      
      const messages: ChatCompletionMessageParam[] = [
        { role: "user", content: prompt }
      ];
      
      const completion = await this.openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages,
        temperature: 0.7,
        max_tokens: 20
      });
      
      const title = completion.choices[0].message.content?.trim() || "Memory";
      logger.info('[AI] Generated title', { title });
      
      return title;
    } catch (error) {
      logger.error('[AI] Failed to generate title', error);
      return "Memory";
    }
  }

  /**
   * Generate suggested responses for the user
   */
  async generateSuggestedResponses(
    message: string,
    context: {
      agent: AIAgent;
      conversationStage: string;
    },
    count: number = 3
  ): Promise<string[]> {
    logger.info('[AI] Generating suggested responses', { 
      conversationStage: context.conversationStage 
    });
    
    try {
      const prompt = `You are speaking with ${context.agent.name}, a ${context.agent.category}.
      They just said: "${message}"
      
      Generate ${count} natural, conversational responses a user might say in reply.
      The current context is: ${context.conversationStage}
      
      Format as a JSON array of strings, with each response being 1-10 words. 
      Make responses varied in tone and content.`;
      
      const messages: ChatCompletionMessageParam[] = [
        { role: "user", content: prompt }
      ];
      
      const completion = await this.openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages,
        temperature: 0.8,
        max_tokens: 150,
        response_format: { type: "json_object" }
      });
      
      const content = completion.choices[0].message.content;
      if (!content) return [];
      
      try {
        const parsed = JSON.parse(content);
        return Array.isArray(parsed) ? parsed : (parsed.responses || []);
      } catch (e) {
        logger.error('[AI] Failed to parse suggested responses', e);
        return [];
      }
    } catch (error) {
      logger.error('[AI] Failed to generate suggested responses', error);
      return [];
    }
  }
}

export default new AIService();