import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Login from './components/Login';
import Register from './components/Register';
import AgentSelection from './components/AgentSelection';
import ProtectedRoute from './components/ProtectedRoute';
import Header from './components/Header';
import Footer from './components/Footer';
import MemoryViewer from './components/MemoryViewer';
import NewConversationUI from './components/NewConversationUI';

const AppRoutes = () => {
    const { user } = useAuth();
    console.log('Current user:', user);

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
            <Route 
                path="/conversation/:agentSlug" 
                element={
                    <ProtectedRoute>
                        <NewConversationUI />
                    </ProtectedRoute>
                } 
            />
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
        </Routes>
    );
};

function App() {
    return (
        <AuthProvider>
            <Router>
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