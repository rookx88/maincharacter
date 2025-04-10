import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../api/config';
import './NewConversationUI.css';
import TestControls from './TestControls';

interface Message {
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
}

interface Agent {
    _id: string;
    id: string;
    slug: string;
    category: string;
    name?: string;
    avatar?: string;
}

export default function NewConversationUI() {
    const { agentSlug, conversationId } = useParams<{ agentSlug: string; conversationId?: string }>();
    const { user, loading: authLoading } = useAuth();
    const [messages, setMessages] = useState<Message[]>([]);
    const [inputMessage, setInputMessage] = useState('');
    const [agent, setAgent] = useState<Agent | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isInitializing, setIsInitializing] = useState(true);
    const [showEndModal, setShowEndModal] = useState(false);
    const [suggestedResponses, setSuggestedResponses] = useState<string[]>([]);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const navigate = useNavigate();

    // Scroll to bottom of messages
    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    // Effect for scrolling
    useEffect(() => {
        scrollToBottom();
    }, [messages]);

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
                const profileRes = await api.get(`/agents/by-slug/${agentSlug}`);
                
                console.log('Basic profile received:', profileRes.data);
                
                // Set the agent with basic data immediately
                setAgent(profileRes.data);
                
                // Check if we have an existing conversation
                if (conversationId) {
                    // Load existing conversation
                    try {
                        const messagesRes = await api.get(`/conversations/${agentSlug}/messages`);
                        if (messagesRes.data?.messages && messagesRes.data.messages.length > 0) {
                            setMessages(messagesRes.data.messages);
                        } else {
                            // If no messages found for existing ID, start a new one
                            await startNewConversation();
                        }
                    } catch (error) {
                        console.error('Error loading existing conversation:', error);
                        await startNewConversation();
                    }
                } else {
                    // Start a new conversation
                    await startNewConversation();
                }
                
                // Get full agent details
                try {
                    const detailsRes = await api.get(`/agents/${profileRes.data.id}`);
                    
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
    }, [agentSlug, user, conversationId]);

    // Function to start a new conversation
    const startNewConversation = async () => {
        console.log('Starting new conversation');
        try {
            const startRes = await api.post('/conversations/start', { agentSlug });
            
            if (startRes.data?.messages && startRes.data.messages.length > 0) {
                console.log('Initial messages from start:', startRes.data.messages);
                setMessages(startRes.data.messages);
                
                // Check for suggested responses in the initial message
                if (startRes.data?.suggestedResponses) {
                    console.log('Initial suggested responses:', startRes.data.suggestedResponses);
                    setSuggestedResponses(startRes.data.suggestedResponses);
                }
            } else {
                console.warn('No initial messages in start response');
                setMessages([]);
                setSuggestedResponses([]);
            }
        } catch (error) {
            console.error('Error starting new conversation:', error);
            setError('Failed to start conversation. Please try again later.');
        }
    };

    // Reset conversation handler
    const resetConversation = async () => {
        try {
            setIsLoading(true);
            console.log('Resetting conversation');
            
            // Delete the current conversation
            await api.delete(`/conversations/${agentSlug}`);
            
            // Start a fresh conversation
            await startNewConversation();
            
            // Clear the end modal if it was showing
            setShowEndModal(false);
            setSuggestedResponses([]);
            
        } catch (error) {
            console.error('Error resetting conversation:', error);
            setError('Failed to reset conversation');
        } finally {
            setIsLoading(false);
        }
    };

    // Check for end conversation modal
    useEffect(() => {
        if (Array.isArray(messages) && messages.length > 0) {
            const lastMessage = messages[messages.length - 1];
            if (lastMessage && 
                lastMessage.role === 'assistant' && 
                typeof lastMessage.content === 'string' &&
                (lastMessage.content.includes("I need to run now") || 
                 lastMessage.content.includes("I should go now") ||
                 lastMessage.content.includes("I have to get ready"))) {
                console.log('Detected end message, showing modal');
                setShowEndModal(true);
            }
        }
    }, [messages]);

    // Send message handler
    const handleSendMessage = async (e?: React.FormEvent | { preventDefault: () => void }) => {
        if (e && typeof e.preventDefault === 'function') {
            e.preventDefault();
        }
        
        if (!inputMessage.trim() || isLoading || !user) return;
        
        try {
            setIsLoading(true);
            
            // Add the user message to the UI immediately
            const userMessage = {
                role: 'user' as const,
                content: inputMessage,
                timestamp: new Date()
            };
            setMessages(prev => [...prev, userMessage]);
            setInputMessage('');
            
            console.log('Sending message to API:', inputMessage);
            
            // Send the message to the API
            const response = await api.post('/conversations/message', {
                message: inputMessage,
                agentSlug
            });
            
            console.log('Full API response:', response);
            
            // Check if we have a response
            if (response.data) {
                const aiResponseText = typeof response.data.message === 'string' 
                    ? response.data.message 
                    : (typeof response.data.response === 'string' 
                        ? response.data.response 
                        : "I'm not sure how to respond to that.");
                
                console.log('AI response text:', aiResponseText);
                
                // Add the AI message to the UI
                const aiMessage = {
                    role: 'assistant' as const,
                    content: aiResponseText,
                    timestamp: new Date()
                };
                
                console.log('Adding AI message to UI:', aiMessage);
                
                // Update messages with the new AI message
                setMessages(prev => [...prev, aiMessage]);
                
                // Enhanced suggested responses handling
                console.log('Looking for suggested responses in:', response.data);
                
                // Try multiple places where suggested responses might be located
                const suggestedResponses = 
                    Array.isArray(response.data.suggestedResponses) ? response.data.suggestedResponses :
                    (response.data.metadata && Array.isArray(response.data.metadata.suggestedResponses)) ? 
                    response.data.metadata.suggestedResponses : [];
                
                console.log('Found suggested responses:', suggestedResponses);
                
                if (suggestedResponses.length > 0) {
                    setSuggestedResponses(suggestedResponses);
                } else {
                    setSuggestedResponses([]);
                }
                
                // Check for conversation end
                const conversationEnded = 
                    response.data.conversationEnded || 
                    (response.data.metadata && response.data.metadata.conversationEnded);
                
                if (conversationEnded) {
                    setShowEndModal(true);
                }
            } else {
                console.error('No data in response:', response);
            }
            
        } catch (error) {
            console.error('Error sending message:', error);
            setError('Failed to send message. Please try again.');
        } finally {
            setIsLoading(false);
        }
    };

    // Handle suggested response selection
    const handleSuggestedResponseClick = async (response: string) => {
        try {
            // Clear suggested responses immediately
            setSuggestedResponses([]);
            
            // Set input message to the selected response
            setInputMessage(response);
            
            // Submit the form
            await handleSendMessage({
                preventDefault: () => {},
                nativeEvent: {} as any,
                currentTarget: {} as any,
                target: {} as any,
                bubbles: false,
                cancelable: true,
                defaultPrevented: false,
                isDefaultPrevented: () => false,
                isPropagationStopped: () => false,
                persist: () => {},
                stopPropagation: () => {},
                timeStamp: Date.now(),
                type: 'submit'
            } as React.FormEvent<Element>);
            
        } catch (error) {
            console.error('Error handling suggested response:', error);
            setError('Failed to send message. Please try again.');
        }
    };

    // Handle end modal return to agents
    const handleReturnToAgents = () => {
        navigate('/agents');
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
                {Array.isArray(messages) && messages.length > 0 ? (
                    messages.map((message, index) => (
                        <div key={index} className={`message ${message.role}`}>
                            <div className="message-content">
                                {typeof message.content === 'string' ? message.content : 'No content'}
                            </div>
                        </div>
                    ))
                ) : (
                    <div className="no-messages">Start a conversation</div>
                )}
                <div ref={messagesEndRef} />
            </div>

            {Array.isArray(suggestedResponses) && suggestedResponses.length > 0 && (
                <div className="suggested-responses">
                    <p className="suggested-responses-title">Suggested responses:</p>
                    <div className="suggested-responses-container">
                        {suggestedResponses.map((response, index) => (
                            <button 
                                key={index}
                                className="suggested-response"
                                onClick={() => handleSuggestedResponseClick(response)}
                            >
                                {response}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            <form onSubmit={handleSendMessage} className="message-input">
                <input
                    type="text"
                    value={inputMessage}
                    onChange={(e) => setInputMessage(e.target.value)}
                    placeholder="Type your message..."
                    disabled={isLoading || showEndModal}
                />
                <button 
                    type="submit" 
                    disabled={isLoading || !inputMessage.trim() || !user || showEndModal}
                >
                    {isLoading ? 'Sending...' : 'Send'}
                </button>
            </form>

            {showEndModal && (
                <div className="end-modal">
                    <div className="end-modal-content">
                        <h2>{agent?.name || "The agent"} had to leave</h2>
                        <p>The conversation has ended.</p>
                        <div className="end-modal-buttons">
                            <button onClick={handleReturnToAgents}>
                                Return to Agent Selection
                            </button>
                            
                        </div>
                    </div>
                </div>
            )}
            
            {/* Add the TestControls component */}
            {process.env.NODE_ENV !== 'production' && (
                <TestControls 
                    agentSlug={agentSlug || ''} 
                    onReset={startNewConversation}
                />
            )}
            
            {/* Always visible test controls */}
            <div style={{
              position: 'fixed',
              bottom: '20px',
              right: '20px',
              zIndex: 10000,
              background: 'black',
              padding: '15px',
              borderRadius: '10px',
              border: '2px solid red',
              boxShadow: '0 0 10px rgba(255,0,0,0.5)'
            }}>
              <div style={{ color: 'white', fontWeight: 'bold', marginBottom: '10px' }}>
                Test Controls
              </div>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  onClick={async () => {
                    try {
                      console.log('Resetting to introduction mode');
                      await api.post('/conversations/reset', { 
                        agentSlug,
                        mode: 'introduction'
                      });
                      window.location.reload();
                    } catch (error) {
                      console.error('Error resetting conversation:', error);
                      alert('Failed to reset to introduction mode');
                    }
                  }}
                  style={{
                    background: 'blue',
                    color: 'white',
                    padding: '8px 12px',
                    border: 'none',
                    borderRadius: '5px',
                    cursor: 'pointer'
                  }}
                >
                  Intro Mode
                </button>
                <button
                  onClick={async () => {
                    try {
                      console.log('Resetting to casual mode');
                      await api.post('/conversations/reset', { 
                        agentSlug,
                        mode: 'casual'
                      });
                      window.location.reload();
                    } catch (error) {
                      console.error('Error resetting conversation:', error);
                      alert('Failed to reset to casual mode');
                    }
                  }}
                  style={{
                    background: 'green',
                    color: 'white',
                    padding: '8px 12px',
                    border: 'none',
                    borderRadius: '5px',
                    cursor: 'pointer'
                  }}
                >
                  Casual Mode
                </button>
              </div>
            </div>
        </div>
    );
}