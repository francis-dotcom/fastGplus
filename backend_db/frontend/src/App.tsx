import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Users from './pages/Users';
import Tables from './pages/Tables';
import TableDetail from './pages/TableDetail';
import Storage from './pages/Storage';
import BucketDetail from './pages/BucketDetail';
import Profile from './pages/Profile';
import Backups from './pages/Backups';
import SqlEditor from './pages/SqlEditor';
import Functions from './pages/Functions';
import FunctionDetail from './pages/FunctionDetail';
import Schema from './pages/Schema';
import ApiDocs from './pages/ApiDocs';

function RequireAuth({ children }: { children: any }) {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return <div className="min-h-screen bg-slate-900 flex items-center justify-center text-white">Loading...</div>;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children;
}

function RequireAdmin({ children }: { children: any }) {
  const { user, isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return <div className="min-h-screen bg-slate-900 flex items-center justify-center text-white">Loading...</div>;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (user?.role !== 'ADMIN') {
    return <Navigate to="/" replace />;
  }

  return children;
}

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />

            <Route path="/" element={
              <RequireAuth>
                <Layout />
              </RequireAuth>
            }>
              <Route index element={<Dashboard />} />
              <Route path="users" element={<Users />} />
              <Route path="tables" element={<Tables />} />
              <Route path="tables/:tableId" element={<TableDetail />} />
              <Route path="storage" element={<Storage />} />
              <Route path="storage/:bucketId" element={<BucketDetail />} />
              <Route path="profile" element={<Profile />} />
              <Route path="functions" element={
                <RequireAdmin>
                  <Functions />
                </RequireAdmin>
              } />
              <Route path="functions/:functionId" element={
                <RequireAdmin>
                  <FunctionDetail />
                </RequireAdmin>
              } />
              <Route path="sql-editor" element={
                <RequireAdmin>
                  <SqlEditor />
                </RequireAdmin>
              } />
              <Route path="backups" element={
                <RequireAdmin>
                  <Backups />
                </RequireAdmin>
              } />
              <Route path="schema" element={
                <RequireAdmin>
                  <Schema />
                </RequireAdmin>
              } />
              <Route path="api-docs" element={
                <RequireAdmin>
                  <ApiDocs />
                </RequireAdmin>
              } />
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
