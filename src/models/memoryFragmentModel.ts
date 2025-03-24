import mongoose, { Schema, Document } from "mongoose";
import { MemoryFragment } from "../types/memoryFragment.js";
import * as crypto from "crypto";
import { getTimePeriod } from '../utils/timeUtils.js';
import { TimePeriod } from '../types/common.js';

// MongoDB Schema for MemoryFragment
const memoryFragmentSchema = new Schema({
    _id: { type: String, required: true, default: () => crypto.randomUUID() },
    title: { type: String, required: true },
    description: { type: String, required: true },
    date: {
        timestamp: { type: Date, required: true },
        approximateDate: String,
        timePeriod: {
            type: String,
            enum: Object.values(TimePeriod),
            required: true
        }
    },
    location: {
        name: { type: String, required: true },
        coordinates: {
            latitude: Number,
            longitude: Number
        }
    },

    // Simplified array definitions
    people: [{
        name: String,
        relationship: String
    }],
    tags: [String],
    media: [{
        _id: false,
        type: { type: String, enum: ['photo', 'video', 'audio'] },
        url: String,
        caption: String
    }],

    // Contextual Metadata
    context: {
        emotions: [String],
        significance: { type: Number, min: 1, max: 5 },
        themes: [String],
        aiRelevance: { type: Number, min: 0, max: 1 }
    },

    // System Metadata
    system: {
        userId: { 
            type: Schema.Types.ObjectId,
            required: true,
            ref: 'User'
        },
        created: {
            type: Date,
            default: Date.now
        },
        updatedAt: { type: Date, default: Date.now },
        version: { type: Number, default: 1 }
    },

    status: {
        type: String,
        enum: ['complete', 'needs_details', 'unverified'],
        required: true
    },

    missingFields: [{
        type: String
    }],

    // Add new fields
    aiMemoryKey: { type: String },
    conversationId: { type: Schema.Types.ObjectId, ref: 'Conversation' },
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Indexes for efficient querying
memoryFragmentSchema.index({ "system.userId": 1, "date.timestamp": -1 });
memoryFragmentSchema.index({ "system.userId": 1, "tags": 1 });
memoryFragmentSchema.index({ "system.userId": 1, "date.timePeriod": 1 });
memoryFragmentSchema.index({ "aiMemoryKey": 1 });
memoryFragmentSchema.index({ "conversationId": 1 });

// Pre-save middleware to update version
memoryFragmentSchema.pre('save', function(this: MemoryFragmentDocument, next) {
    if (this.isModified() && !this.isNew && this.system) {
        this.system.version = (this.system.version || 1) + 1;
    }
    if (!this.system?.userId) {
        throw new Error('Memory must belong to a user');
    }
    
    if (!this.date.timePeriod) {
        // Auto-detect time period from timestamp
        this.date.timePeriod = getTimePeriod(this.date.timestamp);
    }
    next();
});

// Use Omit to exclude 'id' from MemoryFragment when extending Document
export interface MemoryFragmentDocument extends Omit<MemoryFragment, 'id'>, Document {
    _id: string;
}

// Add a virtual getter for 'id' that returns _id
memoryFragmentSchema.virtual('id').get(function() {
    return this._id;
});

export default mongoose.model<MemoryFragmentDocument>('MemoryFragment', memoryFragmentSchema); 