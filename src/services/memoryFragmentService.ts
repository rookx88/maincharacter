import { MemoryFragment } from '../types/memoryFragment.js';
import MemoryFragmentModel, { MemoryFragmentDocument } from '../models/memoryFragmentModel.js';
import { MemoryFragmentSchema } from '../schemas/memoryFragmentSchema.js';
import crypto from 'crypto';

export class MemoryFragmentService {
    // Create a new memory fragment
    async createMemoryFragment(userId: string, data: Omit<MemoryFragment, 'id' | 'system'>): Promise<MemoryFragmentDocument> {
        // Validate data with auto-generated id
        const validatedData = await MemoryFragmentSchema.parseAsync({
            ...data,
            id: crypto.randomUUID(),  // Explicitly generate ID
            system: {
                userId,
                createdAt: new Date(),
                updatedAt: new Date(),
                version: 1
            }
        });

        // Create and return new memory fragment
        return await MemoryFragmentModel.create(validatedData);
    }

    // Get all memory fragments for a user
    async getUserMemories(userId: string, options?: {
        limit?: number;
        skip?: number;
        timePeriod?: string;
        tags?: string[];
    }): Promise<MemoryFragmentDocument[]> {
        const query: Record<string, any> = { "system.userId": userId };
        
        // Add filters if provided
        if (options?.timePeriod) {
            query["date.timePeriod"] = options.timePeriod;
        }
        if (options?.tags?.length) {
            query["tags"] = { $in: options.tags };
        }

        return await MemoryFragmentModel
            .find(query)
            .sort({ "date.timestamp": -1 })
            .skip(options?.skip || 0)
            .limit(options?.limit || 50);
    }

    // Get a specific memory fragment
    async getMemoryFragment(userId: string, memoryId: string): Promise<MemoryFragmentDocument | null> {
        return await MemoryFragmentModel.findOne({
            _id: memoryId,
            "system.userId": userId
        });
    }

    // Update a memory fragment
    async updateMemoryFragment(
        userId: string,
        memoryId: string,
        updates: Partial<Omit<MemoryFragment, 'id' | 'system'>>
    ): Promise<MemoryFragmentDocument | null> {
        // Validate updates
        const validatedUpdates = await MemoryFragmentSchema.partial().parseAsync(updates);

        return await MemoryFragmentModel.findOneAndUpdate(
            { _id: memoryId, "system.userId": userId },
            {
                ...validatedUpdates,
                "system.updatedAt": new Date()
            },
            { new: true }
        );
    }

    // Delete a memory fragment
    async deleteMemoryFragment(userId: string, memoryId: string): Promise<boolean> {
        const result = await MemoryFragmentModel.deleteOne({
            _id: memoryId,
            "system.userId": userId
        });
        return result.deletedCount === 1;
    }

    // Add this method to your existing MemoryFragmentService class
    async getMemoryFragments(userId: string, limit: number = 10): Promise<MemoryFragment[]> {
        const docs = await MemoryFragmentModel.find({ "system.userId": userId })
            .sort({ 'date.timestamp': -1 })
            .limit(limit)
            .lean()
            .exec();

        return docs.map(doc => ({
            ...doc,
            id: doc._id
        })) as MemoryFragment[];
    }
} 