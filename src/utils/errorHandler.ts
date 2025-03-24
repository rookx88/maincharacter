import { Response } from 'express';

export class ConversationError extends Error {
    constructor(
        public message: string,
        public statusCode: number = 500
    ) {
        super(message);
        this.name = 'ConversationError';
    }
}

export const handleError = (res: Response, error: unknown) => {
    if (error instanceof ConversationError) {
        return res.status(error.statusCode).json({ error: error.message });
    }
    
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: message });
}; 