import React, { useState } from 'react';
import api from '../api/config';

// Define props interface with the required handlers
interface TestControlsProps {
  agentSlug: string;
  onReset: () => Promise<void>;
}

const TestControls: React.FC<TestControlsProps> = ({ 
  agentSlug, 
  onReset 
}) => {
  const [isOpen, setIsOpen] = useState(false);

  // Handle reset conversation with mode
  const resetConversation = async (mode: 'introduction' | 'casual') => {
    try {
      // Call the appropriate handler based on mode
      console.log(`Resetting conversation to ${mode} mode`);
      await api.post('/api/conversations/reset', { 
        agentSlug,
        mode
      });
      window.location.reload(); // Force reload as fallback
    } catch (error) {
      console.error(`Error resetting conversation to ${mode} mode:`, error);
    }
  };

  // Styles for the panel
  const panelStyle: React.CSSProperties = {
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
    gap: '8px',
    color: 'white'
  };

  // Styles for buttons
  const buttonStyle: React.CSSProperties = {
    background: '#5a189a',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    padding: '8px 12px',
    cursor: 'pointer',
    fontSize: '14px'
  };

  if (!isOpen) {
    return (
      <button 
        onClick={() => setIsOpen(true)}
        style={{
          ...buttonStyle,
          position: 'fixed',
          bottom: '10px',
          right: '10px',
          zIndex: 1000,
        }}
      >
        Test Controls
      </button>
    );
  }

  return (
    <div style={panelStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
        <h4 style={{ margin: '0', fontSize: '16px' }}>Test Controls</h4>
        <button 
          onClick={() => setIsOpen(false)} 
          style={{
            background: 'none',
            border: 'none',
            color: 'white',
            cursor: 'pointer',
            fontSize: '18px',
            padding: '0'
          }}
        >
          ×
        </button>
      </div>

      <div style={{ display: 'flex', gap: '8px' }}>
        <button 
          onClick={() => resetConversation('introduction')}
          style={buttonStyle}
        >
          Start Introduction
        </button>
        <button 
          onClick={() => resetConversation('casual')}
          style={buttonStyle}
        >
          Start Casual
        </button>
      </div>
    </div>
  );
};

export default TestControls;