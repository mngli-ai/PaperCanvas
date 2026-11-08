import React from 'react';
import {createRoot} from 'react-dom/client';
import App from './App';
import '@excalidraw/excalidraw/index.css';
import 'katex/dist/katex.min.css';
import './style.css';
createRoot(document.getElementById('root')!).render(<App/>);
