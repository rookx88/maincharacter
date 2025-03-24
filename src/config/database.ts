import mongoose from "mongoose";

export const connectDB = async () => {
    try {
        const conn = await mongoose.connect(process.env.MONGO_URI!);
        console.log("MongoDB connected successfully!");
        if (!conn.connection.db) {
            throw new Error('Database connection not established');
        }
        console.log('Database name:', conn.connection.db.databaseName);
        
        // List collections
    } catch (error) {
        console.error("Error connecting to MongoDB:", error);
        process.exit(1);
    }
}; 