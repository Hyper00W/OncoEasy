import { AuthProvider } from "./auth/AuthProvider";
import { DevelopmentHealthCheck } from "./dev/DevelopmentHealthCheck";
import { AppRouter } from "./routing/AppRouter";

function App() {
  const isDevelopment = import.meta.env.DEV;

  return (
    <AuthProvider>
      <AppRouter />
      {isDevelopment ? <DevelopmentHealthCheck /> : null}
    </AuthProvider>
  );
}

export default App;
