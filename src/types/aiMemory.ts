import { TimePeriod } from './common.js';

export interface AIMemory {
    id: string;
    content: string;
    timestamp: Date;
    significance: number;
    timePeriod: TimePeriod;
    yearEstimate: number;
    summary: string;
    topics: string[];
    lastAccessed: Date;
    type: string;
    source: string;
    userId: string;
    agentId: string;
} 