export class ConversationError extends Error {
    constructor(
        public message: string,
        public statusCode: number = 500,
        public details?: any
    ) {
        super(message);
        this.name = 'ConversationError';
    }
} 