import mongoose from 'mongoose';
import { Memoir } from '../types/memoir.js';

const memoirSchema = new mongoose.Schema({
    userId: { type: String, required: true, ref: 'User' },
    title: String,
    chapters: [{
        title: String,
        theme: String,
        timeframe: {
            start: Date,
            end: Date
        },
        memoryFragments: [{
            conversationId: { type: String, ref: 'Conversation' },
            content: String,
            context: {
                agent: String,
                topic: String,
                emotion: String,
                timestamp: Date,
                triggers: [String]
            },
            metadata: {
                significance: Number,
                verification: Boolean,
                clarity: Number
            },
            tags: [String],
            connections: [String]
        }],
        narrativeFlow: String
    }],
    metadata: {
        timespan: {
            from: Date,
            to: Date
        },
        mainCharacters: [String],
        locations: [String],
        themes: [String]
    }
}, {
    timestamps: true
});

export default mongoose.model<Memoir>('Memoir', memoirSchema);
