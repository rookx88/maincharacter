import { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';

export const validateAgentId = (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.agentId)) {
        return res.status(400).json({ error: 'Invalid agent ID format' });
    }
    next();
}; 