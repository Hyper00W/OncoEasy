import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
// Phase 7 layers load after index.css so they are the authoritative rules for
// the classes they own (motion language, composition primitives, workspaces).
import './styles/motion.css'
import './styles/compositions.css'
import './styles/workspaces.css'
import './styles/patient.css'
// Phase 8: Demand Forecast Engine premium workspace (dfe-*/dfc-* namespaces).
import './styles/forecast.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
