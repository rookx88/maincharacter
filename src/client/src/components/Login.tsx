import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import './Auth.css';

const Login: React.FC = () => {
    const { login } = useAuth();
    const navigate = useNavigate();
    const [error, setError] = useState('');

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        const email = formData.get('email') as string;
        const password = formData.get('password') as string;

        try {
            await login(email, password);
            navigate('/agents'); // Redirect after successful login
        } catch (error) {
            setError('Login failed. Please check your credentials.');
            console.error('Login error:', error);
        }
    };

    return (
        <div className="auth-container">
            <form onSubmit={handleSubmit} className="auth-form">
                <h2>Welcome Back</h2>
                {error && <div className="error">{error}</div>}
                <input
                    type="email"
                    placeholder="Email"
                    name="email"
                />
                <input
                    type="password"
                    placeholder="Password"
                    name="password"
                />
                <button type="submit">Login</button>
                <p>
                    Don't have an account? <a href="/register">Register</a>
                </p>
            </form>
        </div>
    );
};

export default Login; 