import mongoose, { Schema, Document } from 'mongoose';
import { AIMemory } from '../types/aiMemory.js';

const AIMemorySchema = new Schema({
    userId: { type: String, required: true },
    agentId: { type: String, required: true },
    content: { type: String, required: true },
    type: { type: String, required: true },
    significance: { type: Number, required: true },
    timestamp: { type: Date, default: Date.now },
    lastAccessed: { type: Date, default: Date.now }
});

// Indexes for efficient querying
AIMemorySchema.index({ userId: 1, agentId: 1 });
AIMemorySchema.index({ significance: -1 });
AIMemorySchema.index({ lastAccessed: -1 });

export default mongoose.model<AIMemory & Document>('AIMemory', AIMemorySchema); 