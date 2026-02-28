import { UserProvider, useUser } from './context/UserContext';
import { ToastProvider } from './components/Toast';
import { LoginPage } from './pages/LoginPage';
import { BoardPage } from './pages/BoardPage';
import './App.css';

const AppInner = () => {
  const { user } = useUser();
  return user ? <BoardPage /> : <LoginPage />;
};

export default function App() {
  return (
    <UserProvider>
      <ToastProvider>
        <AppInner />
      </ToastProvider>
    </UserProvider>
  );
}
