import express from "express";
import dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import cookieParser from 'cookie-parser';
import { connectDB } from "./config/database.js";
import conversationRoutes from "./routes/conversationRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import memoryRoutes from './routes/memoryRoutes.js';
import agentRoutes from './routes/agentRoutes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config();

const app = express();

// Middleware
app.use(express.json());
app.use(cookieParser());

// Connect to MongoDB
connectDB();

// Add this before your routes
app.use((req, res, next) => {
    console.log('10. Server - Incoming request:', {
        method: req.method,
        path: req.path,
        body: req.body,
        query: req.query
    });
    next();
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/conversations', conversationRoutes);
app.use('/api/memories', memoryRoutes);
app.use('/api/agents', agentRoutes);

// Debug route
app.get('/api/test', (req, res) => {
    res.json({ message: 'API is working' });
});

// Serve static files and React app AFTER API routes
const clientPath = path.join(__dirname, '../dist/client');
app.use(express.static(clientPath));
app.get('*', (req, res) => {
    // Serve index.html for all routes except /api
    if (!req.path.startsWith('/api')) {
        res.sendFile(path.join(__dirname, 'client/index.html'));
    }
});

// Add after routes are mounted
app.use((req, res, next) => {
    console.log('Request URL:', req.url);
    next();
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

export default app; 