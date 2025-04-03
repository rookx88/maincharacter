import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import './NewConversationUI.css';

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
}

export default function SimpleConversationUI() {
  const { agentSlug } = useParams<{ agentSlug: string }>();
  const { user, loading: authLoading } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  console.log('SimpleConversationUI rendering', { agentSlug, user, authLoading });

  // Load initial message
  useEffect(() => {
    console.log('SimpleConversationUI useEffect', { agentSlug, user });
    
    const loadInitialMessage = async () => {
      if (!agentSlug || !user) return;
      
      console.log('Attempting to load initial message', { agentSlug, user });
      
      try {
        const response = await axios.post('/api/conversations/start', 
          { agentSlug }, 
          { withCredentials: true }
        );
        
        console.log('Initial message response:', response.data);
        
        if (response.data?.messages) {
          console.log('Setting messages:', response.data.messages);
          setMessages(response.data.messages);
        }
      } catch (error) {
        console.error('Error loading initial message:', error);
      }
    };
    
    loadInitialMessage();
  }, [agentSlug, user]);

  // Send message function
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputMessage.trim() || isLoading || !user || !agentSlug) return;
    
    try {
      setIsLoading(true);
      
      // Add user message to UI
      const userMessage: Message = {
        role: 'user',
        content: inputMessage,
        timestamp: new Date()
      };
      setMessages(prev => [...prev, userMessage]);
      setInputMessage('');
      
      // Send to API
      const response = await axios.post('/api/conversations/message', {
        message: inputMessage,
        agentSlug
      }, {
        withCredentials: true
      });
      
      // Add AI response to UI
      if (response.data?.message) {
        const aiMessage: Message = {
          role: 'assistant',
          content: response.data.message,
          timestamp: new Date()
        };
        setMessages(prev => [...prev, aiMessage]);
      }
      
      console.log('Response:', response.data);
      
    } catch (error) {
      console.error('Error sending message:', error);
    } finally {
      setIsLoading(false);
    }
  };

  if (authLoading) {
    return <div className="loading">Loading...</div>;
  }

  if (!user) {
    return <div className="error-message">Please login to continue</div>;
  }

  return (
    <div className="chat-container" style={{ 
      border: '2px solid red', 
      minHeight: '500px',
      margin: '20px',
      padding: '20px'
    }}>
      <div className="chat-header">
        <h2>Agent: {agentSlug}</h2>
      </div>
      
      <div className="messages-area" style={{ 
        border: '1px solid blue',
        minHeight: '300px',
        margin: '10px 0',
        padding: '10px'
      }}>
        {Array.isArray(messages) && messages.length > 0 ? (
          messages.map((message, index) => (
            <div key={index} className={`message ${message.role}`}>
              <div className="message-content">{message.content}</div>
            </div>
          ))
        ) : (
          <div>No messages yet. Start a conversation!</div>
        )}
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
          disabled={isLoading || !inputMessage.trim()}
        >
          {isLoading ? 'Sending...' : 'Send'}
        </button>
      </form>
    </div>
  );
} 