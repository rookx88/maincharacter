
export enum MemoryType {
    FIRST_MEETING = 'first_meeting',
    SIGNIFICANT_MOMENT = 'significant_moment',
    SHARED_INTEREST = 'shared_interest',
    OPPORTUNITY = 'opportunity',
    ACTIVITY = 'activity'
}

export interface MemoryCreationContext {
    type: MemoryType;
    content: string;
    significance: number;
    emotions: string[];
    topics: string[];
    relatedMemories?: string[]; // IDs of related memories
}

export interface MemoryQueryOptions {
    type?: MemoryType;
    minSignificance?: number;
    topics?: string[];
    timeRange?: {
        start: Date;
        end: Date;
    };
    limit?: number;
}

export interface MemoryAnalysis {
    significance: number;
    emotions: string[];
    topics: string[];
    shouldCreate: boolean;
    suggestedType: MemoryType;
} 