import React from 'react';
import { Link } from 'react-router-dom';
import './Footer.css';

const Footer: React.FC = () => {
    return (
        <footer className="footer">
            <div className="footer-content">
                <div className="footer-section">
                    <h3>Main Character</h3>
                    <p className="footer-tagline">Your story isn't just told. It's owned.</p>
                </div>
                
                <div className="footer-section">
                    <h4>Navigation</h4>
                    <Link to="/agents">Story Vault</Link>
                    <Link to="/memory-viewer">Memories</Link>
                </div>
                
                <div className="footer-section">
                    <h4>Legal</h4>
                    <Link to="/privacy">Privacy Policy</Link>
                    <Link to="/terms">Terms of Service</Link>
                </div>
                
                <div className="footer-section">
                    <h4>Contact</h4>
                    <a href="mailto:support@maincharacter.ai">support@maincharacter.ai</a>
                </div>
            </div>
            <div className="footer-bottom">
                <p>&copy; 2024 Main Character. All rights reserved.</p>
            </div>
        </footer>
    );
};

export default Footer; 