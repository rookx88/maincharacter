import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../api/config';
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
    const [suggestedResponses, setSuggestedResponses] = useState<string[]>([]);

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
                
                // Start a new conversation to ensure we get the initial message
                console.log('Starting new conversation for testing');
                const startRes = await api.post('/conversations/start', 
                    { agentSlug }
                );
                
                if (startRes.data?.messages && startRes.data.messages.length > 0) {
                    console.log('Initial messages from start:', startRes.data.messages);
                    setMessages(startRes.data.messages);
                } else {
                    console.log('No initial messages in start response, checking messages endpoint');
                    
                    // Fallback to getting messages if start doesn't return them
                    try {
                        const messagesRes = await api.get(`/conversations/${agentSlug}/messages`);
                        
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

    // Replace the problematic useEffect
    useEffect(() => {
        // Force show the modal for testing
        if (Array.isArray(messages) && messages.length > 0) {
            const lastMessage = messages[messages.length - 1];
            if (lastMessage && 
                lastMessage.role === 'assistant' && 
                typeof lastMessage.content === 'string' &&
                lastMessage.content.includes("I need to run now and get ready for the show")) {
                console.log('Detected end message, showing modal');
                setShowEndModal(true);
            }
        }
    }, [messages]);

    // Add this useEffect to log when suggestedResponses changes
    useEffect(() => {
        console.log('Suggested responses updated:', suggestedResponses);
    }, [suggestedResponses]);

    // Add this function to log network requests
    const logNetworkRequest = async (url: string, method: string, data: any) => {
        console.group(`Network Request: ${method} ${url}`);
        console.log('Request data:', data);
        
        try {
            const response = await api({
                method,
                url,
                data
            });
            
            console.log('Response status:', response.status);
            console.log('Response data:', response.data);
            console.groupEnd();
            
            return response;
        } catch (error) {
            console.error('Request failed:', error);
            console.groupEnd();
            throw error;
        }
    };

    // Add this function to test the response format
    const testResponseFormat = (data: any) => {
        console.group('Response Format Test');
        console.log('Raw data:', data);
        console.log('Type of data:', typeof data);
        console.log('Type of data.response:', typeof data.response);
        
        if (typeof data.response === 'string') {
            console.log('Response is a string:', data.response);
        } else if (typeof data.response === 'object') {
            console.log('Response is an object with keys:', Object.keys(data.response));
            console.log('Type of data.response.response:', typeof data.response.response);
        }
        
        console.log('Metadata:', data.metadata || data.response?.metadata);
        console.groupEnd();
        
        // Return the appropriate response text
        return typeof data.response === 'string' 
            ? data.response 
            : (data.response?.response || "No response content");
    };

    // Update the handleSendMessage function to better handle the sequence
    const handleSendMessage = async (e: React.FormEvent) => {
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
            
            // From the server logs, we can see the response format is:
            // { response: "Nice to meet you! I don't think I caught your name?", nextNode: 'entry', metadata: { suggestedResponses: [] } }
            
            // Check if we have a response
            if (response.data) {
                // Test the response format
                const aiResponseText = testResponseFormat(response.data);
                
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
                
                // Get metadata from the appropriate location
                const metadata = response.data.metadata || response.data.response?.metadata || {};
                console.log('Extracted metadata:', metadata);
                
                // Handle suggested responses - only set if they exist and are non-empty
                if (metadata && Array.isArray(metadata.suggestedResponses) && metadata.suggestedResponses.length > 0) {
                    console.log('Setting suggested responses:', metadata.suggestedResponses);
                    setSuggestedResponses(metadata.suggestedResponses);
                } else {
                    console.log('No suggested responses found in metadata or empty array');
                    setSuggestedResponses([]);
                }
                
                // Check for conversation end
                if (metadata?.conversationEnded) {
                    setShowEndModal(true);
                }
            } else {
                console.error('No data in response:', response);
            }
            
        } catch (error) {
            console.error('Error sending message:', error);
            
            // Add more detailed error logging
            if (error && typeof error === 'object') {
                const apiError = error as any;
                if (apiError.response) {
                    // The request was made and the server responded with a status code
                    // that falls out of the range of 2xx
                    console.error('Response error data:', apiError.response.data);
                    console.error('Response error status:', apiError.response.status);
                } else if (apiError.request) {
                    // The request was made but no response was received
                    console.error('Request error:', apiError.request);
                } else if (apiError.message) {
                    // Something happened in setting up the request that triggered an Error
                    console.error('Error message:', apiError.message);
                }
            } else {
                console.error('Unknown error:', error);
            }
            
            setError('Failed to send message. Please try again.');
        } finally {
            setIsLoading(false);
        }
    };

    // Update the handleSuggestedResponseClick function
    const handleSuggestedResponseClick = async (response: string) => {
        try {
            // Clear suggested responses immediately
            setSuggestedResponses([]);
            
            // Add the user message to the UI immediately
            const userMessage = {
                role: 'user' as const,
                content: response,
                timestamp: new Date()
            };
            setMessages(prev => [...prev, userMessage]);
            
            // Send the message to the API directly without setting inputMessage
            console.log('Sending suggested response to API:', response);
            
            // Send the message to the API
            const apiResponse = await api.post('/conversations/message', {
                message: response,
                agentSlug
            });
            
            console.log('Full API response:', apiResponse);
            
            // Process the response as usual
            if (apiResponse.data) {
                const aiResponseText = testResponseFormat(apiResponse.data);
                
                console.log('AI response text:', aiResponseText);
                
                const aiMessage = {
                    role: 'assistant' as const,
                    content: aiResponseText,
                    timestamp: new Date()
                };
                
                console.log('Adding AI message to UI:', aiMessage);
                setMessages(prev => [...prev, aiMessage]);
                
                // Handle metadata
                const metadata = apiResponse.data.metadata || {};
                console.log('Extracted metadata:', metadata);
                
                if (metadata && Array.isArray(metadata.suggestedResponses) && metadata.suggestedResponses.length > 0) {
                    console.log('Setting suggested responses:', metadata.suggestedResponses);
                    setSuggestedResponses(metadata.suggestedResponses);
                } else {
                    console.log('No suggested responses found in metadata or empty array');
                    setSuggestedResponses([]);
                }
                
                if (metadata?.conversationEnded) {
                    setShowEndModal(true);
                }
            }
        } catch (error) {
            console.error('Error sending suggested response:', error);
            setError('Failed to send message. Please try again.');
        }
    };

    const resetConversation = async () => {
        try {
            setIsLoading(true);
            console.log('Resetting conversation for testing');
            
            // Delete the current conversation
            await api.delete(`/conversations/${agentSlug}`);
            
            // Start a new conversation
            const startRes = await api.post('/conversations/start', 
                { agentSlug }
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

    // At the top of the component, add this function
    const safelyRenderMessages = () => {
        try {
            if (!Array.isArray(messages)) {
                console.error("Messages is not an array:", messages);
                return <div className="error-message">Error loading messages</div>;
            }
            
            console.log('Rendering messages:', messages);
            
            return messages.map((message, index) => {
                console.log(`Message ${index}:`, message);
                
                if (!message) {
                    console.error(`Message ${index} is undefined`);
                    return <div key={index} className="message error">Invalid message</div>;
                }
                
                return (
                    <div key={index} className={`message ${message.role || 'unknown'}`}>
                        <div className="message-content">
                            {typeof message.content === 'string' ? message.content : 'No content'}
                        </div>
                    </div>
                );
            });
        } catch (error) {
            console.error("Error rendering messages:", error);
            return <div className="error-message">Error rendering messages</div>;
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
                {safelyRenderMessages()}
            </div>

            {Array.isArray(suggestedResponses) && suggestedResponses.length > 0 && (
                <div className="suggested-responses">
                    <p className="suggested-responses-title">Suggested responses:</p>
                    {suggestedResponses.map((response, index) => {
                        console.log(`Rendering suggested response ${index}:`, response);
                        return (
                            <button 
                                key={index}
                                className="suggested-response-btn"
                                onClick={() => handleSuggestedResponseClick(response)}
                            >
                                {response}
                            </button>
                        );
                    })}
                </div>
            )}

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
                        <button onClick={() => window.location.href = '/agents'}>
                            Return to Agent Selection
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
} 