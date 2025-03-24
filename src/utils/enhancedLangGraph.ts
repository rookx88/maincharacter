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
    private initialState: ConversationState;
    private openai: OpenAI;

    constructor(
        private agentId: string,
        private config: EnhancedLangGraphConfig
    ) {
        this.nodes = config.nodes;
        this.memoryService = new MemoryService();
        this.openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });
        this.initialState = {
            currentNode: config.initialNode,
            hasMetBefore: false,
            engagementLevel: 0,
            revealMade: false,
            userAcceptedActivity: false,
            lastInteractionDate: new Date()
        };
        this.agent = config.agent;
        this.initializeNodes();
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
                const prompt = this.createPersonalityPrompt(context);
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

    private async extractThemes(message: string): Promise<string[]> {
        // Implement theme extraction
        return ['conversation']; // Placeholder
    }

    private async generateMemoryTitle(message: string): Promise<string> {
        // Implement title generation
        return "Conversation Memory"; // Placeholder
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
                         Current conversation state: ${this.initialState.hasMetBefore ? 'Continuing conversation' : 'First meeting'}
                         Engagement level: ${this.initialState.engagementLevel}
                         
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
    }> {
        console.log('=== EnhancedLangGraph Processing ===');
        console.log('1. Current state:', {
            node: this.initialState.currentNode,
            hasMetBefore: this.initialState.hasMetBefore
        });

        const currentNode = this.nodes.get(this.initialState.currentNode);
        if (!currentNode) {
            throw new Error(`Invalid node: ${this.initialState.currentNode}`);
        }

        console.log('2. Processing through node:', currentNode.id);
        const result = await currentNode.handler(message, this.initialState, {
            recentMessages: context.conversationHistory || [],
            relevantMemories: context.memories || [],
            agent: context.agent
        });
        
        console.log('3. Handler result:', {
            fromNode: currentNode.id,
            toNode: result.nextNode,
            hasResponse: !!result.response
        });

        // Update internal state
        this.initialState = {
            ...this.initialState,
            currentNode: result.nextNode,
            ...result.updatedState
        };

        return {
            response: result.response,
            nextNode: result.nextNode,
            updatedState: this.initialState
        };
    }

    public getNodes(): Map<ConversationNodeType, ConversationNode> {
        return this.nodes;
    }

    public addNode(node: ConversationNode): void {
        this.nodes.set(node.id, node);
    }
} 