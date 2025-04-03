import { Response } from 'express';

// Keep both error classes for backward compatibility
export class ConversationError extends Error {
    constructor(
        public message: string,
        public statusCode: number = 500
    ) {
        super(message);
        this.name = 'ConversationError';
    }
}

export class AppError extends Error {
    constructor(
        public message: string,
        public statusCode: number = 500,
        public code?: string,
        public details?: any
    ) {
        super(message);
        this.name = this.constructor.name;
        Error.captureStackTrace(this, this.constructor);
    }
}

// Keep the original function signature for backward compatibility
export const handleError = (res: Response, error: unknown) => {
    if (error instanceof ConversationError || error instanceof AppError) {
        return res.status(error.statusCode).json({ error: error.message });
    }
    
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: message });
};

// Add the new function for internal error handling
export const processError = (error: any): AppError => {
    if (error instanceof AppError) {
        return error;
    }
    
    // Handle OpenAI errors
    if (error.name === 'OpenAIError') {
        return new AppError(
            'Error communicating with AI service',
            503,
            'OPENAI_ERROR',
            { originalError: error.message }
        );
    }
    
    // Handle database errors
    if (error.name === 'MongoError' || error.name === 'MongooseError') {
        return new AppError(
            'Database operation failed',
            500,
            'DATABASE_ERROR',
            { originalError: error.message }
        );
    }
    
    // Default error
    return new AppError(
        error.message || 'An unexpected error occurred',
        500,
        'INTERNAL_ERROR',
        { originalError: error }
    );
}; 