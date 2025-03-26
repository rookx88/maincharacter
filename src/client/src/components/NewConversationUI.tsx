import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
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
    const [showEndModal, setShowEndModal] = useState(false);
    const navigate = useNavigate();

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
                
                // Start a new conversation to ensure we get the initial message
                console.log('Starting new conversation for testing');
                const startRes = await axios.post('/api/conversations/start', 
                    { agentSlug }, 
                    { withCredentials: true }
                );
                
                if (startRes.data?.messages && startRes.data.messages.length > 0) {
                    console.log('Initial messages from start:', startRes.data.messages);
                    setMessages(startRes.data.messages);
                } else {
                    console.log('No initial messages in start response, checking messages endpoint');
                    
                    // Fallback to getting messages if start doesn't return them
                    try {
                        const messagesRes = await axios.get(`/api/conversations/${agentSlug}/messages`, {
                            withCredentials: true,
                            timeout: 10000
                        });
                        
                        console.log('Messages received:', messagesRes.data);
                        
                        if (messagesRes.data?.messages && messagesRes.data.messages.length > 0) {
                            setMessages(messagesRes.data.messages);
                            console.log(`Loaded ${messagesRes.data.messages.length} messages`);
                        } else {
                            console.warn('No messages found in either endpoint');
                        }
                    } catch (messagesError) {
                        console.warn('Could not fetch messages:', messagesError);
                    }
                }
                
                // Get full agent details
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
                }
                
            } catch (error) {
                console.error('Failed to load conversation:', error);
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

    // Add this at the top of the component
    useEffect(() => {
        // Force show the modal for testing
        if (messages.length > 0) {
            const lastMessage = messages[messages.length - 1];
            if (lastMessage.role === 'assistant' && 
                lastMessage.content.includes("I need to run now and get ready for the show")) {
                console.log('Detected end message, showing modal');
                setShowEndModal(true);
            }
        }
    }, [messages]);

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
            
            const currentMessage = inputMessage;
            setInputMessage('');

            console.log('Sending message to server:', currentMessage);
            
            const response = await axios.post('/api/conversations/message', {
                message: currentMessage,
                agentSlug: agentSlug,
            }, {
                withCredentials: true
            });

            console.log('Backend response (raw):', response);
            console.log('Backend response (data):', response.data);

            // Add more detailed logging for the conversation ended flag
            console.log('Checking conversation ended flag:', {
                conversationEnded: response.data.conversationEnded,
                fullResponse: response.data
            });

            // Force check for the end message
            if (response.data.conversationEnded || 
                (typeof response.data.message === 'string' && 
                 response.data.message.includes("I need to run now and get ready for the show"))) {
                console.log('Conversation ended, showing modal');
                setShowEndModal(true);
            }

            // Extract the message string from the response
            let messageContent = '';
            
            if (typeof response.data.message === 'string') {
                messageContent = response.data.message;
            } else if (typeof response.data.response === 'string') {
                messageContent = response.data.response;
            } else if (response.data.message && response.data.message.response) {
                messageContent = response.data.message.response;
            } else if (response.data.response && response.data.response.response) {
                messageContent = response.data.response.response;
            } else {
                console.error('Could not extract message content from response:', response.data);
                messageContent = "Sorry, I couldn't process that message.";
            }
            
            console.log('Extracted message content:', messageContent);
            
            // Add the AI's response to the messages
            setMessages(prev => [...prev, 
                { role: 'assistant', content: messageContent, timestamp: new Date() }
            ]);

        } catch (error) {
            console.error('Message send error:', error);
            setError('Failed to send message');
        } finally {
            setIsLoading(false);
        }
    };

    const resetConversation = async () => {
        try {
            setIsLoading(true);
            console.log('Resetting conversation for testing');
            
            // Delete the current conversation
            await axios.delete(`/api/conversations/${agentSlug}`, {
                withCredentials: true
            });
            
            // Start a new conversation
            const startRes = await axios.post('/api/conversations/start', 
                { agentSlug }, 
                { withCredentials: true }
            );
            
            if (startRes.data?.messages) {
                setMessages(startRes.data.messages);
                console.log(`Started new conversation with ${startRes.data.messages.length} messages`);
            } else {
                setMessages([]);
            }
        } catch (error) {
            console.error('Error resetting conversation:', error);
            setError('Failed to reset conversation');
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

            <div className="chat-controls">
                <button 
                    className="reset-button"
                    onClick={resetConversation}
                    disabled={isLoading}
                >
                    Reset Conversation (Testing)
                </button>
            </div>

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

            {showEndModal && (
                <div className="end-modal">
                    <div className="end-modal-content">
                        <h2>Alex had to run off to start his podcast</h2>
                        <p>I should really come back another time...</p>
                        <button onClick={() => navigate('/agents')}>
                            Return to Agent Selection
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
} 