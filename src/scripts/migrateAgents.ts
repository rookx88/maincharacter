import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { connectDB } from '../config/database.js';

dotenv.config();

async function migrateAgents() {
    try {
        await connectDB();
        console.log('Connected to MongoDB');

        if (!mongoose.connection.db) {
            throw new Error('Database not connected');
        }
        const db = mongoose.connection.db;

        // 1. Get all documents from aiprofiles
        console.log('Fetching profiles from aiprofiles...');
        const oldProfiles = await db.collection('aiprofiles').find({}).toArray();
        console.log(`Found ${oldProfiles.length} profiles to migrate`);

        if (oldProfiles.length === 0) {
            console.log('No profiles to migrate');
            process.exit(0);
        }

        // 2. Insert into new agents collection
        console.log('Inserting into agents collection...');
        const result = await db.collection('agents').insertMany(oldProfiles);
        console.log(`Successfully migrated ${result.insertedCount} agents`);

        // Optional: Verify migration
        const newCount = await db.collection('agents').countDocuments();
        console.log(`Total agents in new collection: ${newCount}`);

    } catch (error) {
        console.error('Migration failed:', error);
    } finally {
        await mongoose.disconnect();
        console.log('Disconnected from MongoDB');
    }
}

migrateAgents(); 