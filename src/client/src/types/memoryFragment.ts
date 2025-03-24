import { TimePeriod } from './common';

export interface MemoryFragment {
    id: string;
    title: string;
    description: string;
    date: {
        timestamp: Date;
        timePeriod: TimePeriod;
    };
    people: Array<{
        name: string;
        role?: string;
    }>;
    tags: string[];
} 