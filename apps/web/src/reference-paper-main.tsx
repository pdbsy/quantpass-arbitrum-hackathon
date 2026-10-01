import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ReferencePaper } from './ReferencePaper.tsx';
import './automata.css';
import './reference-paper.css';
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ReferencePaper />
  </StrictMode>,
);
