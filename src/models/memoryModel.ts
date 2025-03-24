import mongoose from 'mongoose';
import { TimePeriod } from '../types/common.js';

const memorySchema = new mongoose.Schema({
    id: String,
    content: String,
    timestamp: Date,
    significance: Number,
    timePeriod: {
        type: String,
        enum: Object.values(TimePeriod),
        default: TimePeriod.Present
    },
    yearEstimate: Number,
    summary: String,
    topics: [String],
    lastAccessed: Date,
    type: {
        type: String,
        default: 'general'
    },
    source: {
        type: String,
        default: 'conversation'
    }
});

export default mongoose.model('Memory', memorySchema); 