export interface DateRange {
    from: Date;
    to: Date;
}

export interface MemoryFragment {
    id: string;
    conversationId: string;
    content: string;
    context: {
        agent: string;
        topic: string[];
        emotion: string;
        timestamp: Date;
        triggers: string[];
    };
    metadata: {
        significance: number;
        verification: boolean;
        clarity: number;
    };
    tags: string[];
    connections: string[];
}

export interface Chapter {
    title: string;
    content: string;
    themes: string[];
    timeframe: DateRange;
}

export interface Memoir {
    userId: string;
    title: string;
    chapters: Chapter[];
    metadata: {
        timespan: DateRange;
        mainCharacters: string[];
        locations: string[];
        themes: string[];
    };
}

// Define possible time periods
export enum TimePeriod {
    CHILDHOOD = "Childhood",      // 0-12
    TEENAGER = "Teenager",        // 13-19
    YOUNG_ADULT = "Young Adult",  // 20-35
    ADULT = "Adult",             // 36-55
    OLDER_ADULT = "Older Adult"  // 56+
}

export interface SimpleMemoryFragment {
    id: string;
    content: {
        userMessage: string;
        aiResponse: string;
    };
    timestamp: Date;
    analysis: {
        significance: number;     // 0-1 score
        topics: string[];        // Main topics discussed
        emotion: string;         // Primary emotion
        timePeriod: TimePeriod;  // When the memory occurred
        yearEstimate?: number;   // Approximate year if mentioned
    };
}
