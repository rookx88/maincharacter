import mongoose from "mongoose";

export const connectDB = async () => {
    try {
        // Add debug logging
        if (!process.env.MONGO_URI) {
            throw new Error('MONGO_URI is not defined in environment variables');
        }
        console.log('Attempting to connect to MongoDB...');
        
        const conn = await mongoose.connect(process.env.MONGO_URI, {
            serverSelectionTimeoutMS: 5000, // Timeout after 5s instead of 30s
            socketTimeoutMS: 45000, // Close sockets after 45s of inactivity
        });
        
        console.log("MongoDB connected successfully!");
        if (!conn.connection.db) {
            throw new Error('Database connection not established');
        }
        console.log('Database name:', conn.connection.db.databaseName);
        
        // List collections
    } catch (error) {
        console.error("Error connecting to MongoDB:", error);
        if (error instanceof Error) {
            console.error("Error details:", error.message);
            // Log the full error object for debugging
            console.error("Full error object:", JSON.stringify(error, null, 2));
        }
        process.exit(1);
    }
}; 