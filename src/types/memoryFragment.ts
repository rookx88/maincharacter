import { TimePeriod } from './common.js';

export interface MemoryFragment {
    // Core Metadata
    id: string;
    title: string;
    description: string;
    date: {
        timestamp: Date;
        timePeriod: TimePeriod;
    };
    location: {
        name: string;
        coordinates?: {
            latitude: number;
            longitude: number;
        };
    };

    // Relational Metadata
    people: Array<{
        name: string;
        relationship?: string;
    }>;
    tags: string[];
    media?: Array<{
        type: 'photo' | 'video' | 'audio';
        url: string;
        caption?: string;
    }>;

    // Contextual Metadata
    context: {
        emotions: string[];
        significance: number;  // 1-5 rating
        themes: string[];
        aiRelevance?: number;  // 0-1 rating for AI context
    };

    // System Metadata
    system: {
        userId: string;
        source: string;
        createdAt: Date;
        updatedAt: Date;
        version: number;
    };

    // Additional Metadata
    status: 'complete' | 'needs_details' | 'unverified';
    missingFields?: string[];

    // Add new fields
    aiMemoryKey?: string;  // Reference to associated AI memory
    conversationId?: string;  // Reference to source conversation
}

export type MemoryFragmentStatus = 
    'complete' | 'needs_details' | 'unverified';