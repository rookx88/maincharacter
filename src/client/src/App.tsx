import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Login from './components/Login';
import Register from './components/Register';
import AgentSelection from './components/AgentSelection';
import ProtectedRoute from './components/ProtectedRoute';
import Header from './components/Header';
import Footer from './components/Footer';
import MemoryViewer from './components/MemoryViewer';
import NewConversationUI from './components/NewConversationUI';
import ErrorBoundary from './components/ErrorBoundary';
import SimpleConversationUI from './components/SimpleConversationUI';
import { useEffect } from 'react';

const AppRoutes = () => {
    const { user } = useAuth();
    const location = useLocation();
    
    useEffect(() => {
        console.log('Current location:', location.pathname);
    }, [location]);
    
    return (
        <Routes>
            {/* Public routes */}
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            
            {/* Protected routes */}
            <Route path="/agents" element={
                <ProtectedRoute>
                    <AgentSelection />
                </ProtectedRoute>
            } />
            <Route path="/chat/:agentSlug" element={
                <ProtectedRoute>
                    <NewConversationUI />
                </ProtectedRoute>
            } />
            <Route path="/chat/:agentSlug/:conversationId" element={
                <ProtectedRoute>
                    <NewConversationUI />
                </ProtectedRoute>
            } />
            <Route path="/memory-viewer" element={
                <ProtectedRoute>
                    {user ? (
                        <MemoryViewer userId={user.id} />
                    ) : (
                        <div>Loading...</div>
                    )}
                </ProtectedRoute>
            } />
            
            {/* Redirect root to agents if logged in, otherwise to login */}
            <Route path="/" element={
                user ? <Navigate to="/agents" replace /> : <Navigate to="/login" replace />
            } />

            {/* Test route */}
            <Route path="/test" element={<div>Test Route Works!</div>} />

            {/* Catch-all route */}
            <Route path="*" element={
                <div style={{ padding: '20px', textAlign: 'center' }}>
                    <h2>Page Not Found</h2>
                    <p>The page you're looking for doesn't exist or has been moved.</p>
                    <p>Current path: {window.location.pathname}</p>
                    <button onClick={() => window.location.href = '/agents'}>
                        Go to Agent Selection
                    </button>
                </div>
            } />
        </Routes>
    );
};

function App() {
    return (
        <AuthProvider>
            <Router basename="/">
                <Header />
                <main className="main-content">
                    <AppRoutes />
                </main>
                <Footer />
            </Router>
        </AuthProvider>
    );
}

export default App; 