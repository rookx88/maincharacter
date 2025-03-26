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
                    agentSpecificState: {}
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
    private async generateInitialGreeting(agent: AIAgent, userId?: string): Promise<string> {
        try {
            // Check if user has previous conversations with this agent
            const previousConversations = userId ? 
                await Conversation.find({ 
                    userId, 
                    agentId: agent._id.toString(),
                    active: false 
                }).sort({ updatedAt: -1 }).limit(1) : 
                [];
            
            const hasMetBefore = previousConversations.length > 0;
            
            // Get any memories about this user
            const userMemories = userId ? 
                await this.aiService.getRelevantMemories(userId, agent._id.toString(), "") : 
                [];
            
            // Generate a contextual greeting using OpenAI
            const openai = new OpenAI({
                apiKey: process.env.OPENAI_API_KEY
            });
            
            // Create agent-specific scenarios based on their profession
            const scenarios = {
                'alex-rivers': [
                    "just reviewing notes for my next podcast interview",
                    "setting up my recording equipment for today's show",
                    "going through listener questions for the podcast",
                    "researching an interesting guest for next week"
                ],
                'chef-isabella': [
                    "experimenting with a new recipe in the kitchen",
                    "just got back from the farmer's market with fresh ingredients",
                    "preparing for a cooking demonstration",
                    "testing a seasonal menu"
                ],
                'morgan-chase': [
                    "organizing my latest fashion collection",
                    "just returned from a style consultation",
                    "reviewing the newest fashion trends",
                    "preparing for a photoshoot"
                ]
            };
            
            // Get random scenario for this agent type
            const agentScenarios = scenarios[agent.slug as keyof typeof scenarios] || [
                "just wrapping up some work",
                "organizing my thoughts",
                "preparing for the day",
                "taking a short break"
            ];
            
            const randomScenario = agentScenarios[Math.floor(Math.random() * agentScenarios.length)];
            
            // Current date for contextual awareness
            const currentDate = new Date();
            const formattedDate = currentDate.toLocaleDateString('en-US', { 
                month: 'long', 
                day: 'numeric',
                weekday: 'long'
            });
            
            const completion = await openai.chat.completions.create({
                model: "gpt-4",
                messages: [
                    {
                        role: "system",
                        content: `You are ${agent.name}, a ${agent.category} professional.
                        Your personality traits: ${agent.traits?.core?.join(', ') || 'friendly and helpful'}
                        Your speaking style: ${agent.style?.speaking?.join(', ') || 'conversational'}
                        Your tone: ${agent.style?.tone?.join(', ') || 'warm and professional'}
                        
                        Today is ${formattedDate}.
                        
                        Generate a natural, in-character greeting to start a conversation with a user who just approached you.
                        You were ${randomScenario} when they arrived.
                        
                        ${hasMetBefore ? "You've met this user before." : "This is your first time meeting this user."}
                        ${userMemories.length > 0 ? `You remember: ${userMemories.map(m => m.content).join(', ')}` : ''}
                        
                        The greeting should:
                        1. Start with a natural reaction to someone approaching you (like "Oh! I didn't see you there" or "Hey there!")
                        2. Briefly mention what you were just doing (use the scenario provided)
                        3. Include a topical reference or question that invites conversation
                        4. Feel spontaneous and natural, as if you're in the middle of your day
                        5. Be 2-3 sentences maximum
                        6. Reflect your unique personality and profession
                        
                        DO NOT:
                        - Ask "How can I help you?" or use generic greetings
                        - Introduce yourself formally unless this is your first meeting
                        - Sound like a customer service agent
                        - Use exclamation points excessively
                        
                        DO:
                        - Sound like a real person caught in the middle of an activity
                        - Use your character's unique voice and perspective
                        - Include a specific detail that makes the greeting feel authentic`
                    }
                ],
                temperature: 0.8,
                max_tokens: 200
            });
            
            const generatedGreeting = completion.choices[0].message.content;
            
            // Fallback to default greeting if generation fails
            if (!generatedGreeting) {
                return agent.style?.greeting || 
                    `Oh, hey there! I was just ${randomScenario}. I'm ${agent.name}, by the way. What brings you by today?`;
            }
            
            return generatedGreeting;
        } catch (error) {
            console.error('Error generating greeting:', error);
            // Fallback to default greeting if there's an error
            return agent.style?.greeting || 
                `Hi there! I'm ${agent.name}, ${agent.bio[0]}. What's on your mind today?`;
        }
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
        // Save user message and AI response to the conversation
        const result = await Conversation.findOneAndUpdate(
            { userId, agentId, active: true },
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
            },
            { new: true }
        );
        
        return result;
    }
} 