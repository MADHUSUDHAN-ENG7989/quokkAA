import { createContext, useContext, useState, useEffect } from 'react';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(() => {
        try { return JSON.parse(localStorage.getItem('quokka_user')); } catch { return null; }
    });
    const [token, setToken] = useState(() => localStorage.getItem('quokka_token') || null);
    const [queryCount, setQueryCount] = useState(() => {
        return parseInt(localStorage.getItem('quokka_query_count') || '0');
    });

    useEffect(() => {
        localStorage.setItem('quokka_query_count', queryCount.toString());
    }, [queryCount]);

    const login = (tokenStr, userData) => {
        setToken(tokenStr);
        setUser(userData);
        localStorage.setItem('quokka_token', tokenStr);
        localStorage.setItem('quokka_user', JSON.stringify(userData));
        setQueryCount(0);
        localStorage.setItem('quokka_query_count', '0');
    };

    const logout = () => {
        setToken(null);
        setUser(null);
        localStorage.removeItem('quokka_token');
        localStorage.removeItem('quokka_user');
    };

    const incrementQueryCount = () => {
        setQueryCount(prev => prev + 1);
    };

    const FREE_QUERY_LIMIT = 3;
    const isLimitReached = !user && queryCount >= FREE_QUERY_LIMIT;

    return (
        <AuthContext.Provider value={{ user, token, queryCount, isLimitReached, FREE_QUERY_LIMIT, login, logout, incrementQueryCount }}>
            {children}
        </AuthContext.Provider>
    );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => useContext(AuthContext);
