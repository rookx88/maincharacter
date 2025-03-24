import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { ConversationError } from '../utils/conversationError.js';

export const authenticateToken = (req: Request, res: Response, next: NextFunction) => {
    const token = req.cookies.token || req.headers.authorization?.split(' ')[1];
    console.log('Auth token:', token); // Check if we're getting the token

    if (!token) {
        return res.status(401).json({ message: 'No token provided' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET as string);
        req.user = decoded;
        console.log('Decoded user:', decoded); // Check decoded user data
        next();
    } catch (error) {
        console.error('Token verification failed:', error);
        return res.status(403).json({ message: 'Invalid token' });
    }
}; 