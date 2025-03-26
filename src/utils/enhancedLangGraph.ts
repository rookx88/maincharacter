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
import { AgentNarrativeState, IntroductionStage } from '../types/conversation.js';
import mongoose from 'mongoose';

interface IntroductionPrompt {
    agentMessage: string;
    expectedResponseType: string;
    fallbackPrompt: string;
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
}

export class EnhancedLangGraph {
    private nodes: Map<ConversationNodeType, ConversationNode>;
    private agent?: AIAgent;  // Make optional with ?
    private memoryService: MemoryService;
    private currentState: ConversationState;
    private openai: OpenAI;
    private narrativeStates: Map<string, AgentNarrativeState> = new Map();
    private activeIntroSessions: Map<string, IntroductionStage> = new Map();
    private narrativeStateModel: any;

    constructor(
        private agentId: string,
        private config: EnhancedLangGraphConfig
    ) {
        this.nodes = config.nodes;
        this.memoryService = new MemoryService();
        this.openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });
        
        // Initialize with config values but allow for updates
        this.currentState = {
            currentNode: config.initialNode,
            hasMetBefore: false,
            engagementLevel: 0,
            revealMade: false,
            userAcceptedActivity: false,
            lastInteractionDate: new Date()
        };
        
        this.agent = config.agent;
        this.initializeNodes();
        
        // Initialize the narrative state model
        this.narrativeStateModel = mongoose.model('AgentNarrativeState');
    }

    private initializeNodes() {
        // Add default nodes with proper handlers
        this.addNode({
            id: ConversationNodeType.ENTRY,
            nodeType: 'greeting',
            content: "Welcome! How can I help you today?",
            responses: ["Hi!", "Hello!"],
            nextNodes: [ConversationNodeType.FIRST_MEETING],
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
                    nextNode: ConversationNodeType.FIRST_MEETING,  // Important: Must transition
                    updatedState: {
                        ...state,
                        hasMetBefore: true
                    }
                };
            }
        });

        // First Meeting Node
        this.nodes.set(ConversationNodeType.FIRST_MEETING, {
            id: ConversationNodeType.FIRST_MEETING,
            nodeType: 'dialogue',
            content: '',
            responses: [],
            nextNodes: [ConversationNodeType.CASUAL_CONVERSATION],
            handler: async (message, state, context) => {
                console.log('FIRST_MEETING handler - Context:', context);
                console.log('FIRST_MEETING handler - State:', state);

                const response = await this.generateResponse(
                    `You are ${context.agent?.name}, a ${context.agent?.category} professional. 
                     This is your first time meeting this person.
                     Respond naturally to: "${message}"`,
                    context
                );

                return {
                    response,
                    nextNode: ConversationNodeType.CASUAL_CONVERSATION,
                    updatedState: {
                        ...state,
                        hasMetBefore: true,
                        engagementLevel: 0.7
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
                            timePeriod: TimePeriod.Present
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
                        timePeriod: TimePeriod.Present
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

    private async generateResponse(
        prompt: string,
        context: {
            recentMessages: Message[];
            relevantMemories: AIMemory[];
            agent: AIAgent;
        }
    ): Promise<string> {
        const recentContext = context.recentMessages.slice(-5).map(msg => ({
            role: msg.role as 'system' | 'user' | 'assistant',
            content: msg.content
        }));

        const messages = [
            {
                role: 'system' as const,
                content: `You are ${context.agent.name}, a ${context.agent.category} professional.
                         Your personality: ${context.agent.traits?.core?.join(', ')}
                         Current conversation state: ${this.currentState.hasMetBefore ? 'Continuing conversation' : 'First meeting'}
                         Engagement level: ${this.currentState.engagementLevel}
                         
                         Maintain conversation context and avoid repeating introductions if you've already met.
                         Respond naturally and stay in character.`
            },
            ...recentContext,
            {
                role: 'user' as const,
                content: prompt
            }
        ];

        const completion = await this.openai.chat.completions.create({
            model: "gpt-4",
            messages: messages,
            temperature: 0.7,
            max_tokens: 150
        });

        return completion.choices[0].message.content || "I'm not sure how to respond to that.";
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

    async processInput(
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
        metadata?: { conversationEnded?: boolean };
    }> {
        console.log('=== EnhancedLangGraph Processing ===');
        console.log(`User message: "${message}"`);
        
        // Remove the TESTING cache clear
        // TESTING: Clear graph cache to force new graph creation
        // const cacheKey = `${context.userId}-${this.agentId}`;
        // this.graphCache.delete(cacheKey);
        
        // Initialize narrative state
        const sessionKey = this.getSessionKey(context.userId, this.agentId);
        const narrativeState = await this.initializeNarrativeState(context.userId);
        
        // Check if we've already completed the introduction
        const hasCompletedIntro = narrativeState.hasCompletedIntroduction;
        
        // TESTING: Only force introduction mode if we haven't completed it yet
        if (!hasCompletedIntro) {
            narrativeState.hasCompletedIntroduction = false;
            narrativeState.relationshipStage = 'stranger';
            await this.saveNarrativeState(context.userId, narrativeState);
        }
        
        console.log('Narrative state (TESTING MODE):', {
            hasCompletedIntro: narrativeState.hasCompletedIntroduction,
            relationshipStage: narrativeState.relationshipStage,
            introStage: this.getCurrentIntroductionStage(context.conversationHistory || [])
        });
        
        // For testing, use introduction flow only if not completed
        let result;
        if (!narrativeState.hasCompletedIntroduction) {
            result = await this.handleIntroductionFlow(message, context, sessionKey, narrativeState);
        } else {
            // Use casual conversation flow
            result = await this.handleCasualConversation(message, context, narrativeState);
        }
        
        // Log the AI response
        console.log(`AI response (${result.nextNode}): "${result.response}"`);
        
        return result;
    }

    // Update the handleIntroductionFlow method to better handle negative responses
    private async handleIntroductionFlow(
        message: string,
        context: {
            agent: AIAgent;
            userId: string;
            memories?: AIMemory[];
            conversationHistory?: ChatMessage[];
        },
        sessionKey: string,
        narrativeState: AgentNarrativeState
    ): Promise<{
        response: string;
        nextNode: ConversationNodeType;
        updatedState: ConversationState;
        metadata?: { conversationEnded?: boolean };
    }> {
        // Get current stage from narrative state first, then conversation history
        let currentStage = narrativeState.introStage || this.getCurrentIntroductionStage(context.conversationHistory || []);
        
        // If still no stage found, default to initial greeting
        if (!currentStage) {
            currentStage = IntroductionStage.INITIAL_GREETING;
        }
        
        console.log(`Processing introduction flow, current stage: ${currentStage}`);
        
        // Special handling for name responses in initial greeting
        if (currentStage === IntroductionStage.INITIAL_GREETING) {
            // Check if this looks like a name response
            const isNameResponse = message.length < 20 || 
                                  message.match(/I['']m\s+\w+/i) || 
                                  message.match(/my name is\s+\w+/i);
            
            if (isNameResponse) {
                // Extract the name
                let userName = message;
                const nameMatch = message.match(/I['']m\s+(\w+)/i) || message.match(/my name is\s+(\w+)/i);
                if (nameMatch && nameMatch[1]) {
                    userName = nameMatch[1];
                }
                
                console.log(`Detected name response: ${userName}`);
                
                // Advance to the next stage
                const nextStage = IntroductionStage.ESTABLISH_SCENARIO;
                
                // Save the updated stage
                narrativeState.introStage = nextStage;
                await this.saveNarrativeState(context.userId, narrativeState);
                
                // Get the next message for the establish_scenario stage
                const nextMessage = this.getIntroductionMessage(context.agent, nextStage)
                    .replace('{userName}', userName);
                
                return {
                    response: nextMessage,
                    nextNode: ConversationNodeType.FIRST_MEETING,
                    updatedState: {
                        currentNode: ConversationNodeType.FIRST_MEETING,
                        hasMetBefore: false,
                        engagementLevel: 3,
                        revealMade: false,
                        userAcceptedActivity: false,
                        lastInteractionDate: new Date()
                    }
                };
            }
        }
        
        // Check if the user's response is negative or minimal
        const isNegativeResponse = /^(no|nope|not really|huh\?|i don't know|i don't think so|nothing comes to mind)/i.test(message.trim());
        const isMinimalResponse = message.length < 15 || 
                                 /^(yes|no|maybe|ok|sure|thanks|thank you|cool|nice|great|awesome|fine)$/i.test(message.trim());
        
        // If we're at a stage that requires a substantial response and get a negative/minimal one
        if ((currentStage === IntroductionStage.REVEAL_CAPABILITIES || 
             currentStage === IntroductionStage.REQUEST_ASSISTANCE || 
             currentStage === IntroductionStage.EXPRESS_GRATITUDE) && 
            (isNegativeResponse || isMinimalResponse)) {
            
            console.log(`Detected negative/minimal response at stage ${currentStage}, using follow-up prompt`);
            
            // Get a follow-up prompt for this stage
            const followUpPrompt = this.evaluateResponseAndGenerateFollowUp(
                message, 
                currentStage,
                context.agent.slug
            );
            
            if (followUpPrompt) {
                return {
                    response: followUpPrompt,
                    nextNode: ConversationNodeType.FIRST_MEETING,
                    updatedState: {
                        currentNode: ConversationNodeType.FIRST_MEETING,
                        hasMetBefore: false,
                        engagementLevel: 3,
                        revealMade: false,
                        userAcceptedActivity: false,
                        lastInteractionDate: new Date()
                    }
                };
            }
        }
        
        // Standard stage advancement logic
        console.log(`Standard stage ${currentStage}, advancing with any response`);
        
        // Determine the next stage based on the current stage
        let nextStage: IntroductionStage;
        switch (currentStage) {
            case IntroductionStage.INITIAL_GREETING:
                nextStage = IntroductionStage.ESTABLISH_SCENARIO;
                break;
            case IntroductionStage.ESTABLISH_SCENARIO:
                nextStage = IntroductionStage.REVEAL_CAPABILITIES;
                break;
            case IntroductionStage.REVEAL_CAPABILITIES:
                nextStage = IntroductionStage.REQUEST_ASSISTANCE;
                break;
            case IntroductionStage.REQUEST_ASSISTANCE:
                nextStage = IntroductionStage.EXPRESS_GRATITUDE;
                break;
            case IntroductionStage.EXPRESS_GRATITUDE:
                nextStage = IntroductionStage.ESTABLISH_RELATIONSHIP;
                break;
            case IntroductionStage.ESTABLISH_RELATIONSHIP:
                // This is the final stage, handle completion
                return this.completeIntroduction(context.userId, narrativeState, context.conversationHistory);
            default:
                nextStage = IntroductionStage.INITIAL_GREETING;
        }
        
        // Save the updated stage to the database
        narrativeState.introStage = nextStage;
        const saveResult = await this.saveNarrativeState(context.userId, narrativeState);
        console.log(`Saved introduction stage to database: ${nextStage}`, saveResult);
        
        // Generate the response for the next stage
        console.log(`Advanced to stage: ${nextStage}, generating response for this stage`);
        
        // Get the appropriate message for this stage
        let responseMessage = this.getIntroductionMessage(context.agent, nextStage);
        
        // Replace {userName} placeholder if we have the user's name
        const userName = this.extractUserName(context.conversationHistory || []);
        if (userName) {
            responseMessage = responseMessage.replace('{userName}', userName);
        } else {
            responseMessage = responseMessage.replace('{userName}', 'there');
        }
        
        return {
            response: responseMessage,
            nextNode: ConversationNodeType.FIRST_MEETING,
            updatedState: {
                currentNode: ConversationNodeType.FIRST_MEETING,
                hasMetBefore: false,
                engagementLevel: 3,
                revealMade: false,
                userAcceptedActivity: false,
                lastInteractionDate: new Date()
            }
        };
    }

    // Fix the getCurrentIntroductionStage method to properly identify stages
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
        
        // Log all AI messages for debugging
        console.log("All AI messages:", aiMessages.map(m => m.content.substring(0, 30) + "..."));
        
        // Check each message for stage markers, starting with the most recent
        for (const message of aiMessages) {
            console.log("Checking message:", message.content.substring(0, 30) + "...");
            
            if (message.content.includes("Oh! Hi there! I'm Alex Rivers")) {
                return IntroductionStage.INITIAL_GREETING;
            }
            if (message.content.includes("My guest just canceled last minute")) {
                return IntroductionStage.ESTABLISH_SCENARIO;
            }
            if (message.content.includes("Usually I prep by looking at trending topics")) {
                return IntroductionStage.REVEAL_CAPABILITIES;
            }
            if (message.content.includes("Do you have any interesting stories")) {
                return IntroductionStage.REQUEST_ASSISTANCE;
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
            agentSpecificState: {}
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

    public addNode(node: ConversationNode): void {
        this.nodes.set(node.id, node);
    }

    // Add a method to update the current state from database
    public updateState(state: Partial<ConversationState>): void {
        console.log('Updating graph state:', state);
        this.currentState = {
            ...this.currentState,
            ...state
        };
    }

    // Generate a session key for state management
    private getSessionKey(userId: string, agentId: string): string {
        return `${userId}:${agentId}`;
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
    private async saveNarrativeState(userId: string, narrativeState: AgentNarrativeState): Promise<void> {
        await ConversationModel.findOneAndUpdate(
            { userId, agentId: this.agentId, active: true },
            { $set: { narrativeState } },
            { upsert: true }
        );
    }

    // Get introduction message for a specific stage
    private getIntroductionMessage(agent: AIAgent, stage: IntroductionStage): string {
        const introScripts: Record<string, Record<IntroductionStage, IntroductionPrompt>> = {
            'alex-rivers': {
                [IntroductionStage.INITIAL_GREETING]: {
                    agentMessage: "Oh! Hi there! I'm Alex Rivers from the Life Stories podcast. Sorry if I seem a bit frazzled at the moment. *extends hand* I didn't catch your name?",
                    expectedResponseType: 'name',
                    fallbackPrompt: "I like to know who I'm talking with. What should I call you?"
                },
                
                [IntroductionStage.ESTABLISH_SCENARIO]: {
                    agentMessage: "Great to meet you, {userName}! *looks at watch anxiously* Between us, I'm in a bit of a crisis. My guest just canceled last minute, and I'm supposed to go live in an hour! *runs hand through hair* My producer is already saying we should just run a 'best of' episode instead, but I hate letting the audience down like that.",
                    expectedResponseType: 'acknowledgment',
                    fallbackPrompt: "Have you ever had something important fall through at the last minute?"
                },
                
                [IntroductionStage.REVEAL_CAPABILITIES]: {
                    agentMessage: "Usually I prep by looking at the guest's background, finding those moments that shaped them. *sighs* The show is all about how unexpected life events change us. *looks at you thoughtfully* Everyone has at least one story that changed their perspective or taught them something important. *leans forward* What about you? Has there been a particularly memorable or unusual event in your life that stands out?",
                    expectedResponseType: 'personal_story',
                    fallbackPrompt: "It doesn't have to be something huge - sometimes it's the unexpected small moments that make the best stories. Maybe something surprising that happened to you?"
                },
                
                [IntroductionStage.REQUEST_ASSISTANCE]: {
                    agentMessage: "Wait, that's actually fascinating! *starts taking notes* I never would have guessed that. *looks up excitedly* This could be perfect for today's show! Would you mind telling me more about when this happened? What year was it, and what made it so memorable for you?",
                    expectedResponseType: 'story_details',
                    fallbackPrompt: "The details really help bring a story to life for the listeners. When did this happen, and what made it stand out to you?"
                },
                
                [IntroductionStage.EXPRESS_GRATITUDE]: {
                    agentMessage: "*speaking into phone* Jamie, I've got something better than the original guest. Trust me on this one. *hangs up* Thank you so much for sharing that story! *adjusts microphone* This is exactly what makes Life Stories special - authentic experiences. How do you think that experience changed you or your outlook on life?",
                    expectedResponseType: 'reflection',
                    fallbackPrompt: "The most powerful stories are the ones that change us in some way, even if it's subtle."
                },
                
                [IntroductionStage.ESTABLISH_RELATIONSHIP]: {
                    agentMessage: "*nodding thoughtfully* That's exactly the kind of perspective I try to highlight on Life Stories. *puts equipment away* You know, you have a great perspective. I'd love to chat with you again sometime. I'm always looking for fresh ideas and stories for the show.",
                    expectedResponseType: 'agreement',
                    fallbackPrompt: "No pressure - I just enjoy connecting with people who have interesting perspectives."
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
                
                [IntroductionStage.REVEAL_CAPABILITIES]: {
                    agentMessage: "*tastes from pot, frowns slightly* I believe food is deeply connected to our most cherished memories. *looks up* Everyone has at least one food memory that takes them back to a specific moment in their life. *curious expression* What about you, {userName}? Is there a special meal or food experience from your past that stands out in your memory?",
                    expectedResponseType: 'personal_story',
                    fallbackPrompt: "Maybe a family recipe? A special celebration? Even something simple like ice cream on a summer day can hold powerful memories."
                },
                
                [IntroductionStage.REQUEST_ASSISTANCE]: {
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
                
                [IntroductionStage.REVEAL_CAPABILITIES]: {
                    agentMessage: "*picks up and discards several fabric swatches* I believe style is a visual language that tells people who you are before you speak. *looks at you with curiosity* Everyone has at least one outfit or accessory that connects to a meaningful moment in their life. *tilts head* What about you? Is there a particular item of clothing or an outfit that holds a special memory or significance for you?",
                    expectedResponseType: 'personal_story',
                    fallbackPrompt: "Maybe something you wore for a special occasion? Or an item that reminds you of someone important? Even something simple can have a powerful story behind it."
                },
                
                [IntroductionStage.REQUEST_ASSISTANCE]: {
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
                }
            }
        };
        
        return introScripts[agent.slug]?.[stage]?.agentMessage || 
            "Hello there! It's great to meet you. I'd love to chat more about what interests you.";
    }

    // Advance to the next introduction stage
    private advanceIntroductionStage(sessionKey: string, currentStage: IntroductionStage): IntroductionStage {
        const stages = Object.values(IntroductionStage);
        const currentIndex = stages.indexOf(currentStage);
        const nextStage = currentIndex < stages.length - 1 ? 
            stages[currentIndex + 1] : 
            IntroductionStage.ESTABLISH_RELATIONSHIP;
        
        this.activeIntroSessions.set(sessionKey, nextStage);
        return nextStage;
    }

    // Add a method to check if we should advance to the next stage
    private shouldAdvanceIntroStage(currentStage: IntroductionStage, message: string): boolean {
        // If we're at the final stage, don't advance further
        if (currentStage === IntroductionStage.ESTABLISH_RELATIONSHIP) {
            // Check if this is the second response to ESTABLISH_RELATIONSHIP
            // We could track this with a counter in narrativeState
            return false;
        }
        
        // For other stages, advance based on the existing logic
        if (currentStage === IntroductionStage.REQUEST_ASSISTANCE) {
            // Only advance if user provides a substantive response
            const isSubstantive = message.length > 20;
            console.log(`REQUEST_ASSISTANCE stage, message length: ${message.length}, advancing: ${isSubstantive}`);
            return isSubstantive;
        }
        
        // For all other stages, any response advances
        console.log(`Standard stage ${currentStage}, advancing with any response`);
        return true;
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

    // Update the completeIntroduction method to create a memory fragment
    private async completeIntroduction(
        userId: string, 
        narrativeState: AgentNarrativeState,
        conversationHistory?: ChatMessage[]
    ): Promise<{
        response: string;
        nextNode: ConversationNodeType;
        updatedState: ConversationState;
        metadata?: { conversationEnded?: boolean };
    }> {
        try {
            // Try to create a memory from the conversation
            if (conversationHistory && conversationHistory.length > 0) {
                // Extract the user's name from the conversation
                const userName = this.extractUserName(conversationHistory) || 'User';
                
                // Extract memory information
                const memoryInfo = this.extractMemoryInfo(conversationHistory, userName);
                
                // If we have enough information, create a memory
                if (memoryInfo) {
                    try {
                        // Create the memory fragment
                        await this.createMemoryFragment(userId, memoryInfo);
                        console.log('Created memory fragment from introduction conversation');
                    } catch (error) {
                        console.error('Error creating memory fragment:', error);
                    }
                } else {
                    console.log('Not enough information to create a memory fragment');
                }
            }
            
            // Update the narrative state to mark introduction as completed
            narrativeState.hasCompletedIntroduction = true;
            narrativeState.relationshipStage = 'acquaintance';
            narrativeState.lastInteractionTimestamp = new Date();
            
            // Save to database
            await this.narrativeStateModel.findOneAndUpdate(
                { userId, agentId: this.agentId },
                narrativeState,
                { upsert: true, new: true }
            );
            
            // Update local cache
            this.narrativeStates.set(this.getSessionKey(userId, this.agentId), narrativeState);
            
            return {
                response: "I really appreciate your help today! I need to run now and get ready for the show. Hope to catch up with you again soon!",
                nextNode: ConversationNodeType.CASUAL_CONVERSATION,
                updatedState: {
                    currentNode: ConversationNodeType.CASUAL_CONVERSATION,
                    hasMetBefore: true,
                    engagementLevel: this.currentState.engagementLevel,
                    revealMade: true,
                    userAcceptedActivity: true,
                    lastInteractionDate: new Date()
                },
                metadata: {
                    conversationEnded: true
                }
            };
        } catch (error) {
            console.error('Error completing introduction:', error);
            throw error;
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

    // Helper method to extract user name from conversation
    private extractUserName(conversationHistory: ChatMessage[]): string | null {
        // Look for the initial greeting response
        for (let i = 0; i < conversationHistory.length; i++) {
            const message = conversationHistory[i];
            
            // Look for the agent's initial greeting
            if (message.role === 'assistant' && 
                (message.content.includes("I didn't catch your name") || 
                 message.content.includes("And you are") ||
                 message.content.includes("What should I call you"))) {
                
                // The next message should be the user's response with their name
                if (i + 1 < conversationHistory.length && conversationHistory[i + 1].role === 'user') {
                    const userResponse = conversationHistory[i + 1].content;
                    
                    // Try to extract a name - look for common name patterns
                    // This is a simple approach - could be enhanced with NLP
                    const namePatterns = [
                        /my name is ([A-Z][a-z]+)/i,
                        /I'm ([A-Z][a-z]+)/i,
                        /I am ([A-Z][a-z]+)/i,
                        /call me ([A-Z][a-z]+)/i,
                        /([A-Z][a-z]+) here/i
                    ];
                    
                    for (const pattern of namePatterns) {
                        const match = userResponse.match(pattern);
                        if (match && match[1]) {
                            return match[1];
                        }
                    }
                    
                    // If no pattern matches, just use the first word if it looks like a name
                    const firstWord = userResponse.trim().split(/\s+/)[0];
                    if (firstWord && /^[A-Z][a-z]+$/.test(firstWord)) {
                        return firstWord;
                    }
                    
                    // If all else fails, return the whole response if it's short
                    if (userResponse.length < 20) {
                        return userResponse.trim();
                    }
                }
            }
        }
        
        return null;
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
    private evaluateResponseAndGenerateFollowUp(
        userMessage: string,
        currentStage: IntroductionStage,
        agentSlug: string
    ): string | null {
        // Special case for name responses in the initial greeting stage
        if (currentStage === IntroductionStage.INITIAL_GREETING) {
            // If the message looks like just a name (short and no spaces), accept it
            if (userMessage.length < 20 && !userMessage.includes(' ')) {
                return null; // Accept this as a valid name response
            }
            
            // If message contains "I'm [Name]" or "My name is [Name]", accept it
            if (userMessage.match(/I['']m\s+\w+/i) || userMessage.match(/my name is\s+\w+/i)) {
                return null; // Accept this as a valid name response
            }
        }
        
        // Check for negative responses
        const isNegativeResponse = /^(no|nope|not really|huh\?|i don't know|i don't think so|nothing comes to mind)/i.test(userMessage.trim());
        
        // For other stages, check if the response is too short, generic, or negative
        if (userMessage.length < 15 || 
            /^(yes|no|maybe|ok|sure|thanks|thank you|cool|nice|great|awesome|fine)$/i.test(userMessage.trim()) ||
            isNegativeResponse) {
            
            // Get agent-specific follow-up prompts
            const followUpPrompts: Record<string, Record<IntroductionStage, string[]>> = {
                'alex-rivers': {
                    [IntroductionStage.INITIAL_GREETING]: [
                        "I didn't quite catch that. What's your name?",
                        "Sorry, could you tell me your name again?",
                        "I'd like to know who I'm talking to. What should I call you?"
                    ],
                    [IntroductionStage.ESTABLISH_SCENARIO]: [
                        "So as I was saying, I'm in a bit of a crisis with my podcast. Have you ever been in a last-minute situation?",
                        "My guest just canceled and I need to find content fast. Any thoughts?",
                        "I really need some fresh content for my show today. Can you help me out?"
                    ],
                    [IntroductionStage.REVEAL_CAPABILITIES]: [
                        "Hmm, I need something more substantial for the show. What's the craziest thing you've ever lived through?",
                        "I'm looking for those moments that make people say 'wow!' - have you ever been in a situation that seemed unbelievable?",
                        "My listeners love stories with unexpected twists. Have you ever experienced something that completely surprised you?"
                    ],
                    [IntroductionStage.REQUEST_ASSISTANCE]: [
                        "I need more details to paint the picture for my listeners. When did this happen? Where were you?",
                        "For the podcast, I need to set the scene. Can you tell me more about when and where this happened?",
                        "The details really bring a story to life. What year was this, and what made it so memorable?"
                    ],
                    [IntroductionStage.EXPRESS_GRATITUDE]: [
                        "That's a start, but I'm curious how this experience changed you. Did it affect how you see the world?",
                        "For the podcast, I like to explore how experiences shape us. How did this event impact you personally?",
                        "My listeners connect with the emotional journey. How did you feel before, during, and after this experience?"
                    ],
                    [IntroductionStage.ESTABLISH_RELATIONSHIP]: [
                        "Before I go, I'd love to know if we could chat again sometime about more stories?",
                        "You've been really helpful. Would you be open to connecting again for future episodes?",
                        "I'm always looking for interesting perspectives for my show. Would you mind if I reached out again?"
                    ],
                    [IntroductionStage.REVEAL_CAPABILITIES + '_negative']: [
                        "Everyone has a story worth telling! Even something that might seem ordinary to you could be fascinating to others. Maybe a time when you faced a challenge or made an important decision?",
                        "I understand not everyone has dramatic life events, but sometimes it's the small moments that are most meaningful. Was there ever a time when something unexpected changed your day or perspective?",
                        "Let me approach this differently - what's something you're passionate about or that brings you joy? Sometimes our best stories are about the things we love."
                    ]
                },
                'chef-isabella': {
                    [IntroductionStage.INITIAL_GREETING]: [
                        "I didn't quite catch that. What's your name?",
                        "Sorry, could you tell me your name again?",
                        "I'd like to know who I'm sharing my kitchen with. What's your name?"
                    ],
                    [IntroductionStage.ESTABLISH_SCENARIO]: [
                        "So as I was saying, I'm in a bit of a crisis with my recipe. Have you ever tried to recreate a special memory through food?",
                        "My guest just canceled and I need to find inspiration fast. Any thoughts?",
                        "I really need some fresh inspiration for my new dish. Can you help me out?"
                    ],
                    [IntroductionStage.REVEAL_CAPABILITIES]: [
                        "Hmm, I need something more flavorful for my inspiration! What's a meal that brings back strong memories for you?",
                        "Food is so connected to our most powerful memories. Is there a special dish that reminds you of an important moment?",
                        "Everyone has at least one food that transports them to another time. What dish takes you back to a specific memory?"
                    ],
                    [IntroductionStage.REQUEST_ASSISTANCE]: [
                        "I need more ingredients for this recipe of memories. When did this happen? What made this meal special?",
                        "The context adds so much flavor to the story. When was this, and what was happening in your life?",
                        "For my creative process, I need to understand the setting. Can you describe when and where you experienced this?"
                    ],
                    [IntroductionStage.EXPRESS_GRATITUDE]: [
                        "That's just the appetizer - I'd love to hear the main course! How did this food experience affect your relationship with cuisine?",
                        "Food memories often change our palates. Did this experience influence your taste preferences going forward?",
                        "The best food stories reveal something about ourselves. What did this experience teach you about your connection to food?"
                    ],
                    [IntroductionStage.ESTABLISH_RELATIONSHIP]: [
                        "Before I go, I'd love to know if we could chat again sometime about more stories?",
                        "You've been really helpful. Would you be open to connecting again for future episodes?",
                        "I'm always looking for interesting perspectives for my show. Would you mind if I reached out again?"
                    ],
                    [IntroductionStage.REVEAL_CAPABILITIES + '_negative']: [
                        "Everyone has a story worth telling! Even something that might seem ordinary to you could be fascinating to others. Maybe a time when you faced a challenge or made an important decision?",
                        "I understand not everyone has dramatic life events, but sometimes it's the small moments that are most meaningful. Was there ever a time when something unexpected changed your day or perspective?",
                        "Let me approach this differently - what's something you're passionate about or that brings you joy? Sometimes our best stories are about the things we love."
                    ]
                },
                'morgan-chase': {
                    [IntroductionStage.INITIAL_GREETING]: [
                        "I didn't quite catch that. What's your name?",
                        "Sorry, could you tell me your name again?",
                        "I'd like to know who I'm collaborating with. What's your name?"
                    ],
                    [IntroductionStage.ESTABLISH_SCENARIO]: [
                        "So as I was saying, I'm in a bit of a creative block with my collection. Have you ever tried to express something personal through your style or appearance?",
                        "My guest just canceled and I need to find inspiration fast. Any thoughts?",
                        "I really need some fresh inspiration for my new collection. Can you help me out?"
                    ],
                    [IntroductionStage.REVEAL_CAPABILITIES]: [
                        "Hmm, I need something more textured for my design inspiration. Is there an outfit or accessory that holds special meaning for you?",
                        "Style is so personal. Can you tell me about a time when what you wore really mattered to you?",
                        "Everyone has at least one item in their wardrobe with a story. What piece of clothing means something special to you?"
                    ],
                    [IntroductionStage.REQUEST_ASSISTANCE]: [
                        "I need more details to visualize this. When did this happen? What was the occasion?",
                        "The context really helps me understand the significance. When was this, and what made this particular style choice meaningful?",
                        "For my creative process, I need to understand the setting. Can you describe when and where this fashion moment occurred?"
                    ],
                    [IntroductionStage.EXPRESS_GRATITUDE]: [
                        "That's just the sketch - I need to add color! How did this experience influence your personal style going forward?",
                        "Style evolution is fascinating. Did this experience change how you think about fashion or self-expression?",
                        "The most interesting style stories reveal something about identity. What did this experience teach you about yourself?"
                    ],
                    [IntroductionStage.ESTABLISH_RELATIONSHIP]: [
                        "Before I go, I'd love to know if we could chat again sometime about more stories?",
                        "You've been really helpful. Would you be open to connecting again for future episodes?",
                        "I'm always looking for interesting perspectives for my show. Would you mind if I reached out again?"
                    ],
                    [IntroductionStage.REVEAL_CAPABILITIES + '_negative']: [
                        "Everyone has a story worth telling! Even something that might seem ordinary to you could be fascinating to others. Maybe a time when you faced a challenge or made an important decision?",
                        "I understand not everyone has dramatic life events, but sometimes it's the small moments that are most meaningful. Was there ever a time when something unexpected changed your day or perspective?",
                        "Let me approach this differently - what's something you're passionate about or that brings you joy? Sometimes our best stories are about the things we love."
                    ]
                }
            };
            
            // Get follow-up prompts for the current agent and stage
            let prompts;
            
            // If it's a negative response at a key stage, use the special negative prompts
            if (isNegativeResponse && 
                (currentStage === IntroductionStage.REVEAL_CAPABILITIES || 
                 currentStage === IntroductionStage.REQUEST_ASSISTANCE || 
                 currentStage === IntroductionStage.EXPRESS_GRATITUDE)) {
                // Use a more specific type assertion
                const negativeKey = `${currentStage}_negative`;
                prompts = followUpPrompts[agentSlug]?.[negativeKey as IntroductionStage];
            }
            
            // If no special negative prompts or not a negative response, use standard prompts
            if (!prompts) {
                prompts = followUpPrompts[agentSlug]?.[currentStage];
            }
            
            // If we have prompts for this stage, randomly select one
            if (prompts && prompts.length > 0) {
                return prompts[Math.floor(Math.random() * prompts.length)];
            }
        }
        
        return null; // No follow-up needed
    }
} 