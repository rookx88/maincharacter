import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/userModel.js';
import { ConversationError } from '../utils/conversationError.js';
import { handleError } from '../utils/errorHandler.js';
import { generateToken } from '../utils/tokenGenerator.js';
import bcrypt from 'bcryptjs';

export const register = async (req: Request, res: Response): Promise<void> => {
    try {
        const { email, password, name } = req.body;

        const userExists = await User.findOne({ email });
        if (userExists) {
            res.status(400).json({ error: 'User already exists' });
            return;
        }

        const user = await User.create({
            email,
            password,
            name
        });

        const token = generateToken(user._id.toString());

        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
        });

        res.status(201).json({
            _id: user._id,
            name: user.name,
            email: user.email
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Registration failed' });
    }
};

export const login = async (req: Request, res: Response) => {
    try {
        const { email, password } = req.body;
        
        // Find user
        const user = await User.findOne({ email });
        console.log('Found user:', user);
        if (!user) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        // Verify password
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        // Create token
        const token = jwt.sign(
            { id: user._id },
            process.env.JWT_SECRET as string,
            { expiresIn: '30d' }
        );

        // Set cookie
        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
        });

        // Send response
        res.json({
            user: {
                id: user._id,
                email: user.email,
                name: user.name
            }
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
};

export const logout = async (req: Request, res: Response): Promise<void> => {
    res.cookie('token', '', {
        httpOnly: true,
        expires: new Date(0)
    });
    res.status(200).json({ message: 'Logged out successfully' });
};

export const getProfile = async (req: Request, res: Response): Promise<void> => {
    try {
        const user = await User.findById(req.userId).select('-password');
        if (!user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }
        res.json(user);
    } catch (error) {
        console.error('Profile error:', error);
        res.status(500).json({ error: 'Failed to get profile' });
    }
}; 