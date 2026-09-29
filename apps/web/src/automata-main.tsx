import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Automata } from './Automata.tsx';
import './automata.css';
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Automata />
  </StrictMode>,
);
