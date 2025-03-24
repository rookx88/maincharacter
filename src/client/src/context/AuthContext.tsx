import React, { createContext, useContext, useState, useEffect } from 'react';
import axios from 'axios';

interface User {
    id: string;
    name: string;
    email: string;
}

interface AuthContextType {
    user: User | null;
    loading: boolean;
    login: (email: string, password: string) => Promise<void>;
    register: (email: string, password: string, name: string) => Promise<void>;
    logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const initializeAuth = async () => {
            try {
                setLoading(true);
                const response = await axios.get('/api/auth/verify');
                if (response.data.user) {
                    setUser(response.data.user);
                }
            } catch (error) {
                console.error('Auth initialization failed:', error);
                setUser(null);
            } finally {
                setLoading(false);
            }
        };

        initializeAuth();
    }, []);

    const login = async (email: string, password: string) => {
        try {
            const response = await axios.post('/api/auth/login', { email, password });
            if (!response.data.user) {
                throw new Error('No user data received');
            }
            setUser(response.data.user);
            return response.data.user;
        } catch (error) {
            console.error('Login error:', error);
            throw new Error('Login failed');
        }
    };

    const register = async (email: string, password: string, name: string) => {
        try {
            const response = await axios.post('/api/auth/register', {
                email,
                password,
                name
            });
            setUser(response.data.user);
        } catch (error) {
            throw new Error('Registration failed');
        }
    };

    const logout = () => {
        setUser(null);
    };

    return (
        <AuthContext.Provider value={{ user, loading, login, register, logout }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}; 