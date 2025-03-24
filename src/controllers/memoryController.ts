import { Request, Response } from 'express';
import MemoryFragment from '../models/memoryFragmentModel.js';
import { handleError } from '../utils/errorHandler.js';

export class MemoryController {
    async createMemoriesBatch(req: Request, res: Response) {
        try {
            const memories = await MemoryFragment.insertMany(req.body);
            res.status(201).json(memories);
        } catch (error) {
            handleError(res, error);
        }
    }

    async getMemoryFragments(req: Request, res: Response) {
        try {
            console.log('Getting memories for userId:', req.params.userId);
            if (!req.params.userId) {
                console.log('No userId provided');
                return res.status(400).json({ error: 'userId is required' });
            }
            const memories = await MemoryFragment.find({ 
                'system.userId': req.params.userId 
            });
            console.log('Found memories:', memories);
            res.json(memories);
        } catch (error) {
            console.error('Database error:', error);
            handleError(res, error);
        }
    }
} 