export interface AIAgent {
    name: string;
    category: string;
    bio: string[];
    expertise: {
        topics: string[];
        specialties: string[];
    };
    style: {
        speaking: string[];
        tone: string[];
        patterns: string[];
        greeting?: string;
        followUps?: string[];
    };
    traits: {
        core: string[];
        adaptive: Record<string, number>;
    };
    messageExamples?: Array<{
        context: string;
        userMessage: string;
        response: string;
    }>;
    responsePreferences?: {
        defaultLength: string;
        questionFrequency: string;
        emotionalDepth: string;
        memoryUsage: string;
    };
    model: string;
    temperature: number;
    presence_penalty?: number;
    frequency_penalty?: number;
    systemPrompt: string;
} 