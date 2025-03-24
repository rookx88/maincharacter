import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import axios from 'axios';
import './NewConversationUI.css';

interface Message {
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
}

interface AgentProfile {
    id: string;
    slug: string;
    category: string;
    name?: string;
    avatar?: string;
}

export default function NewConversationUI() {
    const { agentSlug } = useParams<{ agentSlug: string }>();
    const { user, loading: authLoading } = useAuth();
    const [messages, setMessages] = useState<Message[]>([]);
    const [inputMessage, setInputMessage] = useState('');
    const [agent, setAgent] = useState<AgentProfile | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isInitializing, setIsInitializing] = useState(true);

    // Load agent profile and conversation
    useEffect(() => {
        const initializeChat = async () => {
            console.log('Initialization started', { agentSlug, user });
            if (!agentSlug || !user) {
                console.warn('Missing required params:', { agentSlug, userExists: !!user });
                return;
            }
            
            try {
                setIsInitializing(true);
                
                // Get the basic agent info
                const profileRes = await axios.get(`/api/agents/by-slug/${agentSlug}`, {
                    withCredentials: true,
                    timeout: 10000
                });
                
                console.log('Basic profile received:', profileRes.data);
                
                // Set the agent with basic data immediately
                setAgent(profileRes.data);
                
                // Get messages
                try {
                    const messagesRes = await axios.get(`/api/conversations/${agentSlug}/messages`, {
                        withCredentials: true,
                        timeout: 10000
                    });
                    
                    if (messagesRes.data?.messages) {
                        setMessages(messagesRes.data.messages);
                    }
                } catch (messagesError) {
                    console.warn('Could not fetch messages:', messagesError);
                    // Continue with empty messages array
                }
                
                // Try to get full details
                try {
                    const detailsRes = await axios.get(`/api/agents/${profileRes.data.id}`, {
                        withCredentials: true,
                        timeout: 10000
                    });
                    
                    if (detailsRes.data) {
                        setAgent(prevAgent => ({
                            ...prevAgent,
                            ...detailsRes.data
                        }));
                    }
                } catch (detailsError) {
                    console.warn('Could not fetch full agent details:', detailsError);
                    // Continue with basic profile
                }
                
            } catch (error) {
                console.error('Failed to load basic agent profile:', error);
                setError('Unable to load conversation. Please try again later.');
            } finally {
                setIsInitializing(false);
            }
        };

        initializeChat();
    }, [agentSlug, user]);

    // Add state change logger
    useEffect(() => {
        console.log('Auth loading state changed:', { authLoading, user, isInitializing });
    }, [authLoading, user, isInitializing]);

    // Add render logger
    console.log('Component render state:', { 
        authLoading,
        userExists: !!user,
        isInitializing,
        hasAgent: !!agent,
        messageCount: messages?.length
    });

    // Update handleSendMessage to use LangGraph
    const handleSendMessage = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!inputMessage.trim() || !user || !agentSlug) return;

        try {
            setIsLoading(true);
            
            // Add user message immediately
            setMessages(prev => [...prev, 
                { role: 'user', content: inputMessage, timestamp: new Date() }
            ]);
            setInputMessage('');

            const response = await axios.post('/api/conversations/message', {
                message: inputMessage,
                agentSlug: agentSlug,
            }, {
                withCredentials: true
            });

            console.log('Backend response:', response.data);

            // Access the nested response object
            const assistantResponse = response.data.response.response;

            if (typeof assistantResponse === 'string') {
                setMessages(prev => [...prev, 
                    { role: 'assistant', content: assistantResponse, timestamp: new Date() }
                ]);
            } else {
                console.error('Unexpected response format:', response.data);
            }

        } catch (error) {
            console.error('Message send error:', error);
            setError('Failed to send message');
        } finally {
            setIsLoading(false);
        }
    };

    if (authLoading) {
        return <div className="loading">Checking authentication status...</div>;
    }

    if (!user) {
        return <div className="error-message">Please login to continue</div>;
    }

    if (error) {
        return (
            <div className="chat-container">
                <div className="error-message">
                    <h3>Error</h3>
                    <p>{error}</p>
                    <button onClick={() => window.location.reload()}>
                        Try Again
                    </button>
                </div>
            </div>
        );
    }

    if (isInitializing) {
        return (
            <div className="chat-container">
                <div className="loading">
                    Loading conversation...
                </div>
            </div>
        );
    }

    console.log('Rendering with agent data:', agent);

    return (
        <div className="chat-container">
            {agent && (
                <div className="chat-header">
                    <div className="agent-avatar-placeholder">
                        {agent.slug.split('-').map(word => word[0]).join('').toUpperCase()}
                    </div>
                    <div className="agent-info">
                        <h2>{agent.slug.split('-').map(word => 
                            word.charAt(0).toUpperCase() + word.slice(1)
                        ).join(' ')}</h2>
                        <span>{agent.category}</span>
                    </div>
                </div>
            )}

            <div className="messages-area">
                {messages?.map((message, index) => (
                    <div key={index} className={`message ${message.role}`}>
                        <div className="message-content">{message.content}</div>
                    </div>
                ))}
            </div>

            <form onSubmit={handleSendMessage} className="message-input">
                <input
                    type="text"
                    value={inputMessage}
                    onChange={(e) => setInputMessage(e.target.value)}
                    placeholder="Type your message..."
                    disabled={isLoading}
                />
                <button 
                    type="submit" 
                    disabled={isLoading || !inputMessage.trim() || !user}
                >
                    {isLoading ? 'Sending...' : 'Send'}
                </button>
            </form>
        </div>
    );
} 