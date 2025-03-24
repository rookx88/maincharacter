import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

// Add proper type for user in request
declare global {
    namespace Express {
        interface Request {
            userId?: string;
            user?: any;
        }
    }
}

const authMiddleware = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        console.log('Auth Middleware - Cookies:', req.cookies);
        const token = req.cookies.token;

        if (!token) {
            console.log('Auth Middleware - No token found in cookies');
            res.status(401).json({ error: 'Not authorized - No token' });
            return;
        }

        console.log('Auth Middleware - Token found:', token.substring(0, 20) + '...');
        const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { id: string };
        console.log('Auth Middleware - Decoded token:', decoded);

        req.userId = decoded.id;
        req.user = { id: decoded.id };
        console.log('Auth Middleware - Set user:', req.user);

        next();
    } catch (error) {
        console.error('Auth Middleware - Error:', error);
        res.status(401).json({ error: 'Not authorized - Invalid token' });
    }
};

export default authMiddleware; 