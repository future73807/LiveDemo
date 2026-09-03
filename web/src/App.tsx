import { Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import LoginModal from './components/LoginModal';

function Gate({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  return (
    <>
      {children}
      {!user && <LoginModal />}
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Gate>
        <Routes>
          <Route path="/" element={<div className="page">LiveDemo 脚手架就绪</div>} />
        </Routes>
      </Gate>
    </AuthProvider>
  );
}
