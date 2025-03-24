export interface Chapter {
    id: string;
    title: string;
    type: ChapterType;
    memoryFragments: string[];  // IDs of relevant MemoryFragments
    
    // Chapter-specific metadata
    metadata: {
        timeframe: {
            start: Date;
            end: Date;
        };
        themes: string[];
        emotionalTone: string[];
        keyCharacters: string[];
    };
    
    // Generated content
    content?: {
        opening: string;
        body: string;
        closing: string;
    };
}

export enum ChapterType {
    INTRODUCTION = "Introduction",
    ROOTS = "Roots",
    TRIALS = "Trials and Triumphs",
    RELATIONSHIPS = "Love and Relationships",
    TURNING_POINTS = "Turning Points",
    REFLECTIONS = "Reflections",
    CONCLUSION = "Legacy"
}

export interface ChapterTemplate {
    type: ChapterType;
    purpose: string;
    requiredThemes: string[];
    narrativeStyle: string;
    promptTemplate: string;
} 