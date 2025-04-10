import React, { useState } from 'react';
import api from '../api/config';

// Add TypeScript interface for props
interface TestControlsProps {
  agentSlug: string;
  onReset: () => void;
}

const TestControls = ({ agentSlug, onReset }: TestControlsProps) => {
  const [isOpen, setIsOpen] = useState(false);

  const resetConversation = async (mode: 'introduction' | 'casual') => {
    try {
      await api.post('/api/conversations/reset', { 
        agentSlug,
        mode // 'introduction' or 'casual'
      });
      onReset(); // Refresh the conversation
    } catch (error) {
      console.error('Error resetting conversation:', error);
    }
  };

  if (!isOpen) {
    return (
      <button 
        className="test-controls-toggle"
        onClick={() => setIsOpen(true)}
        style={{
          position: 'fixed',
          bottom: '10px',
          right: '10px',
          zIndex: 1000,
          background: '#5a189a',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          padding: '5px 10px'
        }}
      >
        Show Test Controls
      </button>
    );
  }

  return (
    <div className="test-controls-panel" style={{
      position: 'fixed',
      bottom: '10px',
      right: '10px',
      zIndex: 1000,
      background: 'rgba(15, 23, 42, 0.9)',
      padding: '10px',
      borderRadius: '8px',
      boxShadow: '0 0 10px rgba(0,0,0,0.3)',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <h4 style={{ margin: '0 0 8px 0', color: 'white' }}>Test Controls</h4>
        <button onClick={() => setIsOpen(false)} style={{
          background: 'none',
          border: 'none',
          color: 'white',
          cursor: 'pointer'
        }}>×</button>
      </div>

      <div style={{ display: 'flex', gap: '8px' }}>
        <button 
          onClick={() => resetConversation('introduction')}
          style={{
            background: '#5a189a',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            padding: '5px 10px'
          }}
        >
          Start Introduction
        </button>
        <button 
          onClick={() => resetConversation('casual')}
          style={{
            background: '#5a189a',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            padding: '5px 10px'
          }}
        >
          Start Casual
        </button>
      </div>
    </div>
  );
};

export default TestControls;