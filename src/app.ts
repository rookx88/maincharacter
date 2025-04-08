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

// Serve static files with proper MIME types
const clientPath = path.join(__dirname, '../dist/client');
app.use(express.static(clientPath, {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.js')) {
            res.setHeader('Content-Type', 'application/javascript');
        } else if (filePath.endsWith('.css')) {
            res.setHeader('Content-Type', 'text/css');
        } else if (filePath.endsWith('.svg')) {
            res.setHeader('Content-Type', 'image/svg+xml');
        } else if (filePath.endsWith('.json')) {
            res.setHeader('Content-Type', 'application/json');
        }
    }
}));

// Catch-all route for SPA (React Router)
app.get('*', (req, res, next) => {
    // Skip API routes and static files with extensions
    if (req.path.startsWith('/api') || req.path.includes('.')) {
        next();
        return;
    }
    
    // For all other routes, serve the index.html to support client-side routing
    res.sendFile(path.join(clientPath, 'index.html'));
});

// Add after routes are mounted
app.use((req, res, next) => {
    console.log('Request URL:', req.url);
    next();
});

const PORT = parseInt(process.env.PORT || '5001', 10);
const server = app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

server.on('error', (e: any) => {
    if (e.code === 'EADDRINUSE') {
        const newPort = PORT + 1;
        console.log(`Port ${PORT} is already in use. Trying port ${newPort}`);
        setTimeout(() => {
            server.close();
            const newServer = app.listen(newPort, () => {
                console.log(`Server running on http://localhost:${newPort}`);
            });
            
            // Transfer error handler to new server
            newServer.on('error', (e: any) => {
                console.error('Error starting server on new port:', e);
            });
        }, 1000);
    } else {
        console.error('Server error:', e);
    }
});

export default app;