import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import './Header.css';

const Header: React.FC = () => {
    const { user, logout } = useAuth();
    const navigate = useNavigate();

    const isAuthenticated = !!user;

    const handleLogout = async () => {
        try {
            await logout();
            navigate('/login');
        } catch (error) {
            console.error('Logout failed:', error);
        }
    };

    if (!isAuthenticated) return null;

    return (
        <header className="header">
            <div className="header-content">
                <div className="logo-section">
                    <Link to="/" className="logo">
                        <img
                            src="/images/brand/MC-Header.svg"
                            alt="Main Character Logo"
                            className="logo-image"
                        />
                    </Link>
                    <span className="tagline">The future of storytelling: Engaging. Intelligent. Yours.</span>
                </div>
                
                <nav className="nav-links">
                    <NavLink to="/agents">Story Vault</NavLink>
                    <NavLink to="/memory-viewer">Memories</NavLink>
                    <NavLink to="/map">City Map</NavLink>
                </nav>
                <div className="user-section">
                    <span className="user-name">
                        Welcome, {user?.name}
                    </span>
                    <button
                        onClick={handleLogout}
                        className="logout-button"
                    >
                        Logout
                    </button>
                </div>
            </div>
        </header>
    );
};

export default Header; 