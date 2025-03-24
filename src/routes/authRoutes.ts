import express from 'express';
import { register, login, logout, getProfile } from '../controllers/authController.js';
import authMiddleware from '../middleware/authMiddleware.js';

const router = express.Router();

// Auth routes
router.post('/register', register);
router.post('/login', login);
router.post('/logout', logout);
router.get('/profile', authMiddleware, getProfile);
router.get('/verify', authMiddleware, (req, res) => {
    // The protect middleware already verified the token
    res.json({ user: req.user });
});

export default router; 