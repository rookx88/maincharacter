import Conversation from '../models/conversationModel.js';
import MemoryFragment from '../models/memoryFragmentModel.js';
import { MemoryService } from './memoryService.js';
import { parseDate, extractPeople, detectMissingFields } from '../utils/memoryUtils.js';
import { getTimePeriod } from '../utils/timeUtils.js';
import { AIMemoryService } from './aiMemoryService.js';
import { AIService } from './aiService.js';
import AgentModel from '../models/agentModel.js';
import { AIAgent } from '../types/agent.js';

import { ConversationNodeType } from '../types/conversation.js';
import { agentService } from './agentService.js';
import { OpenAI } from 'openai';
import { IntroductionStage } from '../types/conversation.js';


const memoryService = new MemoryService();

interface RawMemoryInput {
  content: string;
  source: string;
  userId: string;
  metadata: {
    agent: string;
  };
}

async function saveConversationMemory(conversation: any) {
  const lastMessages = conversation.messages.slice(-3); // Get context
  
  const rawInput: RawMemoryInput = {
    content: lastMessages.map((m: { content: string }) => m.content).join('\n'),
    source: 'conversation',
    userId: conversation.userId,
    metadata: {
      agent: conversation.agentId.toString()
    }
  };

  await memoryService.createFromRawInput(rawInput);
}

async function handleMemoryCompletion(
  userId: string, 
  memoryId: string,
  response: string
) {
  const memory = await MemoryFragment.findById(memoryId);
  if (!memory) throw new Error('Memory not found');
  
  const field = memory.missingFields?.[0];
  if (!field) throw new Error('No missing fields to complete');
  
  // Update based on field type
  switch(field) {
    case 'date':
      const parsedDate = parseDate(response);
      memory.date = {
        timestamp: parsedDate,
        timePeriod: getTimePeriod(parsedDate)
      };
      break;
    case 'people':
      memory.people.push(...extractPeople(response));
      break;
  }
  
  // Re-check completeness
  const newMissing = detectMissingFields(memory);
  memory.status = newMissing.length ? 'needs_details' : 'complete';
  memory.missingFields = newMissing;
  
  await memory.save();
}

export class ConversationService {
    constructor(
        private aiService: AIService,
        private memoryService: AIMemoryService
    ) {}

    async processMessage(userId: string, message: string, agentSlug: string) {
        console.log(`\n=== ConversationService: Starting Message Processing ===`);
        console.log(`User: ${userId} | Agent: ${agentSlug}`);
        console.log(`User message: "${message}"`);
        
        // Get the current conversation
        const conversation = await this.getActiveConversation(userId, agentSlug);
        if (!conversation) {
            throw new Error('No active conversation found');
        }
        
        console.log(`Current conversation node: ${conversation.currentNode}`);
        
        // Get narrative state for logging
        console.log(`Narrative state: ${JSON.stringify(conversation.narrativeState)}`);
        
        // Process the message with the AI service
        const result = await this.aiService.processMessageWithGraph(
            userId,
            message,
            agentSlug,
            conversation.currentNode as ConversationNodeType
        );
        
        console.log('AI service result:', {
            response: result.response,
            nextNode: result.nextNode,
            metadata: result.metadata
        });
        
        // Save the message and response to the conversation
        await this.saveMessageAndResponse(
            userId,
            conversation.agentId.toString(),
            message,
            result.response,
            result.nextNode
        );
        
        // Return the AI's response and metadata
        return {
            response: result.response,
            metadata: result.metadata
        };
    }

    async startConversation(userId: string, agentId: string, agentSlug: string) {
        try {
            // For testing: Delete any existing conversations with this agent
            await Conversation.deleteMany({
                userId,
                agentId
            });
            
            console.log(`Deleted existing conversations for testing purposes - User: ${userId}, Agent: ${agentId}`);
            
            // Create a new conversation
            const agent = await agentService.getAgentById(agentId);
            if (!agent) throw new Error('Agent not found');
            
            // Always use the first-time user flow for testing
            const initialMessage = this.getFirstEncounterMessage(agent);
            console.log(`Created initial narrative message: "${initialMessage}"`);
            
            // Create conversation with initial AI message
            const conversation = await Conversation.create({
                userId,
                agentId,
                agentSlug,
                active: true,
                currentNode: 'entry',
                messages: [{
                    role: 'assistant',
                    content: initialMessage,
                    timestamp: new Date()
                }],
                narrativeState: {
                    hasCompletedIntroduction: false,
                    relationshipStage: 'stranger',
                    knownTopics: [],
                    sharedStories: [],
                    lastInteractionTimestamp: new Date(),
                    agentSpecificState: {},
                    introStage: IntroductionStage.INITIAL_GREETING
                }
            });
            
            console.log(`Created new conversation with ID: ${conversation._id}`);
            console.log(`Initial message: "${initialMessage}"`);
            
            return conversation;
        } catch (error) {
            console.error('Error starting conversation:', error);
            throw error;
        }
    }

    // Get the first message of the narrative encounter
    private getFirstEncounterMessage(agent: AIAgent): string {
        const firstEncounterMessages: Record<string, string> = {
            'alex-rivers': "Oh! Hi there! I'm Alex Rivers from the Life Stories podcast. Sorry if I seem a bit frazzled at the moment...",
            'chef-isabella': "Oh! Hello there! I'm Isabella, just finishing up some prep work for a special dinner tonight.",
            'morgan-chase': "Oh, hi! I didn't see you there. I'm Morgan Chase, just sorting through some fabric swatches for my new collection."
        };
        
        return firstEncounterMessages[agent.slug] || 
            `Hello! I'm ${agent.name}, a ${agent.category} professional. It's nice to meet you!`;
    }

    // Helper method to generate initial greeting with more natural conversation starters
    private async generateInitialGreeting(agentId: string): Promise<string> {
        const agent = await agentService.getAgentById(agentId);
        if (!agent) throw new Error('Agent not found');
        
        // Use the same logic as getFirstEncounterMessage
        return this.getFirstEncounterMessage(agent);
    }

    async getConversations(userId: string) {
        return await Conversation.find({ userId })
            .sort({ updatedAt: -1 });
    }

    async getAgents() {
        return await agentService.listProfiles();
    }

    async getActiveConversation(userId: string, agentSlug: string) {
        return await Conversation.findOne({
            userId,
            agentSlug,
            active: true
        });
    }

    async saveMessageAndResponse(
        userId: string,
        agentId: string,
        message: string,
        response: string,
        nextNode: ConversationNodeType
    ) {
        // Get the current conversation to check if we're in introduction
        const conversation = await Conversation.findOne({
            userId, 
            agentId, 
            active: true
        });
        
        // Only update the node if we're not in introduction or if nextNode isn't 'casual_conversation'
        const updateFields: any = {
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
                updatedAt: new Date()
            }
        };
        
        // Only update the node if:
        // 1. We're not in introduction flow, OR
        // 2. nextNode is not 'casual_conversation' when we're in introduction
        if (conversation?.narrativeState?.hasCompletedIntroduction || 
            nextNode !== ConversationNodeType.CASUAL_CONVERSATION) {
            updateFields.$set.currentNode = nextNode;
        }
        
        // Save user message and AI response to the conversation
        const result = await Conversation.findOneAndUpdate(
            { userId, agentId, active: true },
            updateFields,
            { new: true }
        );
        
        return result;
    }

    async createOrGetConversation(userId: string, agentId: string, agentSlug: string, forceNew: boolean = false): Promise<any> {
        try {
            // Check if a conversation already exists (unless forceNew is true)
            if (!forceNew) {
                const existingConversation = await Conversation.findOne({
                    userId,
                    agentId,
                    active: true
                });
                
                if (existingConversation) {
                    return existingConversation;
                }
            } else {
                // Only delete if forceNew is explicitly set
                console.log(`Deleting existing conversations - User: ${userId}, Agent: ${agentId}`);
                await Conversation.deleteMany({
                    userId,
                    agentId
                });
            }
            
            // Create a new conversation with proper narrative state
            const agent = await agentService.getAgentById(agentId);
            if (!agent) throw new Error('Agent not found');
            
            const narrativeState = {
                hasCompletedIntroduction: false,
                relationshipStage: 'stranger',
                knownTopics: [],
                sharedStories: [],
                lastInteractionTimestamp: new Date(),
                agentSpecificState: {},
                introStage: IntroductionStage.INITIAL_GREETING
            };
            
            const initialMessage = this.getFirstEncounterMessage(agent);
            console.log(`Created initial narrative message: "${initialMessage}"`);
            
            const conversation = await Conversation.create({
                userId,
                agentId,
                agentSlug,
                messages: [{
                    role: 'assistant',
                    content: initialMessage,
                    timestamp: new Date()
                }],
                currentNode: ConversationNodeType.ENTRY,
                narrativeState,
                active: true,
                createdAt: new Date(),
                updatedAt: new Date()
            });
            
            console.log(`Created new conversation with ID: ${conversation._id}`);
            return conversation;
        } catch (error) {
            console.error('Error creating/getting conversation:', error);
            throw error;
        }
    }
} 