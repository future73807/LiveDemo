import { Route, Routes } from 'react-router-dom';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<div className="page">LiveDemo 脚手架就绪</div>} />
    </Routes>
  );
}
