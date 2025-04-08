// src/services/conversationService.ts
import { IntroductionStage, ConversationNodeType, ChatMessage } from '../types/conversation.js';
import Conversation, { IConversationDocument } from '../models/conversationModel.js';
import { AIService } from './aiService.js';
import { MemoryService } from './memoryService.js';
import { AgentService } from './agentService.js';
import { AIAgent } from '../types/agent.js';
import { logger } from '../utils/logger.js';
import mongoose from 'mongoose';
import agentConfigs from '../config/agentConfigs.js';

// Define the narrative state interface to match what's in the database
interface NarrativeState {
  hasCompletedIntroduction: boolean;
  relationshipStage: 'stranger' | 'acquaintance' | 'friend';
  knownTopics: string[];
  sharedStories: string[];
  lastInteractionTimestamp: Date;
  agentSpecificState: Record<string, any>;
  // Add custom properties with proper type annotations
  introStage?: IntroductionStage;
  stageRepeatCount?: number;
  memoryDetails?: {
    fragmentId?: string;
    content?: string;
  };
}

export class ConversationService {
  constructor(
    private aiService: AIService,
    private memoryService: MemoryService,
    private agentService: AgentService
  ) {}

  /**
   * Get or create a conversation
   */
  async getOrCreateConversation(
    userId: string, 
    agentSlug: string
  ): Promise<{ 
    conversation: IConversationDocument; 
    isNew: boolean; 
  }> {
    logger.info('[CONVERSATION] Getting or creating conversation', { userId, agentSlug });
    
    try {
      // Look for existing ACTIVE conversation
      const existing = await Conversation.findOne({
        userId,
        agentSlug,
        active: true
      });
      
      if (existing) {
        // If we have an existing conversation with completed intro and in casual conversation node,
        // mark it inactive and create a new one
        if (
          existing.narrativeState?.hasCompletedIntroduction && 
          existing.currentNode === ConversationNodeType.CASUAL_CONVERSATION
        ) {
          logger.info('[CONVERSATION] Found completed conversation, creating new one', { 
            existingId: existing._id instanceof mongoose.Types.ObjectId ? 
              existing._id.toString() : 
              String(existing._id)
          });
          
          // Mark it inactive
          existing.active = false;
          await existing.save();
          
          // Create a new conversation
          return this.createNewConversation(userId, agentSlug);
        }
        
        logger.info('[CONVERSATION] Found existing conversation', { 
          id: existing._id instanceof mongoose.Types.ObjectId ? 
            existing._id.toString() : 
            String(existing._id)
        });
        return { conversation: existing, isNew: false };
      }
      
      // Create a new conversation if none exists
      return this.createNewConversation(userId, agentSlug);
    } catch (error) {
      logger.error('[CONVERSATION] Failed to get or create conversation', error);
      throw error;
    }
  }

  /**
   * Helper method to create a new conversation
   */
  private async createNewConversation(
    userId: string, 
    agentSlug: string
  ): Promise<{ 
    conversation: IConversationDocument; 
    isNew: boolean; 
  }> {
    // Get the agent
    const agent = await this.agentService.getAgentBySlug(agentSlug);
    if (!agent) {
      logger.error('[CONVERSATION] Agent not found', { agentSlug });
      throw new Error('Agent not found');
    }
    
    // Create initial state
    const narrativeState = {
      hasCompletedIntroduction: false,
      relationshipStage: 'stranger',
      knownTopics: [],
      sharedStories: [],
      lastInteractionTimestamp: new Date(),
      agentSpecificState: {},
      introStage: IntroductionStage.INITIAL_GREETING
    };
    
    // Create a greeting message
    const initialMessage = this.getInitialMessage(agent);
    
    // Create new conversation
    const conversation = await Conversation.create({
      userId,
      agentId: agent._id.toString(),
      agentSlug,
      currentNode: ConversationNodeType.ENTRY,
      narrativeState,
      messages: [{
        role: 'assistant',
        content: initialMessage,
        timestamp: new Date()
      }],
      active: true
    });
    
    logger.info('[CONVERSATION] Created new conversation', { 
      id: conversation._id instanceof mongoose.Types.ObjectId ? 
        conversation._id.toString() : 
        String(conversation._id),
      initialMessage: initialMessage.substring(0, 50) + '...'
    });
    
    return { conversation, isNew: true };
  }

  /**
   * Process user message
   */
  async processMessage(
    userId: string, 
    agentSlug: string, 
    message: string
  ): Promise<{
    response: string;
    nextNode: ConversationNodeType;
    metadata?: {
      conversationEnded?: boolean;
      suggestedResponses?: string[];
      memoryFragmentId?: string;
    };
  }> {
    logger.info('[CONVERSATION] Processing message', { 
      userId, 
      agentSlug,
      messagePreview: message.substring(0, 50) + (message.length > 50 ? '...' : '')
    });
    
    try {
      // Get conversation
      let { conversation, isNew } = await this.getOrCreateConversation(userId, agentSlug);
      
      // Get agent
      const agent = await this.agentService.getAgentBySlug(agentSlug);
      if (!agent) {
        throw new Error('Agent not found');
      }
      
      // Process message based on state
      const result = await this.processMessageBasedOnState(
        message,
        conversation,
        agent
      );
      
      // Save message and response
      await this.saveMessageAndResponse(
        conversation._id instanceof mongoose.Types.ObjectId ? 
          conversation._id.toString() : 
          String(conversation._id),
        message,
        result.response,
        result.nextNode,
        result.metadata
      );
      
      logger.info('[CONVERSATION] Processed message', {
        responsePreview: result.response.substring(0, 50) + (result.response.length > 50 ? '...' : ''),
        nextNode: result.nextNode,
        hasCompletedIntro: conversation.narrativeState?.hasCompletedIntroduction,
        conversationEnded: result.metadata?.conversationEnded
      });
      
      return result;
    } catch (error) {
      logger.error('[CONVERSATION] Failed to process message', error);
      throw error;
    }
  }

  /**
   * Process message based on conversation state
   */
  private async processMessageBasedOnState(
    message: string,
    conversation: IConversationDocument,
    agent: AIAgent
  ): Promise<{
    response: string;
    nextNode: ConversationNodeType;
    metadata?: {
      conversationEnded?: boolean;
      suggestedResponses?: string[];
      memoryFragmentId?: string;
    };
  }> {
    // Get current state - use type assertion to access properties
    const narrativeState = conversation.narrativeState as unknown as NarrativeState;
    const currentNode = conversation.currentNode as ConversationNodeType; 
    
    // Add this debug log to see what stages are being used
    console.log("Current narrative state:", { 
      hasCompletedIntro: narrativeState.hasCompletedIntroduction, 
      currentStage: narrativeState.introStage, 
      relationship: narrativeState.relationshipStage,
      currentNode
    });
    
    // Handle based on introduction completion
    if (!narrativeState.hasCompletedIntroduction) {
      return this.handleIntroductionFlow(
        message, 
        conversation,
        agent
      );
    } else {
      return this.handleRegularConversation(
        message,
        conversation,
        agent
      );
    }
  }

  /**
   * Handle introduction flow
   */
  private async handleIntroductionFlow(
    message: string,
    conversation: IConversationDocument,
    agent: AIAgent
  ): Promise<{
    response: string;
    nextNode: ConversationNodeType;
    metadata?: {
      conversationEnded?: boolean;
      suggestedResponses?: string[];
      memoryFragmentId?: string;
    };
  }> {
    // Use type assertion to access narrativeState properties
    const narrativeState = conversation.narrativeState as unknown as NarrativeState;
    
    // Get current stage
    const currentStage = narrativeState.introStage || IntroductionStage.INITIAL_GREETING;
    
    logger.info('[CONVERSATION] Processing introduction flow', {
      currentStage,
      agent: agent.slug
    });
    
    // Special handling for the final stage - CHECK FIRST if user has responded positively to the ESTABLISH_RELATIONSHIP stage
    if (currentStage === IntroductionStage.ESTABLISH_RELATIONSHIP && 
        this.isPositiveResponseFinal(message)) {
      
      logger.info('[CONVERSATION] Detected positive response at final stage - completing introduction');
      
      // Mark introduction as complete
      narrativeState.hasCompletedIntroduction = true;
      narrativeState.relationshipStage = 'acquaintance';
      
      // Save the updated state
      await Conversation.findByIdAndUpdate(
        conversation._id,
        { 
          $set: { 
            "narrativeState.hasCompletedIntroduction": true,
            "narrativeState.relationshipStage": "acquaintance"
          } 
        }
      );
      
      // Log completion
      const completeCheck = await Conversation.findById(conversation._id);
      console.log("After completing introduction, stored value:", 
        JSON.stringify(completeCheck?.narrativeState, null, 2));
      
      // Get the farewell message
      const farewell = this.getFarewellMessage(agent);
      
      // Return final response with conversationEnded flag
      return {
        response: farewell,
        nextNode: ConversationNodeType.CASUAL_CONVERSATION,
        metadata: {
          conversationEnded: true
        }
      };
    }
    
    // Check if we should advance to next stage
    if (this.shouldAdvanceStage(message, currentStage, agent.slug)) {
      // Get next stage
      const nextStage = this.getNextStage(currentStage);
      
      logger.info('[CONVERSATION] Advancing to next stage', {
        currentStage,
        nextStage
      });
      
      // Log the state before update
      console.log(`Before state update: ${narrativeState.introStage}`);
      
      // Memory creation at appropriate stages
      let memoryFragmentId: string | undefined = undefined;
      
      if (currentStage === IntroductionStage.FIRST_FRAGMENT) {
        try {
          const memoryFragment = await this.memoryService.createMemoryFromMessage(
            conversation.userId,
            conversation.agentId,
            message,
            conversation._id instanceof mongoose.Types.ObjectId ? 
                conversation._id.toString() : 
                String(conversation._id)
          );
          
          memoryFragmentId = memoryFragment._id.toString();
          
          // Store memoryId in narrative state
          if (!narrativeState.memoryDetails) {
            narrativeState.memoryDetails = {};
          }
          narrativeState.memoryDetails.fragmentId = memoryFragmentId;
          narrativeState.memoryDetails.content = message;
          
          logger.info('[CONVERSATION] Created memory fragment', { memoryFragmentId });
        } catch (error) {
          logger.error('[CONVERSATION] Failed to create memory fragment', error);
        }
      }
      
      // Update additional details to existing memory at FOLLOW_UP stage
      if (currentStage === IntroductionStage.FOLLOW_UP && 
          narrativeState.memoryDetails?.fragmentId) {
        try {
          await this.memoryService.updateMemoryWithDetails(
            narrativeState.memoryDetails.fragmentId,
            message
          );
          logger.info('[CONVERSATION] Updated memory with additional details', { 
            memoryId: narrativeState.memoryDetails.fragmentId 
          });
        } catch (error) {
          logger.error('[CONVERSATION] Failed to update memory with details', error);
        }
      }
      
      // Update stage in narrative state
      narrativeState.introStage = nextStage;
      narrativeState.stageRepeatCount = 0;
      
      // Save updated state - use $set operator to update the field directly
      // Convert enum to string to ensure proper storage
      const result = await Conversation.findByIdAndUpdate(
        conversation._id,
        { 
          $set: { 
            "narrativeState.introStage": nextStage.toString(), 
            "narrativeState.stageRepeatCount": 0 
          } 
        },
        { new: true }
      );
      
      // Add direct check of what was saved
      const checkDoc = await Conversation.findById(conversation._id);
      console.log("After DB update, stored value:", JSON.stringify(checkDoc?.narrativeState, null, 2));
      
      // Log the state after update
      console.log(`After state update: ${nextStage}`);
      
      // Return response for next stage
      return {
        response: this.getIntroStageResponse(agent, nextStage),
        nextNode: ConversationNodeType.ENTRY,
        metadata: {
          suggestedResponses: this.getSuggestedResponses(nextStage, agent.slug)
        }
      };
    } else {
      // If not advancing, increment repeat count
      narrativeState.stageRepeatCount = (narrativeState.stageRepeatCount || 0) + 1;
      
      // Save updated state - use $set operator to update the field directly
      // Ensure we store the stage as well to prevent issues
      const updateResult = await Conversation.findByIdAndUpdate(
        conversation._id,
        { 
          $set: { 
            "narrativeState.stageRepeatCount": narrativeState.stageRepeatCount,
            // Make sure the introStage is properly set in case it got lost
            "narrativeState.introStage": currentStage.toString()
          } 
        },
        { new: true }
      );
      
      // Check what was actually stored
      const checkDoc = await Conversation.findById(conversation._id);
      console.log("After repeat count update, stored value:", JSON.stringify(checkDoc?.narrativeState, null, 2));
      
      // Get follow-up prompt
      const followUp = this.generateFollowUp(message, currentStage, agent.slug);
      
      return {
        response: followUp || this.getIntroStageResponse(agent, currentStage),
        nextNode: ConversationNodeType.ENTRY,
        metadata: {
          suggestedResponses: this.getSuggestedResponses(currentStage, agent.slug)
        }
      };
    }
  }

  /**
   * Handle regular conversation
   */
  private async handleRegularConversation(
    message: string,
    conversation: IConversationDocument,
    agent: AIAgent
  ): Promise<{
    response: string;
    nextNode: ConversationNodeType;
    metadata?: {
      suggestedResponses?: string[];
      memoryFragmentId?: string;
    };
  }> {
    logger.info('[CONVERSATION] Processing regular conversation');
    
    try {
      // Get relevant memories for context
      const relevantMemories = await this.getRelevantMemories(
        conversation.userId,
        conversation.agentId,
        message
      );
      
      // Create a prompt with memory context
      const memoryContext = relevantMemories.length > 0 
        ? `\n\nYou may reference these relevant memories if appropriate:\n${relevantMemories.map(m => `- ${m.content}`).join('\n')}`
        : '';
      
      const prompt = `Respond naturally to the user's message. You're having a casual conversation.${memoryContext}`;
      
      // Generate response using AI
      const aiResponse = await this.aiService.generateResponse(prompt, {
        userMessage: message,
        agent,
        conversationHistory: conversation.messages
      });
      
      // Check for significance and create memory if needed
      const significance = await this.aiService.analyzeSignificance(message);
      
      let memoryFragmentId: string | undefined = undefined;
      
      if (significance > 0.7 && this.assessStoryQuality(message)) {
        try {
          const memoryFragment = await this.memoryService.createMemoryFromMessage(
            conversation.userId,
            conversation.agentId,
            message,
            conversation._id instanceof mongoose.Types.ObjectId ? 
                conversation._id.toString() : 
                String(conversation._id)
          );
          
          memoryFragmentId = memoryFragment._id.toString();
          logger.info('[CONVERSATION] Created memory fragment from significant message', { 
            memoryFragmentId,
            significance 
          });
        } catch (error) {
          logger.error('[CONVERSATION] Failed to create memory fragment', error);
        }
      }
      
      // Generate suggested responses
      const suggestedResponses = await this.aiService.generateSuggestedResponses(
        aiResponse,
        {
          agent,
          conversationStage: 'casual_conversation'
        }
      );
      
      return {
        response: aiResponse,
        nextNode: ConversationNodeType.CASUAL_CONVERSATION,
        metadata: {
          suggestedResponses,
          memoryFragmentId
        }
      };
    } catch (error) {
      logger.error('[CONVERSATION] Error in regular conversation handling', error);
      return {
        response: "I'm sorry, I'm having trouble processing that. Can we try a different topic?",
        nextNode: ConversationNodeType.CASUAL_CONVERSATION
      };
    }
  }

  /**
   * Save message and response to conversation
   */
  private async saveMessageAndResponse(
    conversationId: string,
    message: string,
    response: string,
    nextNode: ConversationNodeType,
    metadata?: any
  ): Promise<void> {
    await Conversation.findByIdAndUpdate(
      conversationId,
      {
        $push: {
          messages: [
            {
              role: 'user',
              content: message,
              timestamp: new Date()
            },
            {
              role: 'assistant',
              content: response,
              timestamp: new Date()
            }
          ]
        },
        $set: {
          currentNode: nextNode,
          updatedAt: new Date()
        }
      }
    );
  }

  /**
   * Get relevant memories for conversation context
   */
  private async getRelevantMemories(
    userId: string,
    agentId: string,
    message: string
  ): Promise<any[]> {
    try {
      return await this.memoryService.getRelevantMemories(userId, agentId, message);
    } catch (error) {
      logger.error('[CONVERSATION] Failed to get relevant memories', error);
      return [];
    }
  }

  /**
   * Assess if a message contains a quality story worth remembering
   */
  private assessStoryQuality(message: string): boolean {
    // Check if the story has sufficient detail
    const minLength = 30;
    const hasTimeIndicator = /\b(when|during|after|before|while|year|month|day|time|ago|past)\b/i.test(message);
    const hasEventDescription = /\b(happen|experience|witness|see|saw|remember|recall|event)\b/i.test(message);
    
    return message.length >= minLength && (hasTimeIndicator || hasEventDescription);
  }

  /**
   * Get agent's initial greeting message
   */
  private getInitialMessage(agent: AIAgent): string {
    // Try to get from agent configs
    const config = agentConfigs[agent.slug];
    
    if (config?.introduction?.[IntroductionStage.INITIAL_GREETING]?.message) {
      return config.introduction[IntroductionStage.INITIAL_GREETING].message;
    }
    
    // Fallback to default greeting
    return `Oh! Hi there! I'm ${agent.name}, a ${agent.category} professional. It's nice to meet you!`;
  }

  /**
   * Get agent's farewell message
   */
  private getFarewellMessage(agent: AIAgent): string {
    // Try to get from agent configs
    const config = agentConfigs[agent.slug];
    
    if (config?.casualResponses?.farewells && config.casualResponses.farewells.length > 0) {
      // Randomly select a farewell
      const randomIndex = Math.floor(Math.random() * config.casualResponses.farewells.length);
      return config.casualResponses.farewells[randomIndex];
    }
    
    // Fallback farewell
    return `I really appreciate your help today! I need to run now and get ready for the show. Hope to catch up with you again soon!`;
  }

  /**
   * Get agent's response for a specific introduction stage
   */
  private getIntroStageResponse(agent: AIAgent, stage: IntroductionStage): string {
    // Try to get from agent configs
    const config = agentConfigs[agent.slug];
    
    if (config?.introduction?.[stage]?.message) {
      return config.introduction[stage].message;
    }
    
    // Fallback responses based on stage
    switch (stage) {
      case IntroductionStage.INITIAL_GREETING:
        return `Hi there! I'm ${agent.name}. It's nice to meet you!`;
      case IntroductionStage.ESTABLISH_SCENARIO:
        return `I'm working on something interesting right now.`;
      case IntroductionStage.SEEK_HELP:
        return `I could use some help with something. Would you be willing to share a story with me?`;
      case IntroductionStage.FIRST_FRAGMENT:
        return `That's interesting! Could you tell me more about that?`;
      case IntroductionStage.FOLLOW_UP:
        return `Tell me more about when and where this happened.`;
      case IntroductionStage.EXPRESS_GRATITUDE:
        return `Thank you so much for sharing that with me!`;
      case IntroductionStage.ESTABLISH_RELATIONSHIP:
        return `I'd love to chat with you again sometime!`;
      default:
        return `I'm enjoying our conversation!`;
    }
  }

  /**
   * Get suggested responses for a specific stage
   */
  private getSuggestedResponses(stage: IntroductionStage, agentSlug: string): string[] {
    // Try to get from agent configs
    const config = agentConfigs[agentSlug];
    
    if (config?.introduction?.[stage]?.suggestedResponses) {
      return config.introduction[stage].suggestedResponses || [];
    }
    
    // Fallback suggested responses
    switch (stage) {
      case IntroductionStage.ESTABLISH_SCENARIO:
        return [
          "That sounds interesting!",
          "How can I help?",
          "Tell me more about it"
        ];
      case IntroductionStage.SEEK_HELP:
        return [
          "Sure, I'd be happy to help",
          "What kind of help do you need?",
          "I'll try my best to help"
        ];
      case IntroductionStage.EXPRESS_GRATITUDE:
        return [
          "You're welcome!",
          "Happy to share",
          "No problem at all"
        ];
      case IntroductionStage.ESTABLISH_RELATIONSHIP:
        return [
          "I'd like that",
          "Sounds good",
          "Looking forward to it"
        ];
      default:
        return [];
    }
  }

  /**
   * Check if we should advance to the next introduction stage
   */
  private shouldAdvanceStage(message: string, currentStage: IntroductionStage, agentSlug: string): boolean {
    logger.info('[CONVERSATION] Checking if should advance stage', { 
      currentStage, 
      messagePreview: message.substring(0, 30) + '...',
      agent: agentSlug
    });
    
    // If current stage is ESTABLISH_RELATIONSHIP, don't advance
    if (currentStage === IntroductionStage.ESTABLISH_RELATIONSHIP) {
      return false;
    }
    
    // For INITIAL_GREETING, check for a name
    if (currentStage === IntroductionStage.INITIAL_GREETING) {
      return true; // For simplicity, always advance from initial greeting
    }
    
    // For SEEK_HELP, check for agreement
    if (currentStage === IntroductionStage.SEEK_HELP) {
      const isAgreement = this.isPositiveResponse(message);
      return isAgreement;
    }
    
    // For FIRST_FRAGMENT, check if the response is substantial
    if (currentStage === IntroductionStage.FIRST_FRAGMENT) {
      return message.length > 30;
    }
    
    // For FOLLOW_UP, check if the response contains details
    if (currentStage === IntroductionStage.FOLLOW_UP) {
      return message.length > 10;
    }
    
    // For all other stages, advance automatically
    return true;
  }

  /**
   * Get the next introduction stage
   */
  private getNextStage(currentStage: IntroductionStage): IntroductionStage {
    const stageProgression = {
      [IntroductionStage.INITIAL_GREETING]: IntroductionStage.ESTABLISH_SCENARIO,
      [IntroductionStage.ESTABLISH_SCENARIO]: IntroductionStage.SEEK_HELP,
      [IntroductionStage.SEEK_HELP]: IntroductionStage.FIRST_FRAGMENT,
      [IntroductionStage.FIRST_FRAGMENT]: IntroductionStage.FOLLOW_UP,
      [IntroductionStage.FOLLOW_UP]: IntroductionStage.EXPRESS_GRATITUDE,
      [IntroductionStage.EXPRESS_GRATITUDE]: IntroductionStage.ESTABLISH_RELATIONSHIP,
      [IntroductionStage.ESTABLISH_RELATIONSHIP]: IntroductionStage.ESTABLISH_RELATIONSHIP
    };
    
    return stageProgression[currentStage] || IntroductionStage.ESTABLISH_RELATIONSHIP;
  }

  /**
   * Generate a follow-up prompt for the current stage
   */
  private generateFollowUp(message: string, stage: IntroductionStage, agentSlug: string): string | null {
    const isNegative = this.isNegativeResponse(message);
    
    // Try to get from agent configs
    const config = agentConfigs[agentSlug];
    
    if (config?.followUps?.[stage]) {
      const followUps = isNegative ? 
        config.followUps[stage].negative : 
        config.followUps[stage].positive;
      
      if (followUps && followUps.length > 0) {
        // Randomly select a follow-up
        const randomIndex = Math.floor(Math.random() * followUps.length);
        return followUps[randomIndex];
      }
    }
    
    // Fallback follow-ups
    if (stage === IntroductionStage.SEEK_HELP && isNegative) {
      return "That's okay. Maybe you could just share a brief story about something interesting that happened to you?";
    }
    
    if (stage === IntroductionStage.FIRST_FRAGMENT && isNegative) {
      return "Even a small story would be helpful. Maybe something that happened recently?";
    }
    
    return null;
  }

  /**
   * Check if the response is negative
   */
  private isNegativeResponse(message: string): boolean {
    const lowerMessage = message.toLowerCase();
    
    const negativePatterns = [
      /\b(no|nope|not really|don't|cant|can't|won't|wouldn't|not|never)\b/i,
      /\b(sorry|too personal|private|rather not|don't want to)\b/i
    ];
    
    return negativePatterns.some(pattern => pattern.test(lowerMessage));
  }

  /**
   * Check if the response is positive
   */
  private isPositiveResponse(message: string): boolean {
    const lowerMessage = message.toLowerCase();
    
    const positivePatterns = [
      /\b(yes|yeah|yep|sure|ok|okay|of course|certainly|absolutely|definitely)\b/i,
      /\b(happy to|glad to|i'd love to|i would|i will|i can|i'd be|love to)\b/i
    ];
    
    return positivePatterns.some(pattern => pattern.test(lowerMessage));
  }

  /**
   * Enhanced positive response detection specifically for the final stage
   * Includes more patterns like "I'd like that" which wasn't in the original method
   */
  private isPositiveResponseFinal(message: string): boolean {
    const lowerMessage = message.toLowerCase();
    
    // Add patterns specifically for the final stage response
    const finalPositivePatterns = [
      /\b(yes|yeah|yep|sure|ok|okay|of course|certainly|absolutely|definitely)\b/i,
      /\b(happy to|glad to|i'd love to|i would|i will|i can|i'd be|love to)\b/i,
      /\b(i'd like that|sounds good|looking forward|great|awesome|fantastic)\b/i,
      /\b(count me in|lets do it|let's do it|id be happy|i'd be happy)\b/i
    ];
    
    logger.info('[CONVERSATION] Checking final stage response patterns', { message: lowerMessage });
    
    return finalPositivePatterns.some(pattern => {
      const matches = pattern.test(lowerMessage);
      if (matches) {
        logger.info('[CONVERSATION] Matched positive pattern', { pattern: pattern.toString() });
      }
      return matches;
    });
  }

  /**
   * Update existing memory with additional details
   */
  private async updateExistingMemory(
    memoryId: string,
    additionalDetails: string
  ): Promise<void> {
    try {
      await this.memoryService.updateMemoryWithDetails(memoryId, additionalDetails);
      logger.info('[CONVERSATION] Updated memory with additional details', { memoryId });
    } catch (error) {
      logger.error('[CONVERSATION] Failed to update memory', error);
    }
  }
}

// Create instance with dependency injection
const aiService = new AIService();
const memoryService = new MemoryService();
const agentService = new AgentService();
export default new ConversationService(aiService, memoryService, agentService);