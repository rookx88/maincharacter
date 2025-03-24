import { Request, Response } from 'express';
import { MemoirService } from '../services/memoirService.js';
import { ConversationError } from '../utils/conversationError.js';
import { handleError } from '../utils/errorHandler.js';

export class MemoirController {
    private memoirService: MemoirService;

    constructor() {
        this.memoirService = new MemoirService();
    }

    generateMemoir = async (req: Request, res: Response): Promise<void> => {
        try {
            const { userId } = req.body;
            if (!userId) {
                throw new ConversationError('User ID is required', 400);
            }

            const memoir = await this.memoirService.createMemoir(userId);
            res.json(memoir);
        } catch (error) {
            handleError(res, error);
            return;
        }
    };

    getMemoir = async (req: Request, res: Response): Promise<void> => {
        try {
            const { userId, memoirId } = req.params;
            const memoir = await this.memoirService.getMemoir(userId, memoirId);
            res.json(memoir);
        } catch (error) {
            handleError(res, error);
            return;
        }
    };

    getAllMemoirs = async (req: Request, res: Response): Promise<void> => {
        try {
            const { userId } = req.params;
            const memoirs = await this.memoirService.getAllMemoirs(userId);
            res.json(memoirs);
        } catch (error) {
            handleError(res, error);
            return;
        }
    };

    updateMemoir = async (req: Request, res: Response): Promise<void> => {
        try {
            const { memoirId } = req.params;
            const updates = req.body;
            const updatedMemoir = await this.memoirService.updateMemoir(memoirId, updates);
            res.json(updatedMemoir);
        } catch (error) {
            handleError(res, error);
            return;
        }
    };

    generateChapter = async (req: Request, res: Response): Promise<void> => {
        try {
            const { userId, timeframe } = req.body;
            const chapter = await this.memoirService.generateChapter(userId, timeframe);
            res.json(chapter);
        } catch (error) {
            handleError(res, error);
            return;
        }
    };
} 