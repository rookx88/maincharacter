import mongoose from 'mongoose';
import dotenv from 'dotenv';
import AgentModel from '../models/agentModel.js';
import { profiles } from '../templates/profiles/index.js';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/heirloom';

async function seedAgents() {
    try {
        await mongoose.connect(MONGODB_URI);
        console.log('Connected to MongoDB');
        
        await AgentModel.deleteMany({});
        console.log('Cleared existing agents');
        
        const result = await AgentModel.create(profiles);
        
        console.log('Successfully seeded agents:', result);
    } catch (error) {
        console.error('Error seeding agents:', error);
    } finally {
        await mongoose.disconnect();
    }
}

seedAgents(); 