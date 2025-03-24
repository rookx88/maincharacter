export interface MemoryFragment {
    // Core Identifiers
    id: string;
    userId: string;
    timestamp: Date;  // When the memory was created

    // Content
    content: {
        userMessage: string;
        aiResponse: string;
    };

    // Basic Analysis
    analysis: {
        // Time Context
        timePeriod: TimePeriod;  // Life period (enum from before)
        yearEstimate?: number;    // Approximate year if mentioned
        
        // Memory Classification
        significance: number;     // 0-1 score
        primaryEmotion: string;   // Main emotion
        
        // Key Elements
        people: string[];        // People mentioned
        places: string[];        // Locations mentioned
        topics: string[];        // Main topics/themes
    };

    // Metadata
    metadata: {
        agentId: string;         // Which AI agent was involved
        confidence: number;      // How confident in the analysis (0-1)
        verified: boolean;       // User verified this memory
    };
}

// Supporting Types
export enum TimePeriod {
    CHILDHOOD = "Childhood",      // 0-12
    TEENAGER = "Teenager",        // 13-19
    YOUNG_ADULT = "Young Adult",  // 20-35
    ADULT = "Adult",             // 36-55
    OLDER_ADULT = "Older Adult"  // 56+
}

export interface RawMemoryInput {
    content: string;
    source: string;
    userId: string;
    metadata: {
        [key: string]: any;
    };
} 