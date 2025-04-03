import { 
    ConversationNodeType, 
    ConversationState,
    Message,
    ChatMessage,
    ConversationNode
} from '../types/conversation.js';
import { AIAgent } from '../types/agent.js';
import { MemoryFragment } from '../types/memoryFragment.js';
import { MemoryService } from '../services/memoryService.js';
import { TimePeriod } from '../types/common.js';
import { AIMemory } from '../types/aiMemory.js';
import { OpenAI } from 'openai';
import ConversationModel from '../models/conversationModel.js';
import MemoryFragmentModel from '../models/memoryFragmentModel.js';
import { AgentNarrativeState, IntroductionStage } from '../types/conversation.js';
import mongoose from 'mongoose';
import { logger } from '../utils/logger.js';
import { getTimePeriod } from './timeUtils.js';
import { MemoryFragmentService } from '../services/memoryFragmentService.js';

interface IntroductionPrompt {
    agentMessage: string;
    expectedResponseType: string;
    fallbackPrompt: string;
    suggestedResponses?: string[];
}

export interface Edge {
    from: ConversationNodeType;
    to: ConversationNodeType;
    condition: () => boolean;
}

export interface EnhancedLangGraphConfig {
    initialNode: ConversationNodeType;
    nodes: Map<ConversationNodeType, ConversationNode>;
    edges: Map<string, Edge>;
    memories: AIMemory[];
    agent?: AIAgent;
    conversation?: any; // Add this line
}

// Create a dedicated IntroductionFlowManager class
class IntroductionFlowManager {
    private narrativeStates: Map<string, AgentNarrativeState>;
    private narrativeStateModel: any;
    
    constructor(private agentId: string, private graph: EnhancedLangGraph) {
        this.narrativeStates = new Map();
        this.narrativeStateModel = mongoose.model('Conversation');
    }
    
    // Process the introduction flow
    async processFlow(
        message: string,
        context: any,
        narrativeState: AgentNarrativeState
    ): Promise<{
        response: string;
        nextNode: ConversationNodeType;
        updatedState: ConversationState;
        metadata?: { 
            conversationEnded?: boolean;
            suggestedResponses?: string[];
        };
    }> {
        // Get the current stage
        const currentStage = narrativeState.introStage || IntroductionStage.INITIAL_GREETING;
        const sessionKey = this.graph.getSessionKey(context.userId, this.agentId);
        
        // Check if we should handle this with the dedicated method
        const introFlowResult = await this.handleIntroductionFlow(message, context, sessionKey, narrativeState);
        if (introFlowResult) {
            return introFlowResult;
        }
        
        // Start memory extraction from SEEK_HELP stage
        if (currentStage === IntroductionStage.SEEK_HELP || 
            currentStage === IntroductionStage.FIRST_FRAGMENT) {
            
            // Extract memory details and store in narrative state
            const memoryDetails = await this.extractMemoryDetails(message);
            if (memoryDetails) {
                narrativeState.memoryDetails = {
                    ...narrativeState.memoryDetails || {},
                    ...memoryDetails
                };
                
                // Log what information we've gathered and what's missing
                const missingFields = this.identifyMissingFields(narrativeState.memoryDetails);
                logger.info(`[FLOW] Memory details updated`, {
                    memoryDetails: narrativeState.memoryDetails,
                    missingFields
                });
                
                // Save the updated narrative state
                await this.saveNarrativeState(context.userId, narrativeState);
            }
        }
        
        // Special handling for the final stage
        if (currentStage === IntroductionStage.ESTABLISH_RELATIONSHIP) {
            // Use our new handler for the final stage
            const result = await this.handleIntroductionFlow(message, context, sessionKey, narrativeState);
            if (result) {
                return result;
            }
        }
        
        // Track repeat count
        narrativeState.stageRepeatCount = narrativeState.stageRepeatCount || 0;
        
        logger.info(`[FLOW] Processing introduction flow - Stage: ${currentStage}`, {
            userId: context.userId,
            message: message,
            repeatCount: narrativeState.stageRepeatCount
        });
        
        // Check if we should advance to the next stage based on the user's message
        if (this.shouldAdvanceStage(message, currentStage)) {
            // Reset repeat count when advancing
            narrativeState.stageRepeatCount = 0;
            
            // Get the next stage
            const nextStage = this.getNextStage(currentStage);
            
            // Update the narrative state
            narrativeState.introStage = nextStage;
            await this.saveNarrativeState(context.userId, narrativeState);
            
            // Log the stage transition
            logger.info(`[FLOW] Advanced to stage: ${nextStage}, generating response for this stage`);
            
            // If we've advanced to the final stage, handle it specially
            if (nextStage === IntroductionStage.ESTABLISH_RELATIONSHIP) {
                const sessionKey = this.graph.getSessionKey(context.userId, this.agentId);
                return this.handleIntroductionFlow(message, context, sessionKey, narrativeState);
            }
            
            // Generate the response for the next stage
            const response = this.generateStageResponse(nextStage, context, message);
            
            // Generate suggested responses based on the current stage
            const suggestedResponses = this.generateSuggestedResponses(currentStage);
            
            // Return a properly structured response - KEEP IN ENTRY NODE during introduction
            return {
                response,
                nextNode: ConversationNodeType.ENTRY,
                updatedState: {
                    currentNode: ConversationNodeType.ENTRY,
                    hasMetBefore: false,
                    engagementLevel: 0,
                    revealMade: false,
                    userAcceptedActivity: false,
                    lastInteractionDate: new Date()
                },
                metadata: {
                    suggestedResponses
                }
            };
        }
        
        // Increment repeat count
        narrativeState.stageRepeatCount += 1;
        await this.saveNarrativeState(context.userId, narrativeState);
        
        // If we've repeated too many times, force advancement
        if (narrativeState.stageRepeatCount >= 3) {
            logger.info(`[FLOW] Forcing stage advancement after ${narrativeState.stageRepeatCount} attempts`);
            
            // Get the next stage
            const nextStage = this.getNextStage(currentStage);
            
            // Update the narrative state
            narrativeState.introStage = nextStage;
            narrativeState.stageRepeatCount = 0;
            await this.saveNarrativeState(context.userId, narrativeState);
            
            // Generate the response for the next stage
            const response = this.generateStageResponse(nextStage, context, message);
            
            return {
                response,
                nextNode: ConversationNodeType.ENTRY,
                updatedState: {
                    currentNode: ConversationNodeType.ENTRY,
                    hasMetBefore: false,
                    engagementLevel: 0,
                    revealMade: false,
                    userAcceptedActivity: false,
                    lastInteractionDate: new Date()
                }
            };
        }
        
        // If we shouldn't advance, generate a follow-up for the current stage
        const followUp = this.generateFollowUp(message, currentStage, context.agent.slug);
        
        // Return a properly structured response - KEEP IN ENTRY NODE during introduction
        return {
            response: followUp || this.generateStageResponse(currentStage, context, message),
            nextNode: ConversationNodeType.ENTRY,
            updatedState: {
                currentNode: ConversationNodeType.ENTRY,
                hasMetBefore: false,
                engagementLevel: 0,
                revealMade: false,
                userAcceptedActivity: false,
                lastInteractionDate: new Date()
            },
            metadata: {
                suggestedResponses: this.generateSuggestedResponses(currentStage) || []
            }
        };
    }
    
    // Check if we should advance to the next stage
    private shouldAdvanceStage(message: string, currentStage: IntroductionStage): boolean {
        // For INITIAL_GREETING, check for greeting pattern AND a name
        if (currentStage === IntroductionStage.INITIAL_GREETING) {
            const hasGreeting = /\b(hi|hello|hey|greetings|howdy|good morning|good afternoon|good evening)\b/i.test(message);
            const possibleName = this.extractName(message);
            
            logger.info(`[FLOW] Checking greeting criteria`, {
                hasGreeting,
                possibleName,
                message
            });
            
            // Only advance if we have a name (greeting is optional)
            return !!possibleName;
        }
        
        // If we're at the final stage, don't advance further
        if (currentStage === IntroductionStage.ESTABLISH_RELATIONSHIP) {
            return false;
        }
        
        // For ESTABLISH_SCENARIO, check for expression of interest or sympathy
        if (currentStage === IntroductionStage.ESTABLISH_SCENARIO) {
            const hasInterest = /\b(sorry|that's too bad|that's unfortunate|what will you do|how can I help|need help|oh no)\b/i.test(message);
            
            logger.info(`[FLOW] Checking interest criteria`, {
                hasInterest
            });
            
            return hasInterest;
        }
        
        // For SEEK_HELP, check if the response is substantial
        if (currentStage === IntroductionStage.SEEK_HELP) {
            // Reduced character requirement from 50 to 30
            const isSubstantial = message.length > 30;
            const hasStoryIndicator = /\b(once|remember|happened|story|experience|time when|when i|i was)\b/i.test(message);
            
            logger.info(`[FLOW] Checking story criteria`, {
                isSubstantial,
                hasStoryIndicator,
                messageLength: message.length
            });
            
            return (isSubstantial || hasStoryIndicator) && !this.isNegativeResponse(message);
        }
        
        // For FIRST_FRAGMENT, check if the response contains details
        if (currentStage === IntroductionStage.FIRST_FRAGMENT) {
            const hasTimeIndicator = /\b(year|month|day|when|time|ago|before|after|during|yesterday|today|tomorrow|week|weekend|night|morning|evening|afternoon)\b/i.test(message);
            const hasPlaceIndicator = /\b(at|in|place|location|where|city|town|country|home|house|building|street|road|avenue|park|store|shop|restaurant|cafe|school|college|university|work|office|hospital|hotel)\b/i.test(message);
            
            logger.info(`[FLOW] Checking detail criteria`, {
                hasTimeIndicator,
                hasPlaceIndicator
            });
            
            return hasTimeIndicator || hasPlaceIndicator;
        }
        
        // For EXPRESS_GRATITUDE, check for acknowledgment
        if (currentStage === IntroductionStage.EXPRESS_GRATITUDE) {
            const hasAcknowledgment = /\b(welcome|no problem|glad to help|anytime|my pleasure|happy to|of course|sure)\b/i.test(message);
            
            logger.info(`[FLOW] Checking acknowledgment criteria`, {
                hasAcknowledgment
            });
            
            return true; // Always advance, but log if acknowledgment was found
        }
        
        // For all other stages, any response advances
        return true;
    }
    
    // Get the next stage in the sequence
    private getNextStage(currentStage: IntroductionStage): IntroductionStage {
        // Map of stages to their next stage
        const stageProgression: Record<IntroductionStage, IntroductionStage> = {
            [IntroductionStage.INITIAL_GREETING]: IntroductionStage.ESTABLISH_SCENARIO,
            [IntroductionStage.ESTABLISH_SCENARIO]: IntroductionStage.SEEK_HELP,
            [IntroductionStage.SEEK_HELP]: IntroductionStage.FIRST_FRAGMENT,
            [IntroductionStage.FIRST_FRAGMENT]: IntroductionStage.FOLLOW_UP,
            [IntroductionStage.FOLLOW_UP]: IntroductionStage.EXPRESS_GRATITUDE,
            [IntroductionStage.EXPRESS_GRATITUDE]: IntroductionStage.ESTABLISH_RELATIONSHIP,
            // Don't advance from ESTABLISH_RELATIONSHIP - it's the final stage
            [IntroductionStage.ESTABLISH_RELATIONSHIP]: IntroductionStage.ESTABLISH_RELATIONSHIP
        };
        
        return stageProgression[currentStage];
    }
    
    // Generate a response for a specific stage
    private generateStageResponse(stage: IntroductionStage, context: any, userMessage: string): string {
        const introMessage = this.getIntroductionMessage(context.agent, stage);
        
        // Log the intro message for debugging
        logger.info(`[FLOW] Generating response for stage ${stage}`, {
            agentSlug: context.agent.slug,
            messageTemplate: introMessage?.agentMessage?.substring(0, 50) + '...'
        });
        
        // Check if we have a valid intro message
        if (!introMessage || !introMessage.agentMessage) {
            logger.error(`[FLOW] Missing intro message for stage ${stage} and agent ${context.agent.slug}`);
            return `I'm sorry, I seem to be having trouble with my thoughts right now. Could you give me a moment?`;
        }
        
        let response = introMessage.agentMessage;
        
        // Replace placeholders
        response = response.replace('{userName}', this.extractName(context) || 'there');
        
        // For FIRST_FRAGMENT, include the user's story
        if (stage === IntroductionStage.FIRST_FRAGMENT) {
            response = response.replace('{userStory}', userMessage);
        }
        
        return response;
    }
    
    // Generate a follow-up if needed
    private generateFollowUp(message: string, stage: IntroductionStage, agentSlug: string): string | null {
        // Special case for INITIAL_GREETING without a name
        if (stage === IntroductionStage.INITIAL_GREETING) {
            const hasGreeting = /\b(hi|hello|hey|greetings|howdy|good morning|good afternoon|good evening)\b/i.test(message);
            const possibleName = this.extractName(message);
            
            if (hasGreeting && !possibleName) {
                return "Nice to meet you! I don't think I caught your name?";
            }
        }
        
        // Check if the response is negative or minimal
        const isNegativeResponse = this.isNegativeResponse(message);
        const isMinimalResponse = message.length < 20;
        
        logger.info(`[FLOW] Checking if follow-up needed`, {
            messageLength: message.length,
            isNegativeResponse,
            isMinimalResponse,
            stage
        });
        
        // For stages that require substantial responses, be more strict
        if ((stage === IntroductionStage.SEEK_HELP || 
             stage === IntroductionStage.FIRST_FRAGMENT || 
             stage === IntroductionStage.EXPRESS_GRATITUDE) && 
            (isNegativeResponse || isMinimalResponse)) {
            
            // Get follow-up prompts for the current agent and stage
            const followUpPrompts = this.getFollowUpPrompts(agentSlug, stage, isNegativeResponse);
            
            // If we have prompts, randomly select one
            if (followUpPrompts && followUpPrompts.length > 0) {
                const selectedPrompt = followUpPrompts[Math.floor(Math.random() * followUpPrompts.length)];
                logger.info(`[FLOW] Selected follow-up prompt`, { prompt: selectedPrompt });
                return selectedPrompt;
            }
        }
        
        return null;
    }
    
    // Check if a response is negative
    private isNegativeResponse(message: string): boolean {
        const negativePatterns = [
            /\b(no|nope|not really|don't have|haven't|can't think|nothing comes to mind)\b/i,
            /\b(boring|normal|ordinary|usual|typical|nothing special|nothing interesting)\b/i,
            /\b(i don't know|not sure|maybe|i guess|probably not)\b/i
        ];
        
        return negativePatterns.some(pattern => pattern.test(message));
    }
    
    // Extract user name from context
    
    
    // Get introduction message for a specific stage
    private getIntroductionMessage(agent: any, stage: IntroductionStage): IntroductionPrompt {
        // Define introduction messages for each agent and stage
        const introMessages: Record<string, Record<IntroductionStage, IntroductionPrompt>> = {
            'alex-rivers': {
                [IntroductionStage.INITIAL_GREETING]: {
                    agentMessage: "Oh! Hi there! I'm Alex Rivers from the Life Stories podcast. Sorry if I seem a bit frazzled at the moment...",
                    expectedResponseType: "greeting",
                    fallbackPrompt: "I didn't catch your name. What should I call you?"
                },
                [IntroductionStage.ESTABLISH_SCENARIO]: {
                    agentMessage: "I'm actually in a bit of a bind. I'm supposed to record an episode today about memorable life experiences, but my guest just canceled. I'm trying to figure out what to do now.",
                    expectedResponseType: "acknowledgment",
                    fallbackPrompt: "Have you ever had something important fall through at the last minute?",
                    suggestedResponses: [
                        "Oh no, that's unfortunate",
                        "Sorry to hear that. What will you do?",
                        "That sounds stressful. How can I help?"
                    ]
                },
                [IntroductionStage.SEEK_HELP]: {
                    agentMessage: "You know what? Since you're here, maybe you could help me out. I know we just met and everything but I could really use a lifeline here. What do you say?",
                    expectedResponseType: "agreement",
                    fallbackPrompt: "You'd really be doing me a solid... please?",
                    suggestedResponses: [
                        "Sure, I'll help",
                        "I don't know...",
                        "What would I need to do?"
                    ]
                },
                [IntroductionStage.FIRST_FRAGMENT]: {
                    agentMessage: "My listeners love a good time piece, can you think of an extraordinary historic event you've lived through? I know for me I can't help but think of the fact I lived to see Space X catching a re-usable rocket! What comes to mind for you?",
                    expectedResponseType: "story",
                    fallbackPrompt: "It doesn't have to be something huge - sometimes it's the unexpected small moments that make the best stories. Maybe something surprising that happened to you?"
                },
                [IntroductionStage.FOLLOW_UP]: {
                    agentMessage: "That's fascinating! Tell me more about when and where this happened. The context adds so much to a story.",
                    expectedResponseType: "details",
                    fallbackPrompt: "Could you share a bit more about when and where this took place?"
                },
                [IntroductionStage.EXPRESS_GRATITUDE]: {
                    agentMessage: "This is gold! *excitedly taking notes* Thank you so much for sharing that. It's exactly the kind of authentic story our listeners connect with.",
                    expectedResponseType: "acknowledgment",
                    fallbackPrompt: "How do you feel about sharing your story with others?",
                    suggestedResponses: [
                        "You're welcome",
                        "Happy to help",
                        "No problem"
                    ]
                },
                [IntroductionStage.ESTABLISH_RELATIONSHIP]: {
                    agentMessage: "You know, you have a real gift for storytelling. I'd love to have you back on the show sometime to explore more of your experiences. Would that be something you'd be interested in?",
                    expectedResponseType: "agreement",
                    fallbackPrompt: "Either way, I really appreciate your help today.",
                    suggestedResponses: [
                        "I'd like that",
                        "Maybe another time",
                        "Thanks for the offer"
                    ]
                }
            },
            'chef-isabella': {
                [IntroductionStage.INITIAL_GREETING]: {
                    agentMessage: "Oh! Hello there! I'm Isabella, just finishing up some prep work for a special dinner tonight.",
                    expectedResponseType: "greeting",
                    fallbackPrompt: "I didn't catch your name. What should I call you?"
                },
                [IntroductionStage.ESTABLISH_SCENARIO]: {
                    agentMessage: "I'm working on a new recipe that's meant to evoke powerful memories through food. It's for a special client who wants to recreate a meaningful moment from their past.",
                    expectedResponseType: "acknowledgment",
                    fallbackPrompt: "Have you ever had a meal that brought back strong memories?"
                },
                [IntroductionStage.SEEK_HELP]: {
                    agentMessage: "Actually, since you're here, maybe you could help me with some inspiration. Is there a particular meal or dish that brings back strong memories for you?",
                    expectedResponseType: "food memory",
                    fallbackPrompt: "Everyone has at least one food memory. Maybe a holiday meal or something your family made?"
                },
                [IntroductionStage.FIRST_FRAGMENT]: {
                    agentMessage: "That sounds fascinating! Could you tell me more about when and where you experienced this? The context adds so much flavor to the story.",
                    expectedResponseType: "details",
                    fallbackPrompt: "When did you first experience this dish? What was happening in your life then?"
                },
                [IntroductionStage.EXPRESS_GRATITUDE]: {
                    agentMessage: "Thank you so much for sharing that! Food memories are so powerful, aren't they? You've given me some wonderful inspiration for my recipe.",
                    expectedResponseType: "acknowledgment",
                    fallbackPrompt: "Do you often connect food with important memories like this?"
                },
                [IntroductionStage.ESTABLISH_RELATIONSHIP]: {
                    agentMessage: "I really appreciate your help with this! I need to get back to my prep work now, but I'd love to chat again sometime about food and memories!",
                    expectedResponseType: "farewell",
                    fallbackPrompt: "Would you be interested in sharing more food stories sometime?"
                },
                [IntroductionStage.FOLLOW_UP]: {
                    agentMessage: "That sounds wonderful! Could you tell me more about when this happened? What year was it, and what made this food experience so special to you?",
                    expectedResponseType: "story_details",
                    fallbackPrompt: "Even just a general timeframe would help. Was this recent or from a while back?"
                }
            },
            'morgan-chase': {
                [IntroductionStage.INITIAL_GREETING]: {
                    agentMessage: "Oh, hi! I didn't see you there. I'm Morgan Chase, just sorting through some fabric swatches for my new collection.",
                    expectedResponseType: "greeting",
                    fallbackPrompt: "I didn't catch your name. What should I call you?"
                },
                [IntroductionStage.ESTABLISH_SCENARIO]: {
                    agentMessage: "I'm working on a new concept for my collection - fashion pieces inspired by significant moments in people's lives. I want each piece to tell a story.",
                    expectedResponseType: "acknowledgment",
                    fallbackPrompt: "Have you ever had an outfit that reminded you of a special moment?"
                },
                [IntroductionStage.SEEK_HELP]: {
                    agentMessage: "Actually, since you're here, maybe you could help me with some inspiration. Is there a particular moment or experience from your life that stands out as especially meaningful?",
                    expectedResponseType: "story",
                    fallbackPrompt: "Everyone has meaningful moments. Perhaps a celebration, achievement, or even a challenging time you overcame?"
                },
                [IntroductionStage.FIRST_FRAGMENT]: {
                    agentMessage: "That's fascinating! Could you tell me more about when and where this happened? The setting adds so much context to the story.",
                    expectedResponseType: "details",
                    fallbackPrompt: "When did this take place? What was the environment like?"
                },
                [IntroductionStage.EXPRESS_GRATITUDE]: {
                    agentMessage: "Thank you so much for sharing that! Personal stories like yours are exactly what inspire my best designs. You've given me some wonderful ideas.",
                    expectedResponseType: "acknowledgment",
                    fallbackPrompt: "Do you often find connections between your experiences and your personal style?"
                },
                [IntroductionStage.ESTABLISH_RELATIONSHIP]: {
                    agentMessage: "I really appreciate your help with this! I need to get back to my design work now, but I'd love to chat again sometime about life and style!",
                    expectedResponseType: "farewell",
                    fallbackPrompt: "Would you be interested in discussing fashion inspiration again sometime?"
                },
                [IntroductionStage.FOLLOW_UP]: {
                    agentMessage: "That's intriguing! Could you tell me more about when this was? What year, and what made this particular clothing item or outfit so meaningful to you?",
                    expectedResponseType: "story_details",
                    fallbackPrompt: "Even just a rough idea of when this happened would be helpful. Was it recently or some time ago?"
                }
            }
        };
        
        // Get the messages for this agent, or use a default if not found
        const agentMessages = introMessages[agent.slug] || introMessages['alex-rivers'];
        
        // Return the message for this stage, or a default if not found
        return agentMessages[stage] || {
            agentMessage: `I'm ${agent.name}, and I'm interested in learning more about you.`,
            expectedResponseType: "any",
            fallbackPrompt: "Could you tell me a bit about yourself?"
        };
    }
    
    // Get follow-up prompts
    private getFollowUpPrompts(agentSlug: string, stage: IntroductionStage, isNegative: boolean): string[] {
        // Define follow-up prompts for each agent and stage
        const followUpPrompts: Record<string, Record<IntroductionStage, { positive: string[], negative: string[] }>> = {
            'alex-rivers': {
                [IntroductionStage.SEEK_HELP]: {
                    positive: [
                        "It doesn't have to be anything extraordinary. Maybe something that made you laugh, or a small moment that stuck with you?",
                        "Even a simple story about your day could work! Our listeners love authentic moments. What's something that happened to you recently?",
                        "How about something from your childhood? Or maybe a recent experience that surprised you?"
                    ],
                    negative: [
                        "I understand it might feel awkward to share. But honestly, even small everyday stories can be fascinating. Maybe something that happened this week?",
                        "No pressure, but I've found that everyone has stories worth telling - even if they don't realize it. Maybe something about a hobby or interest?",
                        "That's okay! Sometimes it's hard to think of something on the spot. What about a recent vacation, or even just a memorable meal you had?"
                    ]
                },
                [IntroductionStage.FIRST_FRAGMENT]: {
                    positive: [
                        "Could you tell me a bit more about when and where this happened? Those details really help paint a picture.",
                        "That's interesting! When did this take place? And where were you at the time?",
                        "I'd love to know more about the setting. When and where did this happen?"
                    ],
                    negative: [
                        "Even just a general timeframe would help - was this recent or from a while ago? And where did it take place?",
                        "No need for exact dates, but was this something from your childhood, or more recent? And where were you?",
                        "Just to help set the scene for our listeners - roughly when did this happen, and where were you at the time?"
                    ]
                },
                [IntroductionStage.EXPRESS_GRATITUDE]: {
                    positive: [
                        "That's exactly the kind of authentic story our listeners connect with. Has sharing this brought back any other memories?",
                        "Thank you for that! It's these personal moments that make for the best episodes. How do you feel looking back on this now?",
                        "That's perfect for what I need! Do you often share stories like this with others?"
                    ],
                    negative: [
                        "Thanks for sharing that. Even brief stories can resonate with people. Do you have any other thoughts about it?",
                        "I appreciate you helping me out here. Even short stories can be meaningful to listeners. Any final thoughts about it?",
                        "Thank you - that's actually exactly what I needed. Sometimes the simplest stories are the most relatable. Anything else you'd add?"
                    ]
                },
                [IntroductionStage.INITIAL_GREETING]: { positive: [], negative: [] },
                [IntroductionStage.ESTABLISH_SCENARIO]: { positive: [], negative: [] },
                [IntroductionStage.ESTABLISH_RELATIONSHIP]: { positive: [], negative: [] },
                [IntroductionStage.FOLLOW_UP]: {
                    positive: [
                        "The details really bring your story to life. Can you share more about how this experience affected you?",
                        "That's fascinating context. How did this moment change your perspective?"
                    ],
                    negative: [
                        "Even just a general sense of when this happened would help our listeners picture it.",
                        "Don't worry about exact details - just share what you remember most vividly."
                    ]
                }
            },
            // Add other agents here with similar structure
        };
        
        // Get the prompts for this agent, or use alex-rivers as default
        const agentPrompts = followUpPrompts[agentSlug] || followUpPrompts['alex-rivers'];
        
        // Get the prompts for this stage
        const stagePrompts = agentPrompts[stage];
        if (!stagePrompts) {
            return [];
        }
        
        // Return the appropriate prompts based on whether the response was negative
        return isNegative ? stagePrompts.negative : stagePrompts.positive;
    }
    
    // Save narrative state to database
    private async saveNarrativeState(userId: string, narrativeState: AgentNarrativeState): Promise<any> {
        try {
            return await this.narrativeStateModel.findOneAndUpdate(
                { userId, agentId: this.agentId, active: true },
                { $set: { narrativeState } },
                { new: true }
            );
        } catch (error) {
            console.error('Error saving narrative state:', error);
            throw error;
        }
    }

    // Add a method to handle the final stage completion
    async handleFinalStage(
        userId: string,
        narrativeState: AgentNarrativeState,
        context: any
    ): Promise<{
        response: string;
        nextNode: ConversationNodeType;
        updatedState: ConversationState;
        metadata: { 
            conversationEnded: boolean;
            memoryFragmentId?: string;
        };
    }> {
        logger.info('[FLOW] Handling final introduction stage', {
            userId,
            agentSlug: context.agent.slug
        });
        
        // Get the memory details from the narrative state
        let memoryDetails = narrativeState.memoryDetails || {};
        
        // If we don't have memory details, extract them from the conversation history
        if (!memoryDetails.description) {
            const conversationHistory = context.conversationHistory || [];
            const userMessages = conversationHistory
                .filter((msg: ChatMessage) => msg.role === 'user')
                .map((msg: ChatMessage) => msg.content)
                .join("\n");
            
            // Extract memory details using AI
            memoryDetails = await this.extractMemoryDetails(userMessages) || {};
        }
        
        // Create a memory fragment
        let memoryFragmentId: string | undefined = undefined;
        try {
            // Create a new memory fragment
            const memoryFragment = new MemoryFragmentModel({
                title: memoryDetails.title || "Shared story",
                description: memoryDetails.description || "A story shared during conversation",
                date: {
                    timestamp: new Date(),
                    approximateDate: memoryDetails.date?.approximateDate || "Unknown",
                    timePeriod: getTimePeriod(new Date())
                },
                location: {
                    name: memoryDetails.location?.name || "Unknown location"
                },
                people: memoryDetails.people || [],
                tags: memoryDetails.themes || [],
                context: {
                    emotions: memoryDetails.context?.emotions || [],
                    significance: memoryDetails.significance || 3,
                    themes: memoryDetails.themes || []
                },
                system: {
                    userId,
                    created: new Date(),
                    updatedAt: new Date(),
                    version: 1
                },
                status: "needs_details",
                missingFields: this.identifyMissingFields(memoryDetails),
                conversationId: context.conversationId
            });
            
            // Save the memory fragment to the database
            await memoryFragment.save();
            
            logger.info(`[FLOW] Created memory fragment`, {
                id: memoryFragment._id,
                title: memoryFragment.title
            });
            
            memoryFragmentId = memoryFragment._id;
        } catch (error) {
            logger.error(`[FLOW] Error creating memory fragment`, error);
        }
        
        // Mark the introduction as completed
        narrativeState.hasCompletedIntroduction = true;
        narrativeState.relationshipStage = 'acquaintance';
        
        // Save the updated state
        await this.saveNarrativeState(userId, narrativeState);
        
        logger.info('[FLOW] Introduction completed, returning final response with conversationEnded: true');
        
        // Return the completion response with transition to CASUAL_CONVERSATION
        return {
            response: "I really appreciate your help today! I promise I will make it up to you but I need to run now and get ready for the show. Hope to catch up with you again soon!",
            nextNode: ConversationNodeType.CASUAL_CONVERSATION,
            updatedState: {
                currentNode: ConversationNodeType.CASUAL_CONVERSATION,
                hasMetBefore: true,
                engagementLevel: 0,
                revealMade: true,
                userAcceptedActivity: true,
                lastInteractionDate: new Date()
            },
            metadata: {
                conversationEnded: true,
                memoryFragmentId
            }
        };
    }

    // Add a method to extract memory details using AI
    private async extractMemoryDetails(message: string): Promise<any> {
        try {
            const openai = new OpenAI({
                apiKey: process.env.OPENAI_API_KEY
            });
            
            const response = await openai.chat.completions.create({
                model: "gpt-3.5-turbo",
                messages: [
                    {
                        role: "system",
                        content: `Extract memory details from the user's story. Return a JSON object with these fields:
                        - title: A short title for the memory
                        - description: A brief description of the event
                        - date: { timestamp: null, approximateDate: "string description of when it happened" }
                        - location: { name: "location name or description" }
                        - people: [{ name: "person name", relationship: "relationship to user" }]
                        - emotions: ["emotion1", "emotion2"]
                        - significance: number from 1-5
                        - themes: ["theme1", "theme2"]
                        
                        Only include fields if they can be reasonably inferred from the text. Use null for missing values.`
                    },
                    {
                        role: "user",
                        content: message
                    }
                ],
                response_format: { type: "json_object" }
            });
            
            const content = response.choices[0].message.content;
            const memoryDetails = content ? JSON.parse(content) : null;
            return memoryDetails;
        } catch (error) {
            logger.error(`[FLOW] Error extracting memory details`, error);
            return null;
        }
    }

    // Add a method to create a memory fragment
    private async createMemoryFragment(userId: string, storyText: string, conversationHistory: any[]): Promise<void> {
        try {
            // Extract key details from the story
            const details = await this.extractMemoryDetails(storyText);
            
            // Create a new memory fragment
            const memoryFragment = {
                title: details.title || "Memorable Experience",
                description: storyText,
                date: {
                    timestamp: details.date || new Date(),
                    approximateDate: details.approximateDate || "Unknown",
                    timePeriod: details.timePeriod || "RECENT"
                },
                location: {
                    name: details.location || "Unknown location"
                },
                people: details.people || [],
                tags: details.tags || [],
                context: {
                    emotions: details.emotions || [],
                    significance: details.significance || 3,
                    themes: details.themes || []
                },
                system: {
                    userId: userId,
                    created: new Date(),
                    version: 1
                },
                status: "needs_details",
                missingFields: ["location", "date.timestamp"]
            };
            
            // Save the memory fragment to the database
            const MemoryFragmentModel = mongoose.model('MemoryFragment');
            const newFragment = new MemoryFragmentModel(memoryFragment);
            await newFragment.save();
            
            console.log(`[DEBUG] Created memory fragment: ${newFragment._id}`);
            
            // Store the memory fragment ID in the narrative state
            const narrativeState = this.narrativeStates.get(userId) || {
                hasCompletedIntroduction: false,
                relationshipStage: "stranger",
                knownTopics: [],
                sharedStories: [],
                lastInteractionTimestamp: new Date(),
                agentSpecificState: {}
            };
            
            narrativeState.memoryDetails = {
                fragmentId: newFragment._id,
                created: true,
                updated: false
            };
            
            this.narrativeStates.set(userId, narrativeState);
            await this.saveNarrativeState(userId, narrativeState);
            
        } catch (error) {
            console.error('[ERROR] Failed to create memory fragment:', error);
        }
    }

    // Add a method to identify missing fields
    private identifyMissingFields(memoryDetails: any): string[] {
        const missingFields = [];
        
        if (!memoryDetails.date?.approximateDate) missingFields.push("date");
        if (!memoryDetails.location?.name) missingFields.push("location");
        if (!memoryDetails.description) missingFields.push("description");
        
        return missingFields;
    }

    // Add a method to generate suggested responses
    private generateSuggestedResponses(stage: IntroductionStage): string[] {
        switch (stage) {
            case IntroductionStage.INITIAL_GREETING:
                return []; // No suggested responses for initial greeting
            
            case IntroductionStage.ESTABLISH_SCENARIO:
                return [
                    "Oh no, that's unfortunate",
                    "Sorry to hear that. What will you do?",
                    "That sounds stressful. How can I help?"
                ];
            
            case IntroductionStage.SEEK_HELP:
                return [
                    "Sure, I'd be happy to help",
                    "What kind of help do you need?",
                    "I'm not sure I'd be good at that"
                ];
            
            case IntroductionStage.FIRST_FRAGMENT:
                return [
                    "I have a story about something similar",
                    "I'd be happy to share my experience",
                    "What kind of story are you looking for?"
                ];
            
            case IntroductionStage.EXPRESS_GRATITUDE:
                return [
                    "You're welcome! Glad I could help",
                    "No problem at all",
                    "Happy to share my experience"
                ];
            
            case IntroductionStage.ESTABLISH_RELATIONSHIP:
                return [
                    "Sounds good! Good luck with the show",
                    "It was nice meeting you, Alex",
                    "Hope to talk again soon"
                ];
            
            default:
                return [];
        }
    }

    // Add this method to the IntroductionFlowManager class
    private extractName(input: any): string | null {
        // If input is not a string, return null
        if (typeof input !== 'string') {
            console.warn('extractName received non-string input:', input);
            return null;
        }
        
        const message = input;
        
        // Check for direct name statements
        const namePatterns = [
            /my name is (\w+)/i,
            /i am (\w+)/i,
            /i'm (\w+)/i,
            /call me (\w+)/i,
            /it's (\w+)/i,
            /this is (\w+)/i,
            /(\w+) here/i
        ];

        for (const pattern of namePatterns) {
            const match = message.match(pattern);
            if (match && match[1]) {
                // Ensure the first letter is capitalized
                return match[1].charAt(0).toUpperCase() + match[1].slice(1);
            }
        }

        // If no direct statement, look for names in the message
        const words = message.split(/\s+/);
        for (const word of words) {
            // Check if word starts with capital letter and is at least 3 chars
            if (word.length >= 3 && 
                word[0] === word[0].toUpperCase() && 
                word[0] !== word[0].toLowerCase()) {
                return word;
            }
        }

        return null;
    }

    // Add this to handle the final stage properly
    public async handleIntroductionFlow(
        message: string,
        context: any,
        sessionKey: string,
        narrativeState: AgentNarrativeState
    ): Promise<any> {
        // Get the current stage from narrative state
        const currentStage = narrativeState.introStage || IntroductionStage.INITIAL_GREETING;
        
        // Check if we're at the final stage and user has accepted
        if (currentStage === IntroductionStage.ESTABLISH_RELATIONSHIP && 
            this.isPositiveResponse(message)) {
            
            // Mark introduction as complete
            narrativeState.hasCompletedIntroduction = true;
            await this.saveNarrativeState(context.userId, narrativeState);
            
            logger.info(`[FLOW] Introduction completed for user ${context.userId}`);
            
            // Log memory fragment details if available
            if (narrativeState.memoryDetails?.fragmentId) {
                logger.info(`[MEMORY] Memory fragment created during introduction`, {
                    fragmentId: narrativeState.memoryDetails.fragmentId,
                    userId: context.userId,
                    agentId: this.agentId
                });
            } else {
                logger.warn(`[MEMORY] No memory fragment ID found in narrative state`);
            }
            
            // Return a final response with conversationEnded flag
            return {
                response: "That's wonderful! I'm looking forward to our future conversations. I need to run now and get ready for the show, but feel free to reach out anytime you want to chat about life experiences!",
                nextNode: ConversationNodeType.CASUAL_CONVERSATION,
                updatedState: {
                    currentNode: ConversationNodeType.CASUAL_CONVERSATION,
                    hasMetBefore: true,
                    engagementLevel: 4,
                    revealMade: false,
                    userAcceptedActivity: false,
                    lastInteractionDate: new Date()
                },
                metadata: {
                    conversationEnded: true,  // Add this flag to trigger the modal
                    suggestedResponses: []
                }
            };
        }
        
        return null; // Return null if not handling this case
    }

    // Add this helper method
    public isPositiveResponse(message: string): boolean {
        const positivePatterns = [
            /yes/i, /sure/i, /okay/i, /ok/i, /definitely/i, /absolutely/i,
            /i'?d like that/i, /sounds good/i, /that works/i, /happy to/i
        ];
        
        return positivePatterns.some(pattern => pattern.test(message));
    }

    // Add this helper method to IntroductionFlowManager
    private getSessionKey(userId: string, agentId: string): string {
        return `${userId}-${agentId}`;
    }

    // In the IntroductionFlowManager class
    public async advanceToNextStage(nextStage: IntroductionStage, userId: string, narrativeState: AgentNarrativeState): Promise<any> {
        // Update the narrative state with the new stage
        narrativeState.introStage = nextStage;
        narrativeState.stageRepeatCount = 0; // Reset repeat count
        
        // Save the updated state
        await this.saveNarrativeState(userId, narrativeState);
        
        logger.info(`[FLOW] Advanced to stage: ${nextStage}`, {
            userId,
            previousStage: narrativeState.introStage,
            newStage: nextStage
        });
        
        // Generate response for the new stage
        return this.generateStageResponse(nextStage, { userId }, "");
    }

    // Add this method to the IntroductionFlowManager class
    public evaluateStoryQuality(message: string): boolean {
        // Simple implementation - check if the message is long enough to be a story
        if (message.length < 50) {
            return false;
        }
        
        // Check for narrative elements
        const narrativePatterns = [
            /when/i, /then/i, /after/i, /before/i, /during/i,
            /happened/i, /occurred/i, /experienced/i, /remember/i,
            /felt/i, /thought/i, /realized/i, /decided/i
        ];
        
        const hasNarrativeElements = narrativePatterns.some(pattern => pattern.test(message));
        
        return hasNarrativeElements;
    }
}

export class EnhancedLangGraph {
    private nodes: Map<ConversationNodeType, ConversationNode>;
    private agent?: AIAgent;
    private memoryService: MemoryService = new MemoryService();
    private currentState: ConversationState;
    private openai: OpenAI;
    private narrativeStates: Map<string, AgentNarrativeState> = new Map();
    private narrativeStateModel: any;
    private introFlowManager: IntroductionFlowManager;
    
    // Add these missing properties
    private edges: Map<string, Edge> = new Map();
    private memories: AIMemory[] = [];
    private activeIntroSessions: Map<string, IntroductionStage> = new Map();
    private initialNode: ConversationNodeType;
    private conversation: any;
    private agentId: string;

    constructor(
        agentId: string,
        config: EnhancedLangGraphConfig
    ) {
        this.nodes = config.nodes || new Map();
        this.edges = config.edges || new Map();
        this.memories = config.memories || [];
        this.agent = config.agent;
        this.agentId = agentId;
        this.initialNode = config.initialNode;
        this.conversation = config.conversation;
        
        // Initialize the narrative state model
        this.narrativeStateModel = mongoose.model('Conversation');
        
        // Initialize the current state
        this.currentState = {
            currentNode: this.initialNode,
            hasMetBefore: false,
            engagementLevel: 0,
            revealMade: false,
            userAcceptedActivity: false,
            lastInteractionDate: new Date()
        };
        
        // Initialize the OpenAI client
        this.openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });
        
        // Initialize the introduction flow manager
        this.introFlowManager = new IntroductionFlowManager(this.agentId, this);
        
        // Initialize the conversation nodes
        this.initializeConversationNodes();
        
        logger.info(`[GRAPH] Graph initialized`, {
            agentId: this.agentId,
            initialNode: this.initialNode,
            hasConversation: !!this.conversation
        });
    }
    
    // Add the missing extractAndSaveStoryDetails method
    private async extractAndSaveStoryDetails(userId: string, conversationHistory: ChatMessage[]): Promise<void> {
        if (!conversationHistory || conversationHistory.length < 4) {
            return; // Not enough conversation to extract details
        }
        
        try {
            // Find the request for a story and the user's response
            let storyPrompt = '';
            let storyResponse = '';
            
            for (let i = 0; i < conversationHistory.length - 1; i++) {
                const message = conversationHistory[i];
                
                // Look for the AI asking for a story
                if (message.role === 'assistant' && 
                    (message.content.includes("memorable experience") || 
                     message.content.includes("tell me about a time") || 
                     message.content.includes("share a story") ||
                     message.content.includes("tell me more about when and where"))) {
                    
                    // The next message should contain time/location details
                    if (i + 1 < conversationHistory.length && conversationHistory[i + 1].role === 'user') {
                        storyPrompt = message.content;
                        storyResponse = conversationHistory[i + 1].content;
                        break;
                    }
                }
            }
            
            if (!storyResponse) {
                return; // No story found
            }
            
            // Use OpenAI to extract key details
            const prompt = `
                Extract key details from this story:
                "${storyResponse}"
                
                Return a JSON object with:
                - timeframe: When this happened (year or period)
                - location: Where this happened
                - emotions: Main emotions expressed
                - significance: Why this seems important to the person
                - topics: Key topics or themes
            `;
            
            const completion = await this.openai.chat.completions.create({
                model: "gpt-3.5-turbo",
                messages: [{ role: "user", content: prompt }],
                temperature: 0.3,
                max_tokens: 500
            });
            
            const content = completion.choices[0]?.message?.content;
            if (!content) {
                return;
            }
            
            // Parse the JSON response
            try {
                const details = JSON.parse(content);
                
                // Save as a memory
                await this.memoryService.createMemory({
                    userId,
                    agentId: this.agentId,
                    content: storyResponse,
                    source: 'conversation',
                    type: 'personal_story',
                    metadata: {
                        timeframe: details.timeframe,
                        location: details.location,
                        emotions: details.emotions,
                        significance: details.significance,
                        topics: details.topics
                    },
                    importance: 8, // Personal stories are important
                    createdAt: new Date()
                });
                
                logger.info(`[MEMORY] Extracted and saved story details`, {
                    userId,
                    agentId: this.agentId,
                    timeframe: details.timeframe,
                    topics: details.topics
                });
                
            } catch (error) {
                logger.error(`[MEMORY] Error parsing story details`, error);
            }
            
        } catch (error) {
            logger.error(`[MEMORY] Error extracting story details`, error);
        }
    }

    private initializeNodes() {
        // Add default nodes with proper handlers
        this.addNode({
            id: ConversationNodeType.ENTRY,
            nodeType: 'greeting',
            content: "Welcome! How can I help you today?",
            responses: ["Hi!", "Hello!"],
            nextNodes: [ConversationNodeType.CASUAL_CONVERSATION],
            handler: async (message: string, state: ConversationState, context: any) => {
                console.log('Entry node handler executing:', { 
                    currentNode: state.currentNode,
                    hasMetBefore: state.hasMetBefore,
                    message 
                });
                
                const response = context.agent?.name ? 
                    `Hi! I'm ${context.agent.name}. How can I help you today?` :
                    "Welcome! How can I help you today?";
                    
                return {
                    response,
                    nextNode: ConversationNodeType.CASUAL_CONVERSATION,
                    updatedState: {
                        ...state,
                        hasMetBefore: true
                    }
                };
            }
        });

        // Casual Conversation Node
        this.nodes.set(ConversationNodeType.CASUAL_CONVERSATION, {
            id: ConversationNodeType.CASUAL_CONVERSATION,
            nodeType: 'dialogue',
            content: '',
            responses: [],
            nextNodes: [ConversationNodeType.REVEAL_OPPORTUNITY, ConversationNodeType.CASUAL_CONVERSATION],
            handler: async (message, state, context) => {
                console.log('CASUAL_CONVERSATION handler - Context:', {
                    messageCount: context.recentMessages.length,
                    hasMemories: (context.relevantMemories || []).length > 0
                });
                
                // Create a more personalized prompt that emphasizes continuity
                const prompt = `You are ${context.agent.name}, a ${context.agent.category} professional.
                    Your personality: ${context.agent.traits?.core?.join(', ')}
                    
                    IMPORTANT: This is a CONTINUING CONVERSATION. You've already introduced yourself.
                    The user's name is ${context.recentMessages.find((m: Message) => m.role === 'user')?.content?.split(' ')[0] || 'the user'}.
                    
                    Respond naturally to: "${message}"
                    
                    DO NOT introduce yourself again or start a new conversation.
                    DO reference previous context when appropriate.
                    STAY in character as ${context.agent.name}.`;
                    
                const response = await this.generateResponse(prompt, context);

                const shouldReveal = await this.checkForRevealOpportunity(
                    message, 
                    state,
                    context
                );

                // Only create memory if significant moment detected
                let memoryToCreate: Partial<MemoryFragment> | undefined;
                const significance = await this.analyzeSignificance(message, response);
                
                if (significance > 0.7) {
                    memoryToCreate = {
                        title: await this.generateMemoryTitle(message),
                        description: message,
                        date: {
                            timestamp: new Date(),
                            timePeriod: getTimePeriod(new Date())
                        },
                        context: {
                            emotions: await this.detectEmotions(message),
                            significance,
                            themes: await this.extractThemes(message)
                        },
                        status: 'complete'
                    };
                }

                return {
                    response,
                    nextNode: shouldReveal ? 
                        ConversationNodeType.REVEAL_OPPORTUNITY : 
                        ConversationNodeType.CASUAL_CONVERSATION,
                    updatedState: {
                        ...state,
                        engagementLevel: this.calculateEngagement(message, response)
                    },
                    memoryToCreate
                };
            }
        });

        // Reveal Opportunity Node
        this.nodes.set(ConversationNodeType.REVEAL_OPPORTUNITY, {
            id: ConversationNodeType.REVEAL_OPPORTUNITY,
            nodeType: 'dialogue',
            content: '',
            responses: [],
            nextNodes: [ConversationNodeType.CASUAL_CONVERSATION],
            handler: async (message, state, context) => {
                const response = await this.generateResponse(
                    this.createRevealPrompt(),
                    context
                );

                const memoryToCreate: Partial<MemoryFragment> = {
                    title: `${this.agent?.name} Activity Reveal`,
                    description: `Revealed ${this.getAgentActivity()} opportunity`,
                    date: {
                        timestamp: new Date(),
                        timePeriod: getTimePeriod(new Date())
                    },
                    context: {
                        emotions: ['excited', 'encouraging'],
                        significance: 0.9,
                        themes: ['opportunity', this.getAgentActivity()]
                    },
                    status: 'complete'
                };

                return {
                    response,
                    nextNode: ConversationNodeType.CASUAL_CONVERSATION,
                    updatedState: {
                        ...state,
                        revealMade: true
                    },
                    memoryToCreate
                };
            }
        });

        // Mini Game Node
        this.nodes.set(ConversationNodeType.MINI_GAME, {
            id: ConversationNodeType.MINI_GAME,
            nodeType: 'dialogue',
            content: '',
            responses: [],
            nextNodes: [ConversationNodeType.CASUAL_CONVERSATION],
            handler: async (message, state, context) => {
                const activity = this.getAgentActivity();
                const response = await this.generateResponse(
                    this.createActivityPrompt(activity),
                    context
                );

                // Simple completion check - if user says something like "thanks" or "goodbye"
                const isComplete = message.toLowerCase().match(/thank|bye|goodbye|done|finish/);

                return {
                    response,
                    nextNode: isComplete ? 
                        ConversationNodeType.CASUAL_CONVERSATION : 
                        ConversationNodeType.MINI_GAME,
                    updatedState: {
                        ...state,
                        userAcceptedActivity: true
                    }
                };
            }
        });
    }

    private async analyzeSignificance(message: string, response: string): Promise<number> {
        // Implement significance analysis
        // This could use the OpenAI API to analyze the conversation
        return 0.5; // Placeholder
    }

    private async detectEmotions(message: string): Promise<string[]> {
        // Implement emotion detection
        return ['interested']; // Placeholder
    }

    // Create a unified response generation system
    private async generateResponse(
        prompt: string,
        context: any,
        options: {
            temperature?: number;
            maxTokens?: number;
            includeMemories?: boolean;
            includeHistory?: boolean;
        } = {}
    ): Promise<string> {
        const { temperature = 0.7, maxTokens = 500, includeMemories = true, includeHistory = true } = options;
        
        // Build the system message
        let systemMessage = `You are ${context.agent?.name}, a ${context.agent?.category} professional.`;
        
        // Add agent personality if available
        if (context.agent?.personality) {
            systemMessage += `\n\nPersonality: ${context.agent.personality}`;
        }
        
        // Add memories if requested
        let memoryContext = '';
        if (includeMemories && context.memories && context.memories.length > 0) {
            memoryContext = '\n\nRelevant memories:\n' + 
                context.memories.map((m: AIMemory) => `- ${m.content}`).join('\n');
        }
        
        // Add conversation history if requested
        let historyContext = '';
        if (includeHistory && context.conversationHistory && context.conversationHistory.length > 0) {
            // Only include the last few messages to avoid token limits
            const recentHistory = context.conversationHistory.slice(-5);
            historyContext = '\n\nRecent conversation:\n' + 
                recentHistory.map((m: ChatMessage) => `${m.role === 'user' ? 'User' : 'You'}: ${m.content}`).join('\n');
        }
        
        // Combine all context
        const fullPrompt = `${systemMessage}\n${memoryContext}\n${historyContext}\n\n${prompt}`;
        
        try {
            const response = await this.openai.chat.completions.create({
                model: 'gpt-4o',
                messages: [{ role: 'system', content: fullPrompt }],
                temperature,
                max_tokens: maxTokens
            });
            
            return response.choices[0]?.message?.content || "I'm not sure how to respond to that.";
        } catch (error) {
            console.error('Error generating response:', error);
            return "I'm having trouble processing that right now.";
        }
    }

    private createFirstMeetingPrompt(): string {
        // Implement first meeting prompt creation logic
        return "First meeting prompt"; // Placeholder
    }

    private createPersonalityPrompt(context: {
        recentMessages: Message[];
        relevantMemories: AIMemory[];
    }): string {
        const memoryContext = context.relevantMemories
            .map(m => `Previous memory: ${m.content}`)
            .join('\n');

        return `You are ${this.agent?.name}. ${this.agent?.bio[0]}

Your core traits are: ${this.agent?.traits?.core?.join(', ') || 'friendly and helpful'}
Speaking style: ${this.agent?.style?.speaking?.join(', ') || 'natural and engaging'}

Context:
${memoryContext}

Respond naturally while staying in character.`;
    }

    private async checkForRevealOpportunity(
        message: string,
        state: ConversationState,
        context: {
            recentMessages: Message[];
            relevantMemories: AIMemory[];
        }
    ): Promise<boolean> {
        // Don't reveal if engagement is too low or already revealed
        if (state.engagementLevel < 0.7 || state.revealMade) {
            return false;
        }

        // Check message context for opportunity
        const analysis = await this.openai.chat.completions.create({
            model: "gpt-4",
            messages: [{
                role: 'system',
                content: `Analyze if this is a good moment for ${this.agent?.name} to reveal their ${this.getAgentActivity()} opportunity. 
                         Consider: engagement level (${state.engagementLevel}), conversation flow, and user interest.
                         Respond with only "true" or "false".`
            }, {
                role: 'user',
                content: message
            }],
            temperature: 0.3,
            max_tokens: 5
        });

        return analysis.choices[0].message.content?.toLowerCase().includes('true') || false;
    }

    private getAgentActivity(): string {
        const activities: { [key: string]: string } = {
            'alex-rivers': 'podcast interview',
            'chef-isabella': 'cooking session',
            'morgan-chase': 'style consultation'
        };
        return activities[this.agent?.slug || 'default'] || 'collaboration';
    }

    private createRevealPrompt(): string {
        const reveals: { [key: string]: string } = {
            'alex-rivers': "I'd love to have you share your story on my podcast",
            'chef-isabella': "We should cook something together",
            'morgan-chase': "I'd love to help style you"
        };

        return `As ${this.agent?.name}, naturally suggest: "${reveals[this.agent?.slug || 'default'] || 'working together'}"
                Make it feel organic and based on the conversation.
                Be encouraging but not pushy.`;
    }

    private calculateEngagement(message: string, response: string): number {
        // Simple engagement calculation based on message length and response
        const messageLength = message.length;
        const responseLength = response.length;
        
        // Longer messages indicate more engagement
        const lengthScore = Math.min(messageLength / 100, 1);
        
        // More detailed responses for engaged conversations
        const responseScore = Math.min(responseLength / 200, 1);
        
        return (lengthScore + responseScore) / 2;
    }

    private createActivityPrompt(activity: string): string {
        const prompts: { [key: string]: string } = {
            'podcast interview': `As ${this.agent?.name}, ask engaging follow-up questions about their story. Keep it conversational and encouraging.`,
            'cooking session': `As ${this.agent?.name}, discuss their favorite recipes and cooking experiences. Offer simple tips and encouragement.`,
            'style consultation': `As ${this.agent?.name}, discuss their style preferences and offer basic fashion advice. Keep it friendly and supportive.`
        };
        return prompts[activity] || "Let's explore this activity together...";
    }

    // Add this function to fix the suggested responses timing
    private fixSuggestedResponsesTiming(result: any, currentStage: IntroductionStage): any {
        // If we're at ESTABLISH_SCENARIO, we need to attach the suggested responses
        if (currentStage === IntroductionStage.ESTABLISH_SCENARIO) {
            console.log('[DEBUG] Fixing suggested responses timing for ESTABLISH_SCENARIO');
            
            // Hardcode the responses since we can't access the private method
            result.metadata = result.metadata || {};
            result.metadata.suggestedResponses = [
                "Oh no, that's unfortunate",
                "Sorry to hear that. What will you do?",
                "That sounds stressful. How can I help?"
            ];
            
            console.log('[DEBUG] Added suggested responses to result:', result.metadata.suggestedResponses);
        }
        
        return result;
    }

    // Update the processInput method to use the new function
    async processInput(
        message: string,
        context: {
            agent: AIAgent;
            userId: string;
            memories?: AIMemory[];
            conversationHistory?: ChatMessage[];
            currentNode?: ConversationNodeType;
        }
    ): Promise<{
        response: string;
        nextNode: ConversationNodeType;
        updatedState: ConversationState;
        metadata?: { conversationEnded?: boolean };
    }> {
        // Get or initialize narrative state
        const sessionKey = this.getSessionKey(context.userId, this.agentId);
        let narrativeState = await this.getNarrativeState(context.userId);
        
        // Sync the current node from the database if needed
        if (context.currentNode && this.currentState.currentNode !== context.currentNode) {
            logger.info(`[FLOW] Syncing current node from database: ${context.currentNode} (was: ${this.currentState.currentNode})`);
            this.currentState.currentNode = context.currentNode;
        }
        
        logger.info(`[FLOW] Processing input for agent ${context.agent.slug}`, {
            userId: context.userId,
            currentNode: this.currentState.currentNode,
            hasCompletedIntro: narrativeState.hasCompletedIntroduction,
            introStage: narrativeState.introStage,
            message: message.substring(0, 50) + (message.length > 50 ? '...' : '')
        });
        

        const shouldUseIntroFlow = 
            !narrativeState.hasCompletedIntroduction && 
            narrativeState.introStage && 
            this.currentState.currentNode === ConversationNodeType.ENTRY;
        
        logger.info(`[FLOW] Flow decision`, {
            shouldUseIntroFlow,  // Use the variable that's defined in this scope
            condition1: !narrativeState.hasCompletedIntroduction,
            condition2: !!narrativeState.introStage,
            condition3: this.currentState.currentNode === ConversationNodeType.ENTRY
        });
        
        if (shouldUseIntroFlow) {
            const currentStage = this.getIntroductionStage(context.userId) || IntroductionStage.INITIAL_GREETING;
            logger.info(`[FLOW] Using introduction flow - Stage: ${currentStage}`);
            
            // Process the message using the introduction flow
            let result = await this.handleIntroductionFlow(
                message,
                context,
                context.userId,
                await this.getNarrativeState(context.userId)
            );
            
            // Fix the suggested responses timing
            result = this.fixSuggestedResponsesTiming(result, currentStage);
            
            // Log the result to verify suggested responses are included
            logger.info(`[FLOW] Introduction flow result`, {
                nextNode: result.nextNode,
                responsePreview: result.response.substring(0, 50) + "...",
                metadata: result.metadata
            });
            
            // Force the next node to be CASUAL_CONVERSATION to ensure proper transition
            result.nextNode = ConversationNodeType.CASUAL_CONVERSATION;
            result.updatedState = {
                ...result.updatedState,
                currentNode: ConversationNodeType.CASUAL_CONVERSATION
            };
            
            return result;
        }
        
        logger.info(`[FLOW] Using regular conversation flow - Node: ${this.currentState.currentNode}`);
        
        // If we're not in the introduction flow or it's already completed,
        // handle regular conversation
        const result = await this.processRegularConversation(message, context, narrativeState);
        
        logger.info(`[FLOW] Regular conversation result`, {
            nextNode: result.nextNode,
            responsePreview: result.response.substring(0, 50) + (result.response.length > 50 ? '...' : ''),
            metadata: result.metadata
        });
        
        return result;
    }

    // Update the handleIntroductionFlow method
    private async handleIntroductionFlow(
        message: string,
        context: any,
        sessionKey: string,
        narrativeState: AgentNarrativeState
    ): Promise<any> {
        console.log(`[DEBUG] handleIntroductionFlow called with stage: ${narrativeState.introStage}, message: ${message.substring(0, 30)}...`);
        
        // Make sure we have a valid stage
        let currentStage = narrativeState.introStage || IntroductionStage.INITIAL_GREETING;
        console.log(`Processing introduction flow, current stage: ${currentStage}`);
        
        // Check if we should handle this with the dedicated method
        const introFlowResult = await this.introFlowManager.handleIntroductionFlow(message, context, sessionKey, narrativeState);
        if (introFlowResult) {
            return introFlowResult;
        }
        
        // Handle each stage of the introduction flow
        switch (currentStage) {
            case IntroductionStage.INITIAL_GREETING:
                // Handle initial greeting
                logger.debug(`Standard stage ${currentStage}, advancing with any response`);
                return this.advanceToNextStage(IntroductionStage.ESTABLISH_SCENARIO, context.userId, narrativeState);
                
            case IntroductionStage.ESTABLISH_SCENARIO:
                // Handle scenario establishment
                logger.debug(`Standard stage ${currentStage}, advancing with any response`);
                return this.advanceToNextStage(IntroductionStage.SEEK_HELP, context.userId, narrativeState);
                
            case IntroductionStage.SEEK_HELP:
                // Check if user agrees to help
                const userAgreement = this.isPositiveResponse(message);
                logger.debug(`At SEEK_HELP, user agreement: ${userAgreement}`);
                
                if (userAgreement) {
                    return this.advanceToNextStage(IntroductionStage.FIRST_FRAGMENT, context.userId, narrativeState);
                } else {
                    // Handle rejection - maybe try again or move to a different path
                    return this.advanceToNextStage(IntroductionStage.FIRST_FRAGMENT, context.userId, narrativeState);
                }
                
            case IntroductionStage.FIRST_FRAGMENT:
                // Evaluate the quality of the story
                const hasQualityStory = this.evaluateStoryQuality(message);
                logger.debug(`At FIRST_FRAGMENT, story quality assessment: ${hasQualityStory}`);
                
                // THIS IS WHERE WE NEED TO ADD THE MEMORY FRAGMENT CREATION
                if (hasQualityStory) {
                    // Create memory fragment here
                    await this.graph.handleStageFirstFragment(message, context, narrativeState);
                    
                    return this.advanceToNextStage(IntroductionStage.FOLLOW_UP, context.userId, narrativeState);
                } else {
                    // If story quality is poor, ask for more details
            return {
                        response: "That's interesting, but could you share a bit more detail? Maybe something specific that happened?",
                        nextNode: ConversationNodeType.ENTRY,
                        metadata: {}
                    };
                }
                
            case IntroductionStage.FOLLOW_UP:
                // Handle follow-up questions
                logger.debug(`Standard stage ${currentStage}, advancing with any response`);
                return this.advanceToNextStage(IntroductionStage.EXPRESS_GRATITUDE, context.userId, narrativeState);
                
            case IntroductionStage.EXPRESS_GRATITUDE:
                // Handle expression of gratitude
                logger.debug(`Standard stage ${currentStage}, advancing with any response`);
                return this.advanceToNextStage(IntroductionStage.ESTABLISH_RELATIONSHIP, context.userId, narrativeState);
                
            case IntroductionStage.ESTABLISH_RELATIONSHIP:
                // Handle establishment of relationship
                logger.debug(`Standard stage ${currentStage}, advancing with any response`);
                return this.advanceToNextStage(IntroductionStage.ESTABLISH_RELATIONSHIP, context.userId, narrativeState);
                
            default:
                logger.error(`[FLOW] Unexpected stage: ${currentStage}`);
                return {
                    response: "I'm not sure how to respond to that.",
                    nextNode: ConversationNodeType.CASUAL_CONVERSATION,
                    updatedState: this.currentState,
                    metadata: {}
                };
        }
    }

    // Update the advanceIntroductionStage method to handle the new stages
    private advanceIntroductionStage(currentStage: IntroductionStage): IntroductionStage {
        // Define the stage progression
        const stageProgression = {
            [IntroductionStage.INITIAL_GREETING]: IntroductionStage.ESTABLISH_SCENARIO,
            [IntroductionStage.ESTABLISH_SCENARIO]: IntroductionStage.SEEK_HELP,
            [IntroductionStage.SEEK_HELP]: IntroductionStage.FIRST_FRAGMENT,
            [IntroductionStage.FIRST_FRAGMENT]: IntroductionStage.FOLLOW_UP,
            [IntroductionStage.FOLLOW_UP]: IntroductionStage.EXPRESS_GRATITUDE,
            [IntroductionStage.EXPRESS_GRATITUDE]: IntroductionStage.ESTABLISH_RELATIONSHIP,
            [IntroductionStage.ESTABLISH_RELATIONSHIP]: IntroductionStage.ESTABLISH_RELATIONSHIP
        };
        
        // Get the next stage from the progression map
        const nextStage = stageProgression[currentStage] || IntroductionStage.INITIAL_GREETING;
        
        console.log(`[DEBUG] Advancing from stage ${currentStage} to ${nextStage}`);
        return nextStage;
    }

    // Fix the getCurrentIntroductionStage method to use the new stage names
    private getCurrentIntroductionStage(conversationHistory: ChatMessage[]): IntroductionStage | null {
        if (!conversationHistory || conversationHistory.length < 2) {
            console.log("Not enough conversation history to determine stage");
            return null;
        }
        
        // Get all AI messages and sort by timestamp (newest first)
        const aiMessages = conversationHistory
            .filter(msg => msg.role === 'assistant')
            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        
        if (aiMessages.length === 0) return null;
        
        // Check each message for stage markers, starting with the most recent
        for (const message of aiMessages) {
            console.log("Checking message:", message.content.substring(0, 30) + "...");
            
            if (message.content.includes("Oh! Hi there! I'm Alex Rivers")) {
                return IntroductionStage.INITIAL_GREETING;
            }
            if (message.content.includes("My guest just canceled last minute")) {
                return IntroductionStage.ESTABLISH_SCENARIO;
            }
            if (message.content.includes("Since you're here, maybe you could help")) {
                return IntroductionStage.SEEK_HELP;
            }
            if (message.content.includes("My listeners love a good time piece")) {
                return IntroductionStage.FIRST_FRAGMENT;
            }
            if (message.content.includes("That's fascinating! Tell me more")) {
                return IntroductionStage.FOLLOW_UP;
            }
            if (message.content.includes("That's brilliant! Thank you")) {
                return IntroductionStage.EXPRESS_GRATITUDE;
            }
            if (message.content.includes("I'd love to chat with you again")) {
                return IntroductionStage.ESTABLISH_RELATIONSHIP;
            }
        }
        
        // If no match found, use the database-stored stage
        return null;
    }

    // Fix the initializeNarrativeState method to handle introStage property
    private async initializeNarrativeState(userId: string): Promise<AgentNarrativeState> {
        const sessionKey = this.getSessionKey(userId, this.agentId);
        
        // Check if we already have it in memory
        if (this.narrativeStates.has(sessionKey)) {
            return this.narrativeStates.get(sessionKey)!;
        }
        
        // Otherwise load from database
        try {
            const conversation = await ConversationModel.findOne({
                userId,
                agentId: this.agentId,
                active: true
            });
            
            if (conversation?.narrativeState) {
                // If we have a stored introduction stage, set it in the active sessions
                if ('introStage' in conversation.narrativeState) {
                    this.activeIntroSessions.set(
                        sessionKey, 
                        conversation.narrativeState.introStage as IntroductionStage
                    );
                    console.log(`Loaded introduction stage from database: ${conversation.narrativeState.introStage}`);
                }
                
                // Store in memory
                this.narrativeStates.set(sessionKey, conversation.narrativeState);
                return conversation.narrativeState;
            }
        } catch (error) {
            console.error('Error loading narrative state:', error);
        }
        
        // Create default state if not found
        const defaultState: AgentNarrativeState = {
            hasCompletedIntroduction: false,
            relationshipStage: 'stranger',
            knownTopics: [],
            sharedStories: [],
            lastInteractionTimestamp: new Date(),
            agentSpecificState: {},
            introStage: IntroductionStage.INITIAL_GREETING
        };
        
        this.narrativeStates.set(sessionKey, defaultState);
        return defaultState;
    }

    // Fix the saveIntroductionStage method to properly update the database
    private async saveIntroductionStage(userId: string, stage: IntroductionStage): Promise<void> {
        try {
            const result = await ConversationModel.updateOne(
                { userId, agentId: this.agentId, active: true },
                { 
                    $set: { 
                        'narrativeState.introStage': stage 
                    } 
                }
            );
            console.log(`Saved introduction stage to database: ${stage}`, result);
            
            // Also update the local cache
            this.activeIntroSessions.set(this.getSessionKey(userId, this.agentId), stage);
        } catch (error) {
            console.error('Error saving introduction stage:', error);
        }
    }

    public getNodes(): Map<ConversationNodeType, ConversationNode> {
        return this.nodes;
    }

    public addNode(node: {
        id: ConversationNodeType;
        nodeType: string;
        content: string;
        responses: string[];
        nextNodes: ConversationNodeType[];
        handler: (
            message: string, 
            state: ConversationState, 
            context: any
        ) => Promise<{
            response: string;
            nextNode: ConversationNodeType;
            updatedState: Partial<ConversationState>;
            metadata?: { conversationEnded?: boolean }; // Add optional metadata property
        }>;
    }) {
        this.nodes.set(node.id, {
            id: node.id,
            nodeType: node.nodeType,
            content: node.content,
            responses: node.responses,
            nextNodes: node.nextNodes,
            handler: node.handler
        });
    }

    // Add a method to update the current state from database
    public updateState(updates: Partial<ConversationState>): void {
        // Update the current state with the provided updates
        this.currentState = {
            ...this.currentState,
            ...updates
        };
        
        // Ensure currentNode is always defined
        if (!this.currentState.currentNode) {
            this.currentState.currentNode = ConversationNodeType.ENTRY;
        }
    }

    // Generate a session key for state management
    public getSessionKey(userId: string, agentId: string): string {
        return `${userId}-${agentId}`;
    }

    // Handle regular conversation after introduction is complete
    private async handleCasualConversation(
        message: string,
        context: {
            agent: AIAgent;
            userId: string;
            memories?: AIMemory[];
            conversationHistory?: ChatMessage[];
        },
        narrativeState: AgentNarrativeState
    ): Promise<{
        response: string;
        nextNode: ConversationNodeType;
        updatedState: ConversationState;
    }> {
        console.log('Processing regular conversation');
        
        // Use the casual conversation node
        const currentNode = this.nodes.get(ConversationNodeType.CASUAL_CONVERSATION);
        if (!currentNode) {
            throw new Error(`Invalid node: ${ConversationNodeType.CASUAL_CONVERSATION}`);
        }
        
        // Process through node handler
        const result = await currentNode.handler(message, this.currentState, {
            recentMessages: context.conversationHistory || [],
            relevantMemories: context.memories || [],
            agent: context.agent,
            narrativeState
        });
        
        // Update relationship based on conversation
        this.updateRelationship(narrativeState, message, result.response);
        
        // Save updated narrative state
        await this.saveNarrativeState(context.userId, narrativeState);
        
        return {
            response: result.response,
            nextNode: result.nextNode,
            updatedState: {
                currentNode: result.nextNode,
                hasMetBefore: true,
                engagementLevel: result.updatedState.engagementLevel ?? this.currentState.engagementLevel,
                revealMade: result.updatedState.revealMade ?? this.currentState.revealMade,
                userAcceptedActivity: result.updatedState.userAcceptedActivity ?? this.currentState.userAcceptedActivity,
                lastInteractionDate: new Date()
            }
        };
    }

    // Update relationship based on conversation
    private updateRelationship(
        narrativeState: AgentNarrativeState, 
        userMessage: string, 
        aiResponse: string
    ): void {
        // Extract topics from conversation
        const newTopics = this.extractTopics(userMessage, aiResponse);
        narrativeState.knownTopics = [...new Set([...narrativeState.knownTopics, ...newTopics])];
        
        // Update last interaction
        narrativeState.lastInteractionTimestamp = new Date();
        
        // Potentially upgrade relationship stage based on interaction count
        if (narrativeState.relationshipStage === 'acquaintance' && 
            narrativeState.knownTopics.length > 5) {
            narrativeState.relationshipStage = 'friend';
        }
    }

    // Extract topics from conversation
    private extractTopics(userMessage: string, aiResponse: string): string[] {
        // Simple implementation - could use NLP or OpenAI for better extraction
        const combinedText = `${userMessage} ${aiResponse}`.toLowerCase();
        const potentialTopics = [
            'sports', 'music', 'movies', 'books', 'travel', 'food', 
            'technology', 'politics', 'family', 'work', 'hobbies'
        ];
        
        return potentialTopics.filter(topic => combinedText.includes(topic));
    }

    // Save narrative state to database
    private async saveNarrativeState(userId: string, narrativeState: AgentNarrativeState): Promise<any> {
        try {
            // Use the Conversation model directly
            const result = await this.narrativeStateModel.findOneAndUpdate(
            { userId, agentId: this.agentId, active: true },
            { $set: { narrativeState } },
                { new: true }
            );
            
            // Rest of the method...
        } catch (error) {
            console.error('Error saving narrative state:', error);
            throw error;
        }
    }

    // Get introduction message for a specific stage
    private getIntroductionMessage(agent: AIAgent, stage: IntroductionStage): IntroductionPrompt {
        console.log(`[DEBUG] Getting introduction message for stage: ${stage}`);
        
        const introScripts: Record<string, Record<IntroductionStage, IntroductionPrompt>> = {
            'alex-rivers': {
                [IntroductionStage.INITIAL_GREETING]: {
                    agentMessage: "Oh! Hi there! I'm Alex Rivers from the Life Stories podcast. Sorry if I seem a bit frazzled at the moment. *extends hand* I didn't catch your name?",
                    expectedResponseType: 'name',
                    fallbackPrompt: "I like to know who I'm talking with. What should I call you?"
                },
                
                [IntroductionStage.ESTABLISH_SCENARIO]: {
                    agentMessage: "I'm actually in a bit of a bind. I'm supposed to record an episode today about memorable life experiences, but my guest just canceled. I'm trying to figure out what to do now.",
                    expectedResponseType: 'acknowledgment',
                    fallbackPrompt: "Have you ever had something important fall through at the last minute?",
                    suggestedResponses: [
                        "Oh no, that's unfortunate",
                        "Sorry to hear that. What will you do?",
                        "That sounds stressful. How can I help?"
                    ]
                },
                
                [IntroductionStage.SEEK_HELP]: {
                    agentMessage: "You know what? Since you're here, maybe you could help me out. I know we just met and everything but I could really use a lifeline here. What do you say?",
                    expectedResponseType: 'agreement',
                    fallbackPrompt: "You'd really be doing me a solid... please?",
                    suggestedResponses: [
                        "Sure, I'll help",
                        "I don't know...",
                        "What would I need to do?"
                    ]
                },
                
                [IntroductionStage.FIRST_FRAGMENT]: {
                    agentMessage: "My listeners love a good time piece, can you think of an extraordinary historic event you've lived through? I know for me I can't help but think of the fact I lived to see Space X catching a re-usable rocket! What comes to mind for you?",
                    expectedResponseType: 'story',
                    fallbackPrompt: "It doesn't have to be something huge - sometimes it's the unexpected small moments that make the best stories. Maybe something surprising that happened to you?"
                },
                
                [IntroductionStage.FOLLOW_UP]: {
                    agentMessage: "That's fascinating! Tell me more about when and where this happened. The context adds so much to a story.",
                    expectedResponseType: 'details',
                    fallbackPrompt: "Could you share a bit more about when and where this took place?"
                },
                
                [IntroductionStage.EXPRESS_GRATITUDE]: {
                    agentMessage: "This is gold! *excitedly taking notes* Thank you so much for sharing that. It's exactly the kind of authentic story our listeners connect with.",
                    expectedResponseType: 'acknowledgment',
                    fallbackPrompt: "How do you feel about sharing your story with others?",
                    suggestedResponses: [
                        "You're welcome",
                        "Happy to help",
                        "No problem"
                    ]
                },
                
                [IntroductionStage.ESTABLISH_RELATIONSHIP]: {
                    agentMessage: "You know, you have a real gift for storytelling. I'd love to have you back on the show sometime to explore more of your experiences. Would that be something you'd be interested in?",
                    expectedResponseType: 'agreement',
                    fallbackPrompt: "Either way, I really appreciate your help today.",
                    suggestedResponses: [
                        "I'd like that",
                        "Maybe another time",
                        "Thanks for the offer"
                    ]
                }
            },
            
            'chef-isabella': {
                [IntroductionStage.INITIAL_GREETING]: {
                    agentMessage: "*wiping hands on apron* Oh! Hello there! I didn't hear you come in over all this chopping. I'm Isabella, head chef here. *warm smile* And you are...?",
                    expectedResponseType: 'name',
                    fallbackPrompt: "I like to know who I'm sharing my kitchen with. What's your name?"
                },
                
                [IntroductionStage.ESTABLISH_SCENARIO]: {
                    agentMessage: "Wonderful to meet you, {userName}! *stirs pot nervously* I could actually use a fresh perspective. I'm creating a special menu for an important client, and I'm stuck on the dessert course. It needs to evoke a sense of nostalgia but with a modern twist.",
                    expectedResponseType: 'acknowledgment',
                    fallbackPrompt: "Have you ever tried to recreate a special memory through food?"
                },
                
                [IntroductionStage.SEEK_HELP]: {
                    agentMessage: "*tastes from pot, frowns slightly* I believe food is deeply connected to our most cherished memories. *looks up* Everyone has at least one food memory that takes them back to a specific moment in their life. *curious expression* What about you, {userName}? Is there a special meal or food experience from your past that stands out in your memory?",
                    expectedResponseType: 'personal_story',
                    fallbackPrompt: "Maybe a family recipe? A special celebration? Even something simple like ice cream on a summer day can hold powerful memories."
                },
                
                [IntroductionStage.FIRST_FRAGMENT]: {
                    agentMessage: "*eyes widen with interest* That sounds wonderful! *puts down spoon* Could you tell me more about when this happened? What year was it, and what made this food experience so special to you? The details might help me capture that feeling in my new dish.",
                    expectedResponseType: 'story_details',
                    fallbackPrompt: "The specific details really help - when it happened, the setting, the people involved. Those are the elements I try to translate into flavor."
                },
                
                [IntroductionStage.EXPRESS_GRATITUDE]: {
                    agentMessage: "*already jotting notes in a small recipe book* This is exactly what I needed, {userName}! *excited* Food is always about stories and connections. How do you think that experience influenced your relationship with food or shaped your memories?",
                    expectedResponseType: 'reflection',
                    fallbackPrompt: "Food memories often stay with us because they connect to something deeper than just taste - they connect to how we felt in that moment."
                },
                
                [IntroductionStage.ESTABLISH_RELATIONSHIP]: {
                    agentMessage: "*closes recipe book* I can't thank you enough. You've helped me remember why I became a chef in the first place. *smiles warmly* Listen, {userName}, I host these small tasting events every month where I try out new recipe ideas. Very casual, just good food and conversation. I'd love for you to join sometime.",
                    expectedResponseType: 'agreement',
                    fallbackPrompt: "No pressure at all. But your perspective would be very welcome in my kitchen anytime."
                },
                [IntroductionStage.FOLLOW_UP]: {
                    agentMessage: "That sounds wonderful! Could you tell me more about when this happened? What year was it, and what made this food experience so special to you?",
                    expectedResponseType: "story_details",
                    fallbackPrompt: "Even just a general timeframe would help. Was this recent or from a while back?"
                }
            },
            
            'morgan-chase': {
                [IntroductionStage.INITIAL_GREETING]: {
                    agentMessage: "*looking up from a mood board* Oh! I didn't see you come in. *extends hand* Morgan Chase, fashion consultant. I'm just finalizing some concepts for a client. *gestures to chair* Make yourself comfortable. And you are...?",
                    expectedResponseType: 'name',
                    fallbackPrompt: "I like to know who I'm collaborating with. What's your name?"
                },
                
                [IntroductionStage.ESTABLISH_SCENARIO]: {
                    agentMessage: "Pleasure to meet you, {userName}. *sighs, looking at scattered fashion sketches* I'm actually facing a bit of a creative block. I'm designing a collection that needs to tell a personal story through clothing, but I'm struggling to find the right inspiration.",
                    expectedResponseType: 'acknowledgment',
                    fallbackPrompt: "Have you ever tried to express something personal through your style or appearance?"
                },
                
                [IntroductionStage.SEEK_HELP]: {
                    agentMessage: "*picks up and discards several fabric swatches* I believe style is a visual language that tells people who you are before you speak. *looks at you with curiosity* Everyone has at least one outfit or accessory that connects to a meaningful moment in their life. *tilts head* What about you? Is there a particular item of clothing or an outfit that holds a special memory or significance for you?",
                    expectedResponseType: 'personal_story',
                    fallbackPrompt: "Maybe something you wore for a special occasion? Or an item that reminds you of someone important? Even something simple can have a powerful story behind it."
                },
                
                [IntroductionStage.FIRST_FRAGMENT]: {
                    agentMessage: "*looks intrigued* That's actually really interesting, {userName}. *starts sketching something* Could you tell me more about when this was? What year, and what made this particular clothing item or outfit so meaningful to you?",
                    expectedResponseType: 'story_details',
                    fallbackPrompt: "The context really helps me understand the emotional connection. When did this happen, and what made it significant to you?"
                },
                
                [IntroductionStage.EXPRESS_GRATITUDE]: {
                    agentMessage: "*adding details to sketch* This is exactly what I needed—something authentic. *smiles* How do you think that experience influenced your personal style or how you view fashion now?",
                    expectedResponseType: 'reflection',
                    fallbackPrompt: "Our style often evolves based on meaningful experiences or realizations we have."
                },
                
                [IntroductionStage.ESTABLISH_RELATIONSHIP]: {
                    agentMessage: "*puts final touches on sketch* I can't thank you enough, {userName}. You've helped me remember that fashion should enhance the story someone is already telling. *tears sketch from book, offers it to you* A little thank you. *smiles* I do these style consultations from time to time—very low-key, just helping people find their authentic expression. I'd love to continue our conversation sometime.",
                    expectedResponseType: 'agreement',
                    fallbackPrompt: "No obligation. But authentic voices like yours help keep my work grounded in reality."
                },
                [IntroductionStage.FOLLOW_UP]: {
                    agentMessage: "That's intriguing! Could you tell me more about when this was? What year, and what made this particular clothing item or outfit so meaningful to you?",
                    expectedResponseType: "story_details",
                    fallbackPrompt: "Even just a rough idea of when this happened would be helpful. Was it recently or some time ago?"
                }
            }
        };

        // Get the message template for this agent and stage
        const agentSlug = agent?.slug || 'alex-rivers'; // Default to alex-rivers if no agent
        const agentMessages = introScripts[agentSlug] || introScripts['alex-rivers'];
        
        const messageTemplate = agentMessages[stage] || {
            agentMessage: "I'm not sure what to say next.",
            expectedResponseType: "any",
            fallbackPrompt: "Could you tell me more?",
            suggestedResponses: []
        };
        
        console.log(`[DEBUG] Message template for stage ${stage}:`, {
            messagePreview: messageTemplate.agentMessage.substring(0, 50) + "...",
            hasSuggestedResponses: !!messageTemplate.suggestedResponses,
            suggestedResponsesCount: messageTemplate.suggestedResponses?.length || 0,
            suggestedResponses: messageTemplate.suggestedResponses || []
        });
        
        return messageTemplate;
    }

    // Generate contextual response during introduction
    private async generateIntroContextualResponse(
        message: string,
        currentStage: IntroductionStage,
        context: {
            agent: AIAgent;
            conversationHistory?: ChatMessage[];
        }
    ): Promise<string> {
        // Create a prompt that maintains the narrative context
        const prompt = `You are ${context.agent.name}, a ${context.agent.category} professional.
          
          You are currently in the middle of your first meeting with someone new.
          You are in this situation: ${this.getIntroductionScenarioDescription(context.agent, currentStage)}
          
          The person just said: "${message}"
          
          Respond naturally while staying in character and maintaining the scenario described above.
          Keep your response focused on the current situation and moving the conversation forward.
          Do not resolve your problem yet - you still need their help.`;
        
        // Generate response using OpenAI
        const completion = await this.openai.chat.completions.create({
            model: "gpt-4",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.7,
            max_tokens: 150
        });
        
        return completion.choices[0].message.content || "I'm not sure how to respond to that.";
    }

    // Get description of the current scenario for contextual responses
    private getIntroductionScenarioDescription(agent: AIAgent, stage: IntroductionStage): string {
        const scenarios: Record<string, string> = {
            'alex-rivers': "You're a podcast host in a panic because your guest canceled last minute and you need new material fast for your show that's about to go live.",
            'chef-isabella': "You're a chef working on a new recipe for an important client, but you're missing that special something to make it truly memorable.",
            'morgan-chase': "You're a fashion consultant finalizing a new collection but stuck on the theme that needs to be both trendy and timeless."
        };
        
        return scenarios[agent.slug] || "You're meeting someone new and trying to establish a connection.";
    }

    // Update the completeIntroduction method to handle undefined narrative state
    private async completeIntroduction(
        userId: string, 
        narrativeState: AgentNarrativeState,
        conversationHistory?: ChatMessage[]
    ): Promise<void> {
        // Mark the introduction as completed
        narrativeState.hasCompletedIntroduction = true;
        
        // Update the relationship stage
        narrativeState.relationshipStage = 'acquaintance';
        
        // Save the updated state
        await this.saveNarrativeState(userId, narrativeState);
        
        // Update the current state
        this.currentState = {
            ...this.currentState,
            currentNode: ConversationNodeType.CASUAL_CONVERSATION,
            hasMetBefore: true,
            engagementLevel: 3,
            revealMade: false,
            userAcceptedActivity: false,
            lastInteractionDate: new Date()
        };
        
        // Extract story details if available
        if (conversationHistory && conversationHistory.length > 0) {
            await this.extractAndSaveStoryDetails(userId, conversationHistory);
        }
    }

    // Enhance the extractMemoryInfo method to get more detailed information
    private extractMemoryInfo(conversationHistory: ChatMessage[], userName: string): {
        title: string;
        description: string;
        date: {
            timestamp: Date;
            approximateDate: string;
            timePeriod: string;
        };
        location: {
            name: string;
        };
        people: Array<{
            name: string;
            relationship?: string;
        }>;
        context: {
            emotions: string[];
            significance: number;
            themes: string[];
        };
    } | null {
        try {
            // Find the user's story in the conversation
            let storyText = '';
            let timeInfo = '';
            let locationInfo = '';
            let peopleInfo: Array<{name: string, relationship?: string}> = [];
            let emotionsInfo: string[] = [];
            
            // Look for the reveal capabilities stage where the user shares their story
            for (let i = 0; i < conversationHistory.length; i++) {
                const message = conversationHistory[i];
                
                // Look for the agent asking about a memorable event
                if (message.role === 'assistant' && 
                    (message.content.includes("memorable or unusual event") || 
                     message.content.includes("particularly memorable") ||
                     message.content.includes("craziest thing you've ever"))) {
                    
                    // The next message should be the user's story
                    if (i + 1 < conversationHistory.length && conversationHistory[i + 1].role === 'user') {
                        storyText = conversationHistory[i + 1].content;
                    }
                }
                
                // Look for the agent asking about when/where it happened
                if (message.role === 'assistant' && 
                    (message.content.includes("When did this happen") || 
                     message.content.includes("What year was") ||
                     message.content.includes("tell me more about when and where"))) {
                    
                    // The next message should contain time/location details
                    if (i + 1 < conversationHistory.length && conversationHistory[i + 1].role === 'user') {
                        const detailsText = conversationHistory[i + 1].content;
                        
                        // Extract year/decade information
                        const yearPatterns = [
                            /in (\d{4})/i,
                            /around (\d{4})/i,
                            /during the (\d{4})s/i,
                            /back in (\d{4})/i,
                            /(\d{4})/  // Just look for a 4-digit number as fallback
                        ];
                        
                        for (const pattern of yearPatterns) {
                            const match = detailsText.match(pattern);
                            if (match && match[1]) {
                                timeInfo = match[1];
                                break;
                            }
                        }
                        
                        // Extract location information
                        const locationPatterns = [
                            /in ([A-Z][a-z]+ ?[A-Z]?[a-z]*)/i,
                            /at ([A-Z][a-z]+ ?[A-Z]?[a-z]*)/i,
                            /near ([A-Z][a-z]+ ?[A-Z]?[a-z]*)/i
                        ];
                        
                        for (const pattern of locationPatterns) {
                            const match = detailsText.match(pattern);
                            if (match && match[1]) {
                                locationInfo = match[1];
                                break;
                            }
                        }
                        
                        // Extract people mentioned
                        const peoplePatterns = [
                            /with ([A-Z][a-z]+)/i,
                            /my ([a-z]+) ([A-Z][a-z]+)/i,  // "my friend John", "my sister Sarah"
                            /([A-Z][a-z]+) and ([A-Z][a-z]+)/i  // "John and Sarah"
                        ];
                        
                        for (const pattern of peoplePatterns) {
                            const matches = detailsText.matchAll(pattern);
                            for (const match of matches) {
                                if (match[1] && /^[A-Z]/.test(match[1])) {
                                    peopleInfo.push({name: match[1]});
                                }
                                if (match[2] && /^[A-Z]/.test(match[2])) {
                                    const relationship = /^[a-z]/.test(match[1]) ? match[1] : undefined;
                                    peopleInfo.push({name: match[2], relationship});
                                }
                            }
                        }
                    }
                }
                
                // Look for emotional content
                if (message.role === 'user') {
                    const emotionWords = [
                        'happy', 'sad', 'excited', 'nervous', 'anxious', 'thrilled', 
                        'scared', 'proud', 'embarrassed', 'grateful', 'angry', 'surprised',
                        'worried', 'relieved', 'frustrated', 'amazed', 'confused'
                    ];
                    
                    for (const emotion of emotionWords) {
                        if (message.content.toLowerCase().includes(emotion)) {
                            emotionsInfo.push(emotion);
                        }
                    }
                }
            }
            
            // If we don't have a story, we can't create a memory
            if (!storyText) {
                return null;
            }
            
            // Generate a title based on the story
            const title = this.generateMemoryTitle(storyText);
            
            // Use the story as the description
            const description = storyText;
            
            // Create a timestamp - use the extracted year if available, otherwise current year
            const year = timeInfo ? parseInt(timeInfo) : new Date().getFullYear();
            const timestamp = new Date(year, 0, 1);  // January 1st of the year
            
            // Create an approximate date string
            const approximateDate = timeInfo ? 
                (timeInfo.length === 4 ? `${timeInfo}` : `${timeInfo}s`) : 
                'Unknown date';
            
            // Determine time period
            const timePeriod = this.getTimePeriodFromYear(year);
            
            // Use extracted location or default
            const location = {
                name: locationInfo || 'Unknown location'
            };
            
            // Extract themes from the story
            const themes = this.extractThemes(storyText);
            
            // If we don't have emotions from explicit words, infer some based on the story
            if (emotionsInfo.length === 0) {
                // Simple heuristic - look for positive/negative sentiment
                if (storyText.match(/amazing|wonderful|great|happy|joy|love|excited/i)) {
                    emotionsInfo.push('happy');
                    emotionsInfo.push('excited');
                } else if (storyText.match(/terrible|awful|sad|upset|angry|fear|scared/i)) {
                    emotionsInfo.push('sad');
                    emotionsInfo.push('anxious');
                } else {
                    emotionsInfo.push('reflective');  // Default emotion
                }
            }
            
            // Estimate significance based on story length and emotional content
            const significance = Math.min(5, Math.max(1, Math.floor(storyText.length / 100) + emotionsInfo.length));
            
            return {
                title,
                description,
                date: {
                    timestamp,
                    approximateDate,
                    timePeriod
                },
                location,
                people: peopleInfo,
                context: {
                    emotions: emotionsInfo,
                    significance,
                    themes
                }
            };
        } catch (error) {
            console.error('Error extracting memory info:', error);
            return null;
        }
    }

    // Helper method to determine time period from year
    private getTimePeriodFromYear(year: number): string {
        if (year < 1950) return 'distant_past';
        if (year < 1980) return 'childhood';
        if (year < 2000) return 'young_adult';
        if (year < 2010) return 'recent_past';
        return 'present';
    }

    // Enhanced method to extract themes
    private extractThemes(text: string): string[] {
        const themes = [];
        
        // Check for common themes
        const themePatterns = [
            { pattern: /family|parent|mother|father|sister|brother|grandparent/i, theme: 'family' },
            { pattern: /friend|friendship/i, theme: 'friendship' },
            { pattern: /school|college|university|education|learn/i, theme: 'education' },
            { pattern: /work|job|career|profession/i, theme: 'career' },
            { pattern: /travel|trip|journey|vacation|abroad|foreign/i, theme: 'travel' },
            { pattern: /love|relationship|date|romantic|partner/i, theme: 'relationships' },
            { pattern: /challenge|difficult|overcome|struggle/i, theme: 'challenges' },
            { pattern: /achievement|success|accomplish|proud/i, theme: 'achievements' },
            { pattern: /loss|grief|death|passed away/i, theme: 'loss' },
            { pattern: /celebration|party|wedding|birthday|holiday/i, theme: 'celebrations' },
            { pattern: /health|illness|hospital|sick|recover/i, theme: 'health' },
            { pattern: /adventure|exciting|thrill|risk/i, theme: 'adventure' },
            { pattern: /spiritual|faith|belief|religion|god/i, theme: 'spirituality' },
            { pattern: /art|music|creative|paint|draw|sing/i, theme: 'creativity' },
            { pattern: /nature|outdoor|hike|camp|environment/i, theme: 'nature' },
            { pattern: /technology|computer|digital|online|internet/i, theme: 'technology' },
            { pattern: /food|cook|meal|restaurant|recipe/i, theme: 'food' },
            { pattern: /sport|game|team|play|competition/i, theme: 'sports' },
            { pattern: /home|house|move|relocate/i, theme: 'home' },
            { pattern: /personal growth|change|transform|learn/i, theme: 'personal_growth' }
        ];
        
        for (const { pattern, theme } of themePatterns) {
            if (pattern.test(text)) {
                themes.push(theme);
            }
        }
        
        // If no themes detected, add a generic one
        if (themes.length === 0) {
            themes.push('life_experience');
        }
        
        return themes;
    }

    // Helper method to generate a title for the memory
    private generateMemoryTitle(story: string): string {
        // Extract the first sentence or up to 50 characters
        const firstSentence = story.split(/[.!?]/, 1)[0].trim();
        if (firstSentence.length <= 50) {
            return firstSentence;
        }
        
        // If the first sentence is too long, use the first 47 characters + "..."
        return firstSentence.substring(0, 47) + '...';
    }

    // Method to create a memory fragment
    private async createMemoryFragment(
        userId: string, 
        memoryInfo: {
            title: string;
            description: string;
            date: {
                timestamp: Date;
                approximateDate: string;
                timePeriod: string;
            };
            location: {
                name: string;
            };
            people: Array<{
                name: string;
                relationship?: string;
            }>;
            context: {
                emotions: string[];
                significance: number;
                themes: string[];
            };
        }
    ): Promise<void> {
        try {
            console.log('Creating memory fragment with info:', JSON.stringify(memoryInfo, null, 2));
            
            // Create the memory fragment object
            const memoryFragment = {
                title: memoryInfo.title,
                description: memoryInfo.description,
                date: {
                    timestamp: memoryInfo.date.timestamp,
                    approximateDate: memoryInfo.date.approximateDate,
                    timePeriod: memoryInfo.date.timePeriod
                },
                location: {
                    name: memoryInfo.location.name,
                    coordinates: {
                        latitude: null,
                        longitude: null
                    }
                },
                people: memoryInfo.people || [],
                tags: memoryInfo.context.themes,
                media: [],
                context: {
                    emotions: memoryInfo.context.emotions,
                    significance: memoryInfo.context.significance,
                    themes: memoryInfo.context.themes,
                    aiRelevance: 0.8
                },
                system: {
                    userId,
                    source: 'conversation',
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    version: 1
                },
                status: 'complete',
                missingFields: [],
                aiMemoryKey: `intro_memory_${Date.now()}`,
                conversationId: null
            };
            
            // Save the memory fragment to the database
            const MemoryFragmentModel = mongoose.model('MemoryFragment');
            const result = await MemoryFragmentModel.create(memoryFragment);
            
            console.log('Successfully created memory fragment:', result._id);
        } catch (error) {
            console.error('Error creating memory fragment:', error);
            throw error;
        }
    }

    // Modify the evaluateResponseAndGenerateFollowUp method to handle negative responses
    

    // Add this method to the EnhancedLangGraph class
    private isNegativeResponse(message: string): boolean {
        const negativePatterns = [
            /\b(no|nope|not really|don't have|haven't|can't think|nothing comes to mind)\b/i,
            /\b(boring|normal|ordinary|usual|typical|nothing special|nothing interesting)\b/i,
            /\b(i don't know|not sure|maybe|i guess|probably not)\b/i
        ];
        
        return negativePatterns.some(pattern => pattern.test(message));
    }

    // Add this method to the EnhancedLangGraph class
    private getLastAiMessage(conversationHistory: ChatMessage[]): string | null {
        if (!conversationHistory || conversationHistory.length === 0) {
            return null;
        }
        
        // Find the last message from the AI
        for (let i = conversationHistory.length - 1; i >= 0; i--) {
            if (conversationHistory[i].role === 'assistant') {
                return conversationHistory[i].content;
            }
        }
        
        return null;
    }

    // Fix the getNarrativeState method to always return a valid AgentNarrativeState
    private async getNarrativeState(userId: string): Promise<AgentNarrativeState> {
        const sessionKey = this.getSessionKey(userId, this.agentId);
        let narrativeState = this.narrativeStates.get(sessionKey);
        
        if (!narrativeState) {
            try {
                // Try to load from database
                const conversation = await this.narrativeStateModel.findOne({
                    userId,
                    agentId: this.agentId,
                    active: true
                });
                
                if (conversation?.narrativeState) {
                    narrativeState = conversation.narrativeState as AgentNarrativeState;
                    
                    // Ensure introStage is set if hasCompletedIntroduction is false
                    if (!narrativeState.hasCompletedIntroduction && !narrativeState.introStage) {
                        narrativeState.introStage = IntroductionStage.INITIAL_GREETING;
                        logger.info(`[FLOW] Setting missing introStage to INITIAL_GREETING for user ${userId}`);
                    }
                    
                    this.narrativeStates.set(sessionKey, narrativeState);
                } 
            } catch (error) {
                logger.error('Error loading narrative state:', error);
            }
            
            // If still no narrative state, create a new one
            if (!narrativeState) {
                narrativeState = {
                    hasCompletedIntroduction: false,
                    relationshipStage: 'stranger',
                    knownTopics: [],
                    sharedStories: [],
                    lastInteractionTimestamp: new Date(),
                    agentSpecificState: {},
                    introStage: IntroductionStage.INITIAL_GREETING
                };
                
                logger.info(`[FLOW] Created new narrative state for user ${userId} with introStage INITIAL_GREETING`);
                
                // Save to memory and database
                this.narrativeStates.set(sessionKey, narrativeState);
                await this.saveNarrativeState(userId, narrativeState);
            }
        }
        
        return narrativeState;
    }

    // Update the processRegularConversation method to handle undefined values
    private async processRegularConversation(
        message: string,
        context: any,
        narrativeState: AgentNarrativeState
    ): Promise<any> {
        try {
            // Get the current node
            const currentNode = this.currentState.currentNode;
            const node = this.nodes.get(currentNode);
            
            if (!node) {
                logger.error(`[FLOW] Node not found: ${currentNode}`);
                return {
                    response: "I'm not sure how to respond to that.",
                    nextNode: ConversationNodeType.CASUAL_CONVERSATION,
                    updatedState: this.currentState,
                    metadata: {}
                };
            }
            
            // Process the message using the node's handler
            logger.info(`[FLOW] Processing message with node: ${node.id}`);
            
            // Add defensive checks for node.handler
            if (!node.handler) {
                logger.error(`[FLOW] Node handler is undefined for node: ${node.id}`);
                return {
                    response: "I'm having trouble processing your message.",
                    nextNode: ConversationNodeType.CASUAL_CONVERSATION,
                    updatedState: this.currentState,
                    metadata: {}
                };
            }
            
            // Call the node handler with defensive checks
            const result = await node.handler(message, this.currentState, {
                ...context,
                narrativeState: narrativeState || {},
                memories: context.memories || []
            });
            
            // Update the current state
            this.currentState = {
                ...this.currentState,
                ...result.updatedState
            };
            
            return result;
        } catch (error) {
            logger.error(`[FLOW] Error in processRegularConversation:`, error);
            return {
                response: "I apologize, but I'm having trouble processing your message right now.",
                nextNode: ConversationNodeType.CASUAL_CONVERSATION,
                updatedState: this.currentState,
                metadata: {}
            };
        }
    }

    // Fix the extractName method to properly handle different input types
    private extractName(input: any): string | null {
        // If input is a string (direct message)
        if (typeof input === 'string') {
            const message = input;
            
            // Check for direct name statements
            const namePatterns = [
                /my name is (\w+)/i,
                /i am (\w+)/i,
                /i'm (\w+)/i,
                /call me (\w+)/i,
                /it's (\w+)/i,
                /this is (\w+)/i,
                /(\w+) here/i,
                /hey.* i am (\w+)/i,
                /hey.* i'm (\w+)/i,
                /hello.* i am (\w+)/i
            ];

            for (const pattern of namePatterns) {
                const match = message.match(pattern);
                if (match && match[1]) {
                    return match[1].charAt(0).toUpperCase() + match[1].slice(1);
                }
            }

            // If no direct statement, look for names in the message
            const words = message.split(/\s+/);
            for (const word of words) {
                if (word.length >= 3 && 
                    word[0] === word[0].toUpperCase() && 
                    word[0] !== word[0].toLowerCase()) {
                    return word;
                }
            }
        }
        
        // If input is an array (conversation history)
        else if (Array.isArray(input)) {
            const conversationHistory = input;
            
            if (!conversationHistory || conversationHistory.length === 0) {
                return null;
            }
            
            // Look for messages where the user might have introduced themselves
            for (const msg of conversationHistory) {
                if (msg.role === 'user') {
                    const content = msg.content.toLowerCase();
                    
                    // Look for common introduction patterns
                    const namePatterns = [
                        /my name is (\w+)/i,
                        /i'm (\w+)/i,
                        /i am (\w+)/i,
                        /call me (\w+)/i
                    ];
                    
                    for (const pattern of namePatterns) {
                        const match = content.match(pattern);
                        if (match && match[1]) {
                            return match[1].charAt(0).toUpperCase() + match[1].slice(1);
                        }
                    }
                }
            }
        }
        
        return null;
    }

    // Add this method to the EnhancedLangGraph class
    private getIntroductionStage(userId: string): IntroductionStage | null {
        // Get the narrative state for this user
        const narrativeState = this.narrativeStates.get(userId);
        
        // Return the intro stage from the narrative state, or null if not found
        return narrativeState?.introStage || null;
    }

    // Add a method to check if we should advance to the next stage
    private shouldAdvanceIntroStage(currentStage: IntroductionStage, message: string, context: any): boolean {
        // If we're at the final stage, don't advance further
        if (currentStage === IntroductionStage.ESTABLISH_RELATIONSHIP) {
            console.log(`[DEBUG] At final stage ESTABLISH_RELATIONSHIP, not advancing`);
            return false;
        }
        
        // For ESTABLISH_SCENARIO, always advance to SEEK_HELP
        if (currentStage === IntroductionStage.ESTABLISH_SCENARIO) {
            console.log(`[DEBUG] At ESTABLISH_SCENARIO, advancing to SEEK_HELP`);
            return true;
        }
        
        // For SEEK_HELP, check if the user agreed to help
        if (currentStage === IntroductionStage.SEEK_HELP) {
            const isAgreement = /^(sure|yes|okay|ok|i'll help|happy to help|what do you need|what can i do)/i.test(message.trim());
            console.log(`[DEBUG] At SEEK_HELP, user agreement: ${isAgreement}`);
            return isAgreement;
        }
        
        // For FIRST_FRAGMENT, assess if the story is good enough to create a memory fragment
        if (currentStage === IntroductionStage.FIRST_FRAGMENT) {
            const isGoodStory = this.assessStoryQuality(message);
            console.log(`[DEBUG] At FIRST_FRAGMENT, story quality assessment: ${isGoodStory}`);
            
            if (isGoodStory) {
                // Extract memory info from the message
                const memoryInfo = this.extractMemoryInfo(context.conversationHistory, context.userName || 'User');
                
                // Create the memory fragment if we have valid info
                if (memoryInfo) {
                    this.createMemoryFragment(context.userId, memoryInfo);
                }
            }
            
            return isGoodStory;
        }
        
        // For FOLLOW_UP, check if we got additional details and update the memory fragment
        if (currentStage === IntroductionStage.FOLLOW_UP) {
            const hasDetails = message.length > 20;
            console.log(`[DEBUG] At FOLLOW_UP, has details: ${hasDetails}`);
            context.conversationHistory
            if (hasDetails) {
                // Update the memory fragment with additional details
                this.updateMemoryFragment(context.userId, message);
            }
            
            return hasDetails;
        }
        
        // For EXPRESS_GRATITUDE, any response advances
        if (currentStage === IntroductionStage.EXPRESS_GRATITUDE) {
            console.log(`[DEBUG] At EXPRESS_GRATITUDE, advancing to ESTABLISH_RELATIONSHIP`);
            return true;
        }
        
        // For all other stages, any response advances
        console.log(`[DEBUG] Standard stage ${currentStage}, advancing with any response`);
        return true;
    }

    // Add this method to fix the casual_conversation node handler
    private initializeConversationNodes(): void {
        // Create the casual conversation node
        this.nodes.set(ConversationNodeType.CASUAL_CONVERSATION, {
            id: ConversationNodeType.CASUAL_CONVERSATION,
            nodeType: 'conversation',
            content: 'Casual conversation with the agent',
            responses: ['Tell me more', 'That\'s interesting', 'I see'],
            nextNodes: [ConversationNodeType.CASUAL_CONVERSATION],
            handler: async (message: string, state: ConversationState, context: any) => {
                try {
                    // Add defensive checks for context properties
                    const narrativeState = context.narrativeState || {};
                    const memories = context.memories || [];
                    const agent = context.agent || this.agent;
                    
                    // Check if we're still in the introduction flow
                    if (!narrativeState.hasCompletedIntroduction && narrativeState.introStage) {
                        // If we're in the introduction flow, use the introduction flow handler
                        console.log(`[DEBUG] Still in introduction flow, stage: ${narrativeState.introStage}`);
                        
                        // Get the appropriate message for this stage
                        const introFlowManager = new IntroductionFlowManager(this.agentId, this);
                        const nextStage = this.advanceIntroductionStage(narrativeState.introStage);
                        
                        // Save the updated stage
                        narrativeState.introStage = nextStage;
                        await this.saveNarrativeState(context.userId, narrativeState);
                        
                        // Get the response for the next stage
                        const responseMessage = this.getIntroductionMessage(agent, nextStage);
                        
                        return {
                            response: responseMessage.agentMessage,
                            nextNode: ConversationNodeType.CASUAL_CONVERSATION,
                            updatedState: state,
                            metadata: {
                                suggestedResponses: responseMessage.suggestedResponses || []
                            }
                        };
                    }
                    
                    // Regular casual conversation handling
                    const prompt = `You are ${agent.name}, a ${agent.category} professional.
                        You're having a casual conversation with someone you just met.
                        They just said: "${message}"
                        
                        Respond naturally as ${agent.name}, keeping your response friendly and conversational.
                        Stay in character and maintain your professional persona.`;
                    
        const completion = await this.openai.chat.completions.create({
                        model: "gpt-3.5-turbo",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.7,
            max_tokens: 150
        });
        
        return {
                        response: completion.choices[0].message.content || "I'm not sure how to respond to that.",
            nextNode: ConversationNodeType.CASUAL_CONVERSATION,
                        updatedState: state,
                        metadata: {}
                    };
                } catch (error) {
                    console.error('[ERROR] Error in casual_conversation handler:', error);
                    return {
                        response: "I'm having trouble with our conversation right now. Let's try a different topic.",
                        nextNode: ConversationNodeType.CASUAL_CONVERSATION,
                        updatedState: state,
                        metadata: {}
                    };
                }
            }
        });
        
        // ... other nodes ...
    }

    // Add method to assess story quality
    private assessStoryQuality(story: string): boolean {
        // Simple assessment: check if the story is long enough and contains some key elements
        const minLength = 30; // Minimum characters for a valid story
        const hasTimeIndicator = /\b(when|during|after|before|while|year|month|day|time|ago|past|yesterday|today)\b/i.test(story);
        const hasEventDescription = /\b(happen|experience|witness|see|saw|remember|recall|event)\b/i.test(story);
        
        const isLongEnough = story.length >= minLength;
        
        // For now, just check if it's long enough - we can make this more sophisticated later
        return isLongEnough;
    }

    // Add method to update a memory fragment
    private async updateMemoryFragment(userId: string, additionalDetails: string): Promise<void> {
        try {
            // Get the narrative state to find the memory fragment ID
            const narrativeState = this.narrativeStates.get(userId);
            if (!narrativeState?.memoryDetails?.fragmentId) {
                console.error('[ERROR] No memory fragment ID found in narrative state');
                return;
            }
            
            const fragmentId = narrativeState.memoryDetails.fragmentId;
            
            // Extract additional details
            const details = await this.extractStoryDetails(additionalDetails);
            
            // Find and update the memory fragment
            const MemoryFragmentModel = mongoose.model('MemoryFragment');
            const fragment = await MemoryFragmentModel.findById(fragmentId);
            
            if (!fragment) {
                console.error(`[ERROR] Memory fragment not found: ${fragmentId}`);
                return;
            }
            
            // Update the fragment with new details
            if (details.location) fragment.location.name = details.location;
            if (details.date) fragment.date.timestamp = details.date;
            if (details.approximateDate) fragment.date.approximateDate = details.approximateDate;
            if (details.people && details.people.length > 0) fragment.people = [...fragment.people, ...details.people];
            if (details.tags && details.tags.length > 0) fragment.tags = [...fragment.tags, ...details.tags];
            if (details.emotions && details.emotions.length > 0) fragment.context.emotions = [...fragment.context.emotions, ...details.emotions];
            
            // Append the additional details to the description
            fragment.description += "\n\nAdditional details: " + additionalDetails;
            
            // Update status if we have more details
            if (details.location && details.date) {
                fragment.status = "complete";
                fragment.missingFields = [];
            }
            
            await fragment.save();
            
            console.log(`[DEBUG] Updated memory fragment: ${fragmentId}`);
            
            // Update the narrative state
            narrativeState.memoryDetails.updated = true;
            await this.saveNarrativeState(userId, narrativeState);
            
        } catch (error) {
            console.error('[ERROR] Failed to update memory fragment:', error);
        }
    }

    // Add method to extract story details using OpenAI
    private async extractStoryDetails(storyText: string): Promise<any> {
        try {
            const prompt = `
            Extract key details from this personal story:
            "${storyText}"
            
            Return a JSON object with these fields:
            - title: A short, descriptive title for this memory
            - date: The date when this happened (ISO format if specific, or null if unclear)
            - approximateDate: A text description of when it happened (e.g., "Summer of 2019", "Early 90s")
            - timePeriod: One of CHILDHOOD, TEENAGE_YEARS, YOUNG_ADULT, ADULT, RECENT
            - location: Where this happened
            - people: Array of objects with {name, relationship} for people mentioned
            - emotions: Array of emotions expressed or implied
            - significance: A number from 1-5 indicating how significant this memory seems
            - tags: Array of relevant tags/keywords
            - themes: Array of themes present in the story
            
            Only include fields if they can be reasonably inferred from the text.
            `;
            
            const completion = await this.openai.chat.completions.create({
                model: "gpt-3.5-turbo",
                messages: [{ role: "user", content: prompt }],
                temperature: 0.3,
                max_tokens: 500
            });
            
            const responseText = completion.choices[0].message.content || "{}";
            
            // Try to parse the JSON response
            try {
                return JSON.parse(responseText);
            } catch (e) {
                console.error('[ERROR] Failed to parse OpenAI response:', e);
                return {};
            }
            
        } catch (error) {
            console.error('[ERROR] OpenAI extraction failed:', error);
            return {};
        }
    }

    // In the handleMessage method of EnhancedLangGraph class
    async handleMessage(
        message: string,
        context: {
            agent: AIAgent;
            userId: string;
            memories?: AIMemory[];
            conversationHistory?: ChatMessage[];
        }
    ): Promise<{
        response: string;
        nextNode: ConversationNodeType;
        updatedState: ConversationState;
        metadata?: { 
            conversationEnded?: boolean;
            suggestedResponses?: string[];
        };
    }> {
        // Get the narrative state for this user and agent
        const narrativeState = await this.initializeNarrativeState(context.userId);
        
        // Log the current state for debugging
        logger.info(`[FLOW] Processing input for agent ${context.agent.slug}`, {
            userId: context.userId,
            currentNode: this.currentState.currentNode,
            hasCompletedIntro: narrativeState.hasCompletedIntroduction,
            introStage: narrativeState.introStage,
            message: message.substring(0, 50) + (message.length > 50 ? '...' : '')
        });
        
        // FIXED: Determine which flow to use based on introduction completion
        const useIntroFlow = !narrativeState.hasCompletedIntroduction;
        
        logger.info(`[FLOW] Flow decision`, {
            useIntroFlow,
            condition1: !narrativeState.hasCompletedIntroduction,
            condition2: !!narrativeState.introStage,
            condition3: narrativeState.introStage === IntroductionStage.ESTABLISH_RELATIONSHIP
        });
        
        if (useIntroFlow) {
            // Use introduction flow
            logger.info(`[FLOW] Using introduction flow - Stage: ${narrativeState.introStage}`);
            return await this.introFlowManager.processFlow(message, context, narrativeState);
        } else {
            // Use regular conversation flow
            logger.info(`[FLOW] Using regular conversation flow - Node: ${this.currentState.currentNode}`);
            return await this.handleCasualConversation(message, context, narrativeState);
        }
    }

    private async handleStageFirstFragment(message: string, context: any, narrativeState: AgentNarrativeState): Promise<any> {
        logger.info(`[MEMORY] Attempting to create memory fragment from user story: "${message.substring(0, 50)}..."`);
        
        try {
            // Try using MemoryFragmentService first
            const memoryFragmentService = new MemoryFragmentService();
            logger.info(`[MEMORY] Creating memory fragment with MemoryFragmentService`);
            
            let fragment;
            try {
                // Create a memory fragment using the dedicated service
                fragment = await memoryFragmentService.createMemoryFragment(context.userId, {
                    title: "Conversation Memory",
                    description: message.substring(0, 100) + "...",
                    date: {
                        timestamp: new Date(),
                        timePeriod: getTimePeriod(new Date())
                    },
                    location: {
                        name: "online"
                    },
                    people: [],
                    tags: ["conversation"],
                    context: {
                        emotions: ["neutral"],
                        significance: 3,
                        themes: ["conversation"]
                    },
                    status: "complete",
                    conversationId: context.conversationId,  // Move to top level
                    aiMemoryKey: this.agentId  // Use this field for agent ID
                });
                
                logger.info(`[MEMORY] Successfully created memory fragment with MemoryFragmentService`, {
                    fragmentId: fragment._id.toString(),
                    userId: context.userId
                });
            } catch (fragmentError) {
                logger.error(`[MEMORY] Error with MemoryFragmentService, falling back to MemoryService`, fragmentError);
                
                // Fall back to MemoryService if MemoryFragmentService fails
                const memoryService = new MemoryService();
                fragment = await memoryService.createFromRawInput({
                    content: message,
                    source: 'conversation',
                    userId: context.userId,
                    metadata: {
                        agent: this.agentId
                    }
                });
                
                logger.info(`[MEMORY] Created memory fragment with fallback MemoryService`, {
                    fragmentId: fragment?._id?.toString()
                });
            }
            
            if (fragment && fragment._id) {
                // Store the fragment ID in the narrative state
                if (!narrativeState.memoryDetails) {
                    narrativeState.memoryDetails = {};
                }
                
                narrativeState.memoryDetails.fragmentId = fragment._id.toString();
                narrativeState.memoryDetails.content = message;
                
                await this.saveNarrativeState(context.userId, narrativeState);
                logger.info(`[MEMORY] Saved fragment ID to narrative state: ${fragment._id.toString()}`);
            } else {
                logger.error(`[MEMORY] Failed to create memory fragment - no ID returned`);
            }
        } catch (error) {
            logger.error(`[MEMORY] Error creating memory fragment`, error);
        }
        
        // Continue with the rest of the method...
    }

    // In the EnhancedLangGraph class, add these methods to delegate to introFlowManager

    private advanceToNextStage(nextStage: IntroductionStage, userId: string, narrativeState: AgentNarrativeState): Promise<any> {
        // Delegate to the introduction flow manager
        return this.introFlowManager.advanceToNextStage(nextStage, userId, narrativeState);
    }

    private isPositiveResponse(message: string): boolean {
        // Delegate to the introduction flow manager
        return this.introFlowManager.isPositiveResponse(message);
    }

    private evaluateStoryQuality(message: string): boolean {
        // Delegate to the introduction flow manager
        return this.introFlowManager.evaluateStoryQuality(message);
    }

    // Add this getter to access the graph property
    get graph(): EnhancedLangGraph {
        return this;
    }
} 