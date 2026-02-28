import { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import type { User } from '../types';

interface UserContextValue {
  user: User | null;
  setUser: (u: User | null) => void;
}

const UserContext = createContext<UserContextValue>({ user: null, setUser: () => {} });

export const UserProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUserState] = useState<User | null>(() => {
    try {
      const stored = localStorage.getItem('taskboard_user');
      return stored ? (JSON.parse(stored) as User) : null;
    } catch {
      return null;
    }
  });

  const setUser = (u: User | null) => {
    if (u) localStorage.setItem('taskboard_user', JSON.stringify(u));
    else localStorage.removeItem('taskboard_user');
    setUserState(u);
  };

  useEffect(() => {
    // keep in sync if another tab logs out
    const handler = (e: StorageEvent) => {
      if (e.key === 'taskboard_user') {
        setUserState(e.newValue ? (JSON.parse(e.newValue) as User) : null);
      }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  return <UserContext.Provider value={{ user, setUser }}>{children}</UserContext.Provider>;
};

export const useUser = () => useContext(UserContext);
