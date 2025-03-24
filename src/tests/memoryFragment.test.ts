import { MemoryFragmentService } from '../services/memoryFragmentService.js';
import { TimePeriod } from '../types/common.js';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

describe('MemoryFragment Tests', () => {
    beforeAll(async () => {
        try {
            await mongoose.connect(process.env.MONGO_URI!);
        } catch (error) {
            console.error('MongoDB connection error:', error);
            throw error;
        }
    });

    afterAll(async () => {
        await mongoose.connection.close();
    });

    it('should create and retrieve a memory fragment', async () => {
        const memoryService = new MemoryFragmentService();
        const userId = "test-user-123";
        
        // Test memory data
        const testMemory = {
            title: "First Day of School",
            description: "I remember my first day of kindergarten. My mom walked me to class.",
            status: 'unverified' as const,
            missingFields: [],  
            date: {
                timestamp: new Date('1995-09-01'),
                approximateDate: "Fall 1995",
                timePeriod: TimePeriod.Past
            },
            location: {
                name: "Springfield Elementary School"
            },
            people: [
                { name: "Mom", relationship: "mother" },
                { name: "Mrs. Thompson", relationship: "teacher" }
            ],
            tags: ["school", "childhood", "milestone"],
            context: {
                emotions: ["nervous", "excited"],
                significance: 5,
                themes: ["education", "independence"]
            }
        };

        // Create memory
        const createdMemory = await memoryService.createMemoryFragment(userId, testMemory);
        expect(createdMemory).toBeDefined();
        expect(createdMemory.title).toBe(testMemory.title);

        // Retrieve memories
        const memories = await memoryService.getMemoryFragments(userId);
        expect(memories).toBeDefined();
        expect(memories.length).toBeGreaterThan(0);
        expect(memories[0].title).toBe(testMemory.title);
    });
}); 